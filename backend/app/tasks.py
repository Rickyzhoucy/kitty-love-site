import json
import logging
from typing import Any

import httpx
from langchain_core.messages import HumanMessage, SystemMessage
from sqlalchemy import select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app import runtime_config
from app.agents.conversation import build_agent, build_chat_model
from app.agents.reflection import ReflectionAgent, companions_with_pending
from app.agents.roles import AgentRole
from app.anniversaries import ANNIVERSARY_EVENT, deliver_due, scan_anniversaries
from app.attachment_processing import thumbnail_webp
from app.config import get_settings
from app.context_assembler import ContextAssembler
from app.db import session_factory
from app.document_services import render_preview_pdf, understand_document
from app.embeddings import OpenAICompatibleEmbeddingProvider, UnavailableEmbeddingProvider
from app.future_letters import LETTER_EVENT, announce_unlocked
from app.memory import MemoryService
from app.memory_extraction import extract_with_langmem
from app.models import (
    Attachment,
    ChatMessage,
    Companion,
    Conversation,
    ConversationSummary,
    DirectMessage,
    MemoryIngestionCursor,
    MemoryPreference,
    MemoryRecord,
    User,
    UserProfile,
    utcnow,
)
from app.queue import ProcrastinateJobQueue, procrastinate_app, register_job
from app.schemas import MemoryCreate
from app.storage import ObjectStorage

logger = logging.getLogger(__name__)


def _message_text(response) -> str:
    content = response.content
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(block.get("text", "") for block in content if isinstance(block, dict))
    return str(content)


def _importance(value: Any) -> int:
    if isinstance(value, str):
        labels = {"low": 30, "medium": 50, "high": 80}
        normalized = value.strip().lower()
        if normalized in labels:
            return labels[normalized]
        try:
            value = float(normalized)
        except ValueError:
            return 50
    if not isinstance(value, (int, float)):
        return 50
    return max(0, min(100, int(value)))


@register_job("conversation.summarize")
async def summarize_conversation(payload: dict) -> None:
    await handle_conversation_summary(
        payload,
        build_chat_model(get_settings()),
        session_factory,
    )


async def handle_conversation_summary(
    payload: dict,
    model: Any,
    maker: async_sessionmaker[AsyncSession],
) -> None:
    conversation_id = str(payload["conversation_id"])
    async with maker() as db:
        conversation = await db.get(Conversation, conversation_id)
        if conversation is None:
            return
        summary = await db.scalar(
            select(ConversationSummary)
            .where(ConversationSummary.conversation_id == conversation_id)
            .order_by(ConversationSummary.created_at.desc())
            .limit(1)
        )
        query = (
            select(ChatMessage)
            .where(ChatMessage.conversation_id == conversation_id)
            .order_by(ChatMessage.created_at, ChatMessage.id)
            .limit(40)
        )
        if summary and summary.through_message_id:
            previous_message = await db.get(ChatMessage, summary.through_message_id)
            if previous_message:
                query = query.where(
                    tuple_(ChatMessage.created_at, ChatMessage.id)
                    > tuple_(previous_message.created_at, previous_message.id)
                )
        messages = list(await db.scalars(query))
        previous_summary = summary.summary if summary else ""
    if not messages:
        return
    transcript = "\n".join(f"{message.role}: {message.content}" for message in messages)
    prompt = f"现有摘要：\n{previous_summary or '暂无'}\n\n新增对话：\n{transcript}"
    response = await model.ainvoke(
        [
            SystemMessage(
                content=(
                    "把现有摘要与新增私人伴侣对话合并为简洁、事实性的滚动摘要；"
                    "保留仍有用的人物、偏好、承诺和未完成事项。"
                )
            ),
            HumanMessage(content=prompt),
        ]
    )
    through_message_id = messages[-1].id
    async with maker() as db:
        summary = await db.scalar(
            select(ConversationSummary)
            .where(ConversationSummary.conversation_id == conversation_id)
            .order_by(ConversationSummary.created_at.desc())
            .limit(1)
        )
        if summary is None:
            summary = ConversationSummary(
                conversation_id=conversation_id,
                summary=_message_text(response),
                through_message_id=through_message_id,
            )
            db.add(summary)
        else:
            summary.summary = _message_text(response)
            summary.through_message_id = through_message_id
        await db.commit()


@register_job("profile.refresh")
async def refresh_profile(payload: dict) -> None:
    await handle_profile_refresh(
        payload,
        build_chat_model(get_settings()),
        session_factory,
    )


async def handle_profile_refresh(
    payload: dict,
    model: Any,
    maker: async_sessionmaker[AsyncSession],
) -> None:
    conversation_id = str(payload["conversation_id"])
    user_id = str(payload["user_id"])
    async with maker() as db:
        conversation = await db.get(Conversation, conversation_id)
        if conversation is None or conversation.user_id != user_id:
            return
        profile = await db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
        messages = list(
            await db.scalars(
                select(ChatMessage)
                .where(ChatMessage.conversation_id == conversation_id)
                .order_by(ChatMessage.created_at.desc())
                .limit(20)
            )
        )
        current_profile = profile.profile if profile else {}
    if not messages:
        return
    transcript = "\n".join(f"{message.role}: {message.content}" for message in reversed(messages))
    response = await model.ainvoke(
        [
            SystemMessage(
                content=(
                    "根据现有用户画像和新增对话更新人物画像。"
                    "只保留稳定、对未来交流有帮助的信息；仅输出一个 JSON 对象。"
                )
            ),
            HumanMessage(
                content=(
                    f"现有画像：{json.dumps(current_profile, ensure_ascii=False)}\n"
                    f"新增对话：\n{transcript}"
                )
            ),
        ]
    )
    raw = _message_text(response).strip().removeprefix("```json").removesuffix("```").strip()
    try:
        updated = json.loads(raw)
    except json.JSONDecodeError:
        return
    if not isinstance(updated, dict):
        return
    async with maker() as db:
        profile = await db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
        if profile is None:
            profile = UserProfile(user_id=user_id, profile=updated)
            db.add(profile)
        else:
            profile.profile = updated
        await db.commit()


@register_job("memory.extract")
async def extract_memories(payload: dict) -> None:
    await handle_memory_extraction(
        payload,
        build_chat_model(get_settings()),
        MemoryService(OpenAICompatibleEmbeddingProvider(get_settings())),
        session_factory,
    )


async def handle_memory_extraction(
    payload: dict,
    model: Any,
    memory: MemoryService,
    maker: async_sessionmaker[AsyncSession],
) -> None:
    conversation_id = str(payload["conversation_id"])
    user_id = str(payload["user_id"])
    async with maker() as db:
        conversation = await db.get(Conversation, conversation_id)
        if conversation is None or conversation.user_id != user_id:
            return
        preference = await db.scalar(
            select(MemoryPreference).where(MemoryPreference.user_id == user_id)
        )
        memory_policy = await runtime_config.load_all(db)
        cursor = await db.scalar(
            select(MemoryIngestionCursor).where(
                MemoryIngestionCursor.source_type == "conversation",
                MemoryIngestionCursor.source_id == conversation_id,
            )
        )
        query = (
            select(ChatMessage)
            .where(
                ChatMessage.conversation_id == conversation_id,
                ChatMessage.memory_excluded.is_(False),
            )
            .order_by(ChatMessage.created_at, ChatMessage.id)
            .limit(40)
        )
        if cursor and cursor.last_message_id:
            previous = await db.get(ChatMessage, cursor.last_message_id)
            if previous is not None:
                query = query.where(
                    tuple_(ChatMessage.created_at, ChatMessage.id)
                    > tuple_(previous.created_at, previous.id)
                )
        messages = list(await db.scalars(query))
    if not messages:
        return
    user_messages = [message for message in messages if message.role == "user"]
    if not user_messages:
        return
    if not memory_policy["memory.private_extraction_enabled"] or (
        preference and (preference.paused or not preference.conversation_enabled)
    ):
        await _advance_memory_cursor(
            maker,
            conversation.space_id,
            "conversation",
            conversation_id,
            messages[-1].id,
        )
        return
    transcript = "\n".join(
        f"[{message.id}][{message.role}] {message.content}" for message in messages
    )
    candidates = await extract_with_langmem(
        model,
        transcript,
        instructions=(
            "Private user-to-companion conversation. Extract facts only from user "
            "messages. All accepted memories will be user_private."
        ),
    )
    if candidates is None:
        response = await model.ainvoke(
            [
                SystemMessage(
                    content=(
                        "从私人宠物对话中提取值得跨会话使用的长期记忆候选。"
                        "只把 user 消息当事实证据，assistant 只帮助理解指代。"
                        "绝不提取本机路径、授权目录、工作区、文件全文、命令输出、"
                        "密码、token、工具状态或模型自己声称已完成的事。"
                        "只输出 JSON 数组；每项格式为 "
                        "{memoryType,content,confidence,importance,sensitivity,"
                        "subjectType,subjectId,predicate,objectJson,sourceMessageIds}。"
                        "memoryType 只能是 fact/preference/commitment/episode/"
                        "interaction_preference/relationship；没有则输出 []。"
                    )
                ),
                HumanMessage(content=transcript),
            ]
        )
        raw = _message_text(response).strip().removeprefix("```json").removesuffix("```").strip()
        try:
            candidates = json.loads(raw)
        except json.JSONDecodeError:
            return
    if not isinstance(candidates, list):
        return
    allowed_sources = {message.id for message in user_messages}
    async with maker() as db:
        for candidate in candidates[: int(memory_policy["memory.max_candidates_per_batch"])]:
            if not isinstance(candidate, dict) or not candidate.get("content"):
                continue
            confidence = _confidence(candidate.get("confidence", 0.0))
            if confidence < float(memory_policy["memory.min_candidate_confidence"]):
                continue
            source_ids = [
                str(item)
                for item in candidate.get("sourceMessageIds", [])
                if str(item) in allowed_sources
            ]
            if not source_ids:
                continue
            try:
                item = await memory.create(
                    db,
                    user_id,
                    MemoryCreate(
                        visibility="user_private",
                        companion_id=None,
                        memory_type=str(candidate.get("memoryType", "fact")),
                        content=str(candidate["content"]),
                        confidence=confidence,
                        importance=_importance(candidate.get("importance", 50)),
                        sensitivity=str(candidate.get("sensitivity", "normal")),
                        subject_type=str(candidate.get("subjectType", "user"))[:32],
                        subject_id=(
                            str(candidate["subjectId"])[:32]
                            if candidate.get("subjectId")
                            else user_id
                        ),
                        predicate=(
                            str(candidate["predicate"])[:120]
                            if candidate.get("predicate")
                            else None
                        ),
                        object_json=(
                            candidate.get("objectJson")
                            if isinstance(candidate.get("objectJson"), dict)
                            else None
                        ),
                        source_type="chat_message",
                        source_ids=source_ids,
                        extractor_version="conversation-v2",
                    ),
                    embed=False,
                )
                try:
                    await memory.embed_item(db, item)
                except Exception:
                    logger.info("记忆向量生成失败，保留词法记忆", exc_info=True)
                await db.commit()
            except (ValueError, TypeError):
                logger.info("记忆候选被策略或 Schema 拒绝", exc_info=True)
                await db.rollback()
        await _upsert_cursor(
            db,
            conversation.space_id,
            "conversation",
            conversation_id,
            messages[-1].id,
        )
        await db.commit()


def _confidence(value: Any) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return 0.0


async def _upsert_cursor(
    db: AsyncSession,
    space_id: str,
    source_type: str,
    source_id: str,
    last_message_id: str,
) -> None:
    cursor = await db.scalar(
        select(MemoryIngestionCursor).where(
            MemoryIngestionCursor.source_type == source_type,
            MemoryIngestionCursor.source_id == source_id,
        )
    )
    if cursor is None:
        db.add(
            MemoryIngestionCursor(
                space_id=space_id,
                source_type=source_type,
                source_id=source_id,
                last_message_id=last_message_id,
                last_processed_at=utcnow(),
                extractor_version="memory-v2",
            )
        )
    else:
        cursor.last_message_id = last_message_id
        cursor.last_processed_at = utcnow()
        cursor.extractor_version = "memory-v2"


async def _advance_memory_cursor(
    maker: async_sessionmaker[AsyncSession],
    space_id: str,
    source_type: str,
    source_id: str,
    last_message_id: str,
) -> None:
    async with maker() as db:
        await _upsert_cursor(db, space_id, source_type, source_id, last_message_id)
        await db.commit()


@register_job("memory.extract.direct")
async def extract_direct_message_memories(payload: dict) -> None:
    await handle_direct_message_memory_extraction(
        payload,
        build_chat_model(get_settings()),
        MemoryService(OpenAICompatibleEmbeddingProvider(get_settings())),
        session_factory,
    )


async def handle_direct_message_memory_extraction(
    payload: dict,
    model: Any,
    memory: MemoryService,
    maker: async_sessionmaker[AsyncSession],
) -> None:
    """Extract shared memories only from attributable, eligible direct messages."""

    message_id = str(payload["message_id"])
    async with maker() as db:
        trigger = await db.get(DirectMessage, message_id)
        if trigger is None:
            return
        memory_policy = await runtime_config.load_all(db)
        cursor = await db.scalar(
            select(MemoryIngestionCursor).where(
                MemoryIngestionCursor.source_type == "direct_thread",
                MemoryIngestionCursor.source_id == trigger.space_id,
            )
        )
        query = (
            select(DirectMessage)
            .where(
                DirectMessage.space_id == trigger.space_id,
                DirectMessage.memory_excluded.is_(False),
            )
            .order_by(DirectMessage.created_at, DirectMessage.id)
            .limit(60)
        )
        if cursor and cursor.last_message_id:
            previous = await db.get(DirectMessage, cursor.last_message_id)
            if previous is not None:
                query = query.where(
                    tuple_(DirectMessage.created_at, DirectMessage.id)
                    > tuple_(previous.created_at, previous.id)
                )
        messages = list(await db.scalars(query))
        participant_ids = {
            participant
            for message in messages
            for participant in (message.sender_id, message.recipient_id)
        }
        preferences = {
            item.user_id: item
            for item in await db.scalars(
                select(MemoryPreference).where(MemoryPreference.user_id.in_(participant_ids))
            )
        }
    if not messages:
        return

    if not memory_policy["memory.shared_extraction_enabled"]:
        await _advance_memory_cursor(
            maker,
            trigger.space_id,
            "direct_thread",
            trigger.space_id,
            messages[-1].id,
        )
        return

    eligible = [
        message
        for message in messages
        if not (
            (preference := preferences.get(message.sender_id))
            and (preference.paused or not preference.direct_message_enabled)
        )
    ]
    if not eligible:
        await _advance_memory_cursor(
            maker,
            trigger.space_id,
            "direct_thread",
            trigger.space_id,
            messages[-1].id,
        )
        return

    transcript = "\n".join(
        f"[{message.id}][speaker:{message.sender_id}] {message.body}"
        for message in eligible
        if message.body.strip()
    )
    if not transcript:
        return
    candidates = await extract_with_langmem(
        model,
        transcript,
        instructions=(
            "Two-person direct-message thread. All accepted memories are "
            "couple_shared. speaker_user_id is required. A commitment requires "
            "source messages authored by both participants."
        ),
    )
    if candidates is None:
        response = await model.ainvoke(
            [
                SystemMessage(
                    content=(
                        "从两个人的私聊中提取值得长期共享的事实、偏好、共同约定和经历。"
                        "每项必须能追溯到真实发送者；不要把宠物或模型的话当证据。"
                        "commitment 必须有双方各自的消息证据，否则不要提取。"
                        "绝不提取本机路径、授权目录、工作区、文件全文、命令输出、密码、"
                        "token 或工具状态。只输出 JSON 数组；每项格式为 "
                        "{memoryType,content,confidence,importance,sensitivity,"
                        "subjectType,subjectId,predicate,objectJson,speakerUserId,"
                        "sourceMessageIds}。"
                    )
                ),
                HumanMessage(content=transcript),
            ]
        )
        raw = _message_text(response).strip().removeprefix("```json").removesuffix("```").strip()
        try:
            candidates = json.loads(raw)
        except json.JSONDecodeError:
            return
    if not isinstance(candidates, list):
        return

    by_id = {message.id: message for message in eligible}
    async with maker() as db:
        for candidate in candidates[: int(memory_policy["memory.max_candidates_per_batch"])]:
            if not isinstance(candidate, dict) or not candidate.get("content"):
                continue
            confidence = _confidence(candidate.get("confidence"))
            if confidence < float(memory_policy["memory.min_candidate_confidence"]):
                continue
            source_ids = list(
                dict.fromkeys(
                    str(source_id)
                    for source_id in candidate.get("sourceMessageIds", [])
                    if str(source_id) in by_id
                )
            )
            speaker_id = str(candidate.get("speakerUserId") or "")
            source_speakers = {by_id[source_id].sender_id for source_id in source_ids}
            if not source_ids or speaker_id not in source_speakers:
                continue
            memory_type = str(candidate.get("memoryType", "fact"))
            if memory_type == "commitment" and len(source_speakers) < 2:
                continue
            try:
                item = await memory.create(
                    db,
                    speaker_id,
                    MemoryCreate(
                        visibility="couple_shared",
                        memory_type=memory_type,
                        content=str(candidate["content"]),
                        confidence=confidence,
                        importance=_importance(candidate.get("importance", 50)),
                        sensitivity=str(candidate.get("sensitivity", "normal")),
                        subject_type=str(candidate.get("subjectType", "couple"))[:32],
                        subject_id=(
                            str(candidate["subjectId"])[:32] if candidate.get("subjectId") else None
                        ),
                        predicate=(
                            str(candidate["predicate"])[:120]
                            if candidate.get("predicate")
                            else None
                        ),
                        object_json=(
                            candidate.get("objectJson")
                            if isinstance(candidate.get("objectJson"), dict)
                            else None
                        ),
                        source_type="direct_message",
                        source_ids=source_ids,
                        extractor_version="direct-message-v2",
                    ),
                    embed=False,
                )
                if item.status == "active":
                    try:
                        await memory.embed_item(db, item)
                    except Exception:
                        logger.info("共享记忆向量生成失败，保留词法记忆", exc_info=True)
                await db.commit()
            except (ValueError, TypeError):
                logger.info("共享记忆候选被策略或 Schema 拒绝", exc_info=True)
                await db.rollback()
        await _upsert_cursor(
            db,
            trigger.space_id,
            "direct_thread",
            trigger.space_id,
            messages[-1].id,
        )
        await db.commit()


@register_job("pet.reflect")
async def reflect_pet_events(payload: dict) -> None:
    """后台低频消费 CompanionPetEvent，把经历沉淀成记忆（架构文档 §4.3）。

    用 Reflection 角色的模型：温度更低（0.3），因为这是提炼不是创作。
    """
    await handle_reflection(
        payload,
        build_chat_model(get_settings(), role=AgentRole.REFLECTION),
        MemoryService(OpenAICompatibleEmbeddingProvider(get_settings())),
        session_factory,
    )


async def handle_reflection(
    payload: dict,
    model: Any,
    memory: MemoryService,
    maker: async_sessionmaker[AsyncSession],
) -> list[str]:
    companion_id = str(payload["companion_id"])
    async with maker() as db:
        companion = await db.get(Companion, companion_id)
        if companion is None:
            return []
        return await ReflectionAgent(model, memory).reflect(db, companion)


#: 会被 `anniversary.deliver` 念出来的事件类型。
#:
#: 新增一种「到点了该说一声」的东西时，**要加进这里**——否则它会像纪念日和
#: 情书当初那样，事件安安静静写进表里，没有任何人读，功能看起来做完了其实
#: 一次都没生效过。
DELIVERABLE_EVENTS = frozenset({ANNIVERSARY_EVENT, LETTER_EVENT})


@procrastinate_app.periodic(cron="7 1 * * *")
@procrastinate_app.task(name="anniversary.scan", queue="companion")
async def scan_anniversaries_daily(timestamp: int) -> None:
    """每天扫一遍纪念日和刚解锁的情书，到点的写成待表达事件（计划文档 §2.2）。

    凌晨 1:07 跑：那时候不会和用户抢，写下的事件等人回到站上自然会被念出来。
    不直接推送——事件要经过宠物的打扰预算，才不会绕开安静模式。
    （容器时区见 compose 里的 TZ：不设的话这行 cron 实际跑在早上九点。）
    """
    del timestamp
    async with session_factory() as db:
        written = await scan_anniversaries(db)
        letters = await announce_unlocked(db)
    if written:
        logger.info("今日纪念日提醒：%s", "；".join(written))
    if letters:
        logger.info("今日解锁情书：%s 封", len(letters))


@procrastinate_app.periodic(cron="*/20 8-22 * * *")
@procrastinate_app.task(name="anniversary.deliver", queue="companion")
async def deliver_anniversaries(timestamp: int) -> None:
    """把扫出来的到点提醒送到宠物嘴里（anniversaries.deliver_due 有详细说明）。

    与扫描分开、且**只在白天跑**：扫描凌晨 1:07 做完，那个点推送出去没人看得到，
    而送达即标记已处理，等于白白丢掉。8 点到 22 点每 20 分钟看一次，人回到站上
    最多等 20 分钟就会听到那句话。深夜不跑——宠物的安静时段是 23:00–08:00。
    """
    del timestamp
    async with session_factory() as db:
        await deliver_due(db, types=DELIVERABLE_EVENTS)


@procrastinate_app.periodic(cron="23 4 * * *")
@procrastinate_app.task(name="pet.reflect.sweep", queue="companion")
async def sweep_pending_reflections(timestamp: int) -> None:
    """每日兜底扫描（架构文档 §4.3「后台低频消费」）。

    正常路径是按量触发——攒够 `REFLECTION_BATCH_TRIGGER` 条就入队一次。
    但一个不活跃的用户可能永远攒不满，那些事件不该无限期挂着。这里每天扫一遍，
    把有待处理事件的伴侣都排上。

    凌晨 4:23 而不是整点：错开其它定时任务，也避开用户可能在线的时段。
    """
    del timestamp
    settings = get_settings()
    if not settings.chat_api_key:
        # 没配模型就没有反思可言。静默返回，不要每天在日志里报一次错。
        return
    queue = ProcrastinateJobQueue()
    async with session_factory() as db:
        companion_ids = await companions_with_pending(db)
    for companion_id in companion_ids:
        try:
            await queue.enqueue(
                "pet.reflect",
                {"companion_id": companion_id},
                # 与按量触发共用同一把队列锁：已经排着的就不重复排。
                idempotency_key=companion_id,
            )
        except Exception:
            logger.info("兜底反思入队失败：%s", companion_id, exc_info=True)


@register_job("memory.embed")
async def embed_memory(payload: dict) -> None:
    memory = MemoryService(OpenAICompatibleEmbeddingProvider(get_settings()))
    async with session_factory() as db:
        item = await db.get(MemoryRecord, str(payload["memory_id"]))
        if item is None:
            return
        await memory.embed_item(db, item)
        await db.commit()


@register_job("attachment.process")
async def process_attachment(payload: dict) -> None:
    settings = get_settings()
    storage = ObjectStorage(settings)
    async with session_factory() as db:
        attachment = await db.get(Attachment, str(payload["attachment_id"]))
        if attachment is None:
            return
        content = await storage.get_bytes(attachment.bucket, attachment.object_key)
        try:
            understanding = await understand_document(
                content,
                attachment.content_type,
                attachment.filename,
                settings,
            )
            thumbnail = thumbnail_webp(content, attachment.content_type)
        except Exception as error:
            attachment.parse_status = "failed"
            attachment.parse_error = str(error)[:2000]
            await db.commit()
            return
        attachment.extracted_text = understanding.text
        attachment.parser = understanding.parser
        attachment.processing_metadata = understanding.processing_metadata
        attachment.derived_bucket = settings.minio_derived_bucket
        if understanding.document_ir is not None:
            encoded_ir = json.dumps(
                understanding.document_ir,
                ensure_ascii=False,
                separators=(",", ":"),
            ).encode("utf-8")
            if len(encoded_ir) > settings.document_ir_max_bytes:
                attachment.parse_status = "failed"
                attachment.parse_error = "Document IR 超过存储上限"
                await db.commit()
                return
            attachment.document_ir_key = (
                f"{attachment.owner_id}/{attachment.id}/document-ir.json"
            )
            await storage.put_bytes(
                attachment.derived_bucket,
                attachment.document_ir_key,
                encoded_ir,
                "application/json",
            )
        if thumbnail is not None:
            attachment.thumbnail_key = f"{attachment.owner_id}/{attachment.id}/thumbnail.webp"
            await storage.put_bytes(
                attachment.derived_bucket,
                attachment.thumbnail_key,
                thumbnail,
                "image/webp",
            )
        try:
            preview = await render_preview_pdf(
                content,
                attachment.content_type,
                attachment.filename,
                settings,
            )
        except Exception as error:
            attachment.processing_metadata = {
                **attachment.processing_metadata,
                "renderer": {"status": "failed", "error": str(error)[:1000]},
            }
            preview = None
        if preview is not None:
            attachment.preview_key = f"{attachment.owner_id}/{attachment.id}/preview.pdf"
            await storage.put_bytes(
                attachment.derived_bucket,
                attachment.preview_key,
                preview,
                "application/pdf",
            )
            attachment.processing_metadata = {
                **attachment.processing_metadata,
                "renderer": {"status": "ready", "engine": "gotenberg"},
            }
        attachment.parse_status = (
            "ready"
            if understanding.text is not None
            or understanding.document_ir is not None
            or thumbnail is not None
            or preview is not None
            else "unsupported"
        )
        attachment.parse_error = None
        await db.commit()


@register_job("chat.assist")
async def answer_chat_mention(payload: dict) -> None:
    """两个人在私聊里 @ 了宠物，后台答一句（chat_assist 模块开头有设计说明）。

    **为什么走后台**：模型要十几秒，而这段时间原本是卡在「发消息」那个请求里的
    ——用户敲完回车，自己的话要等宠物想完才出现在屏幕上。发消息必须是即时的，
    所以这里只排队，答案回来后写成插话并发一条 SSE，两边的界面自然刷出来。
    """
    settings = get_settings()
    model = build_chat_model(settings, role=AgentRole.ASSIST)
    # 带工具的 Agent：站内只读 + 联网查，一个写操作都没有（见 roles.ASSIST_TOOLS）。
    # checkpointer 传 None——每次 @ 都是独立的一问一答，不需要跨轮历史，
    # 也就不该和用户的对话线程共用 checkpoint。
    agent = build_agent(model, None, session_factory, role=AgentRole.ASSIST)
    await handle_chat_assist(payload, model, session_factory, agent=agent)


async def handle_chat_assist(
    payload: dict,
    model: Any,
    maker: async_sessionmaker[AsyncSession],
    agent: Any = None,
) -> None:
    from app.agent_context import AgentContext
    from app.chat_assist import ASSIST_KIND, answer, answer_with_tools, prepare
    from app.models import OutboxEvent
    from app.pet_mediation import record_interjection
    from app.pet_state import resolve_pet

    asker_id = str(payload["user_id"])
    partner_id = str(payload["partner_id"])
    message_id = str(payload["message_id"])
    pet_name = str(payload.get("pet_name") or "")
    body = str(payload.get("body") or "")

    async with maker() as db:
        asker = await db.get(User, asker_id)
        if asker is None:
            return
        request = await prepare(db, asker, partner_id, pet_name, body)
        companion, _ = await resolve_pet(db, asker_id)
        assembled = await ContextAssembler(
            MemoryService(UnavailableEmbeddingProvider(1024))
        ).assemble(
            db,
            asker_id,
            companion.id,
            query=request.question,
            role="assist",
            limit=6,
        )

        if agent is not None:
            await db.commit()
            context = AgentContext(
                user_id=asker_id,
                # 不挂在任何真实对话上：这一问一答不属于用户的对话本。
                # 必须是 None 而不是编一个 id——工具审计会把它写进 ToolRun 的
                # 外键列，不存在的 id 会让整轮回答在提交时炸掉（而且是被
                # answer_with_tools 的 except 吞掉，表现成「宠物不吭声」）。
                conversation_id=None,
                companion_id=companion.id,
                persona_name=pet_name,
                persona_prompt="",
                user_profile={},
                conversation_summary="",
                memory_context=assembled.memory_context,
                page_context=assembled.page,
                active_task=assembled.active_task,
                memory_ids=[item.id for item in assembled.memories],
            )
            reply = await answer_with_tools(agent, request, pet_name, context)
        else:
            reply = await answer(model, request, pet_name)
        if not reply:
            return
        # 问题是在双人聊天里问的，答案两个人都该看到——插话按 audience 存，
        # 所以两边各写一条。
        # 说话的是**被 @ 的那只**，也就是提问者自己的宠物。两条记录挂同一个
        # companion_id，所以两个人屏幕上看到的署名一致——「@ 谁就是谁在答」。
        for audience in (asker_id, partner_id):
            await record_interjection(
                db, audience, ASSIST_KIND, reply, message_id, companion_id=companion.id
            )
        # 复用既有的 chat.message 通道让两边刷新。不带正文：SSE 是广播给所有
        # 连接的，内容只该由收件人自己去拉（与 send_direct_message 同一条规矩）。
        db.add(
            OutboxEvent(
                topic="chat.message",
                aggregate_type="petInterjection",
                aggregate_id=message_id,
                payload={
                    "messageId": message_id,
                    "senderId": asker_id,
                    "recipientId": partner_id,
                    "hasAttachments": False,
                },
            )
        )
        await db.commit()


@procrastinate_app.periodic(cron="41 3 * * *")
@procrastinate_app.task(name="workspace.cleanup", queue="companion")
async def cleanup_workspace(timestamp: int) -> None:
    """清掉工作区里的过期文件。

    工作区是草稿纸不是仓库：分析完的中间文件留着，只会让下一次分析读到过期
    数据，而且悄无声息。保留期见 WORKSPACE_RETENTION_DAYS。

    清理动作发在 skill-worker 上——那个卷只挂在它那儿，API 容器根本看不到。
    """
    del timestamp
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{settings.skill_worker_url.rstrip('/')}/workspace/cleanup",
                headers={"X-Skill-Worker-Token": settings.skill_worker_token},
            )
            response.raise_for_status()
            removed = response.json().get("removed", [])
    except Exception:
        # 清理失败不该让 worker 崩，下一次定时还会再来
        logger.exception("工作区清理失败")
        return
    if removed:
        logger.info("工作区清理了 %s 个过期文件", len(removed))
