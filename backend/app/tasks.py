import json
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from sqlalchemy import select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.agent_runtime import build_chat_model
from app.attachment_processing import extract_text, thumbnail_webp
from app.config import get_settings
from app.db import session_factory
from app.embeddings import OpenAICompatibleEmbeddingProvider
from app.memory import MemoryService
from app.models import (
    Attachment,
    ChatMessage,
    Conversation,
    ConversationSummary,
    MemoryItem,
    UserProfile,
)
from app.queue import register_job
from app.schemas import MemoryCreate
from app.storage import ObjectStorage


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
