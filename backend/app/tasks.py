import json
import logging
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from sqlalchemy import select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.agents.conversation import build_chat_model
from app.agents.reflection import ReflectionAgent, companions_with_pending
from app.agents.roles import AgentRole
from app.anniversaries import scan_anniversaries
from app.attachment_processing import extract_text, thumbnail_webp
from app.config import get_settings
from app.db import session_factory
from app.embeddings import OpenAICompatibleEmbeddingProvider
from app.memory import MemoryService
from app.models import (
    Attachment,
    ChatMessage,
    Companion,
    Conversation,
    ConversationSummary,
    MemoryItem,
    User,
    UserProfile,
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
        return "".join(
            block.get("text", "")
            for block in content
            if isinstance(block, dict)
        )
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
        messages = list(
            await db.scalars(query)
        )
        previous_summary = summary.summary if summary else ""
    if not messages:
        return
    transcript = "\n".join(
        f"{message.role}: {message.content}" for message in messages
    )
    prompt = (
        f"现有摘要：\n{previous_summary or '暂无'}\n\n"
        f"新增对话：\n{transcript}"
    )
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
    transcript = "\n".join(
        f"{message.role}: {message.content}" for message in reversed(messages)
    )
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
        messages = list(
            await db.scalars(
                select(ChatMessage)
                .where(ChatMessage.conversation_id == conversation_id)
                .order_by(ChatMessage.created_at.desc())
                .limit(12)
            )
        )
        conversation = await db.get(Conversation, conversation_id)
    if not messages or conversation is None:
        return
    transcript = "\n".join(
        f"{message.role}: {message.content}" for message in reversed(messages)
    )
    response = await model.ainvoke(
        [
            SystemMessage(
                content=(
                    "从对话提取值得长期记住的稳定事实。仅输出 JSON 数组，"
                    "元素格式为 {kind,content,importance}；没有则输出 []。"
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
    async with maker() as db:
        for candidate in candidates[:10]:
            if not isinstance(candidate, dict) or not candidate.get("content"):
                continue
            item = await memory.create(
                db,
                user_id,
                MemoryCreate(
                    scope="owner",
                    companion_id=conversation.companion_id,
                    kind=str(candidate.get("kind", "fact"))[:40],
                    content=str(candidate["content"]),
                    importance=_importance(candidate.get("importance", 50)),
                    source_message_ids=[message.id for message in messages],
                ),
                embed=False,
            )
            await memory.embed_item(db, item)
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


@procrastinate_app.periodic(cron="7 1 * * *")
@procrastinate_app.task(name="anniversary.scan", queue="companion")
async def scan_anniversaries_daily(timestamp: int) -> None:
    """每天扫一遍纪念日，到点的写成待表达事件（计划文档 §2.2）。

    凌晨 1:07 跑：那时候不会和用户抢，写下的事件等人回到站上自然会被念出来。
    不直接推送——事件要经过宠物的打扰预算，才不会绕开安静模式。
    """
    del timestamp
    async with session_factory() as db:
        written = await scan_anniversaries(db)
    if written:
        logger.info("今日纪念日提醒：%s", "；".join(written))


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
        item = await db.get(MemoryItem, str(payload["memory_id"]))
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
            extracted = extract_text(
                content,
                attachment.content_type,
                attachment.filename,
                max_chars=settings.attachment_extracted_text_chars,
                max_pdf_pages=settings.attachment_max_pdf_pages,
                max_office_uncompressed_bytes=(
                    settings.attachment_max_office_uncompressed_bytes
                ),
                max_workbook_sheets=settings.attachment_max_workbook_sheets,
                max_workbook_rows=settings.attachment_max_workbook_rows,
                max_workbook_cells=settings.attachment_max_workbook_cells,
            )
            thumbnail = thumbnail_webp(content, attachment.content_type)
        except Exception as error:
            attachment.parse_status = "failed"
            attachment.parse_error = str(error)[:2000]
            await db.commit()
            return
        attachment.extracted_text = (
            extracted if extracted is not None else None
        )
        if thumbnail is not None:
            attachment.derived_bucket = settings.minio_derived_bucket
            attachment.thumbnail_key = (
                f"{attachment.owner_id}/{attachment.id}/thumbnail.webp"
            )
            await storage.put_bytes(
                attachment.derived_bucket,
                attachment.thumbnail_key,
                thumbnail,
                "image/webp",
            )
        attachment.parse_status = (
            "ready"
            if extracted is not None or thumbnail is not None
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
    await handle_chat_assist(
        payload,
        build_chat_model(get_settings()),
        session_factory,
    )


async def handle_chat_assist(
    payload: dict,
    model: Any,
    maker: async_sessionmaker[AsyncSession],
) -> None:
    from app.chat_assist import ASSIST_KIND, answer, prepare
    from app.models import OutboxEvent
    from app.pet_mediation import record_interjection

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
        reply = await answer(model, request, pet_name)
        if not reply:
            return
        # 问题是在双人聊天里问的，答案两个人都该看到——插话按 audience 存，
        # 所以两边各写一条。
        for audience in (asker_id, partner_id):
            await record_interjection(db, audience, ASSIST_KIND, reply, message_id)
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
