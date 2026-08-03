from datetime import date, datetime
from typing import Any

from langchain.tools import ToolRuntime, tool
from pydantic import BaseModel
from sqlalchemy import inspect, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.couple_space import ensure_space
from app.embeddings import UnavailableEmbeddingProvider
from app.future_letters import redact as redact_letter
from app.memory import MemoryService
from app.models import (
    ActionReceipt,
    DailyAnswer,
    DailyQuestion,
    EventTimer,
    FutureLetter,
    Message,
    Milestone,
    MoodEntry,
    OutboxEvent,
    Plan,
    Wish,
    utcnow,
)
from app.moods import describe as describe_mood
from app.pet_state import resolve_pet
from app.photo_service import PhotoService
from app.schemas import (
    MemoryCorrect,
    MemoryCreate,
    MessageCreate,
    MessageUpdate,
    MilestoneCreate,
    MilestoneUpdate,
    PhotoCreate,
    PhotoUpdate,
    PlanCreate,
    PlanUpdate,
    TimerCreate,
    TimerUpdate,
    WishCreate,
    WishUpdate,
)
from app.services import CrudService

ResourceDefinition = tuple[type, type[BaseModel], type[BaseModel]]
RESOURCE_DEFINITIONS: dict[str, ResourceDefinition] = {
    "plan": (Plan, PlanCreate, PlanUpdate),
    "wish": (Wish, WishCreate, WishUpdate),
    "milestone": (Milestone, MilestoneCreate, MilestoneUpdate),
    "message": (Message, MessageCreate, MessageUpdate),
    "timer": (EventTimer, TimerCreate, TimerUpdate),
}

#: 只能读、不能由 Agent 写的资源。
#:
#: 它们各自有不能绕过的规则，而通用 CRUD 工厂不认识这些规则：
#: - `mood` 是一人一天一条的打卡，替用户「填」心情是荒唐的；
#: - `letter` 的正文在解锁前根本不该出现（future_letters.redact），
#:   走通用序列化会把正文直接吐出来，等于绕过整个锁；
#: - `dailyQuestion` 的答案两人都答完才互相可见，同理。
#:
#: 所以这三样单独取数、单独脱敏，并且**只在 list 里出现**——
#: `resource_create/update/delete` 查的是 RESOURCE_DEFINITIONS，天然够不到它们。
READ_ONLY_RESOURCES = frozenset({"mood", "letter", "dailyQuestion"})

LISTABLE_RESOURCES = sorted(RESOURCE_DEFINITIONS) + ["photo"] + sorted(READ_ONLY_RESOURCES)


def serialize_model(model: Any) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for attribute in inspect(model).mapper.column_attrs:
        column = attribute.columns[0]
        value = getattr(model, attribute.key)
        if isinstance(value, (date, datetime)):
            value = value.isoformat()
        result[column.name] = value
    return result


async def read_only_resource(db: AsyncSession, resource: str) -> list[dict[str, Any]]:
    """取那三样有额外规则的资源，**规则在这里重新执行一遍**。

    绝不能图省事直接 serialize_model：未来情书的正文在解锁前不该存在于任何
    响应里，每日一问的答案要两人都答完才互相可见。这两条锁写在各自的服务层，
    绕过它们等于这个工具成了后门——模型问一句就能读到锁着的信。
    """
    if resource == "mood":
        rows = list(await db.scalars(select(MoodEntry).order_by(MoodEntry.date.desc()).limit(60)))
        return [
            {
                "userId": row.user_id,
                "date": row.date,
                "mood": row.mood,
                "moodLabel": describe_mood(row.mood),
                "note": row.note,
            }
            for row in rows
        ]

    if resource == "letter":
        rows = list(
            await db.scalars(select(FutureLetter).order_by(FutureLetter.unlock_at).limit(60))
        )
        # redact 是那个锁的唯一出口，这里必须走它
        return [
            {
                "id": view.id,
                "authorId": view.author_id,
                "unlockAt": view.unlock_at.isoformat(),
                "unlocked": view.unlocked,
                "openedAt": view.opened_at.isoformat() if view.opened_at else None,
                "body": view.body,
            }
            for view in (redact_letter(row) for row in rows)
        ]

    # dailyQuestion：题目本身随便看，答案要两人都答完
    questions = list(
        await db.scalars(select(DailyQuestion).order_by(DailyQuestion.date.desc()).limit(30))
    )
    result: list[dict[str, Any]] = []
    for question in questions:
        answers = list(
            await db.scalars(select(DailyAnswer).where(DailyAnswer.question_id == question.id))
        )
        revealed = len(answers) >= 2
        result.append(
            {
                "date": question.date,
                "prompt": question.prompt,
                "category": question.category,
                "bothAnswered": revealed,
                "answers": (
                    [{"userId": answer.user_id, "body": answer.body} for answer in answers]
                    if revealed
                    # 没揭晓时连是谁答的都不给：知道「只有一个人答了」没问题，
                    # 但那个人是谁本身就是信息。
                    else []
                ),
            }
        )
    return result


def build_domain_tools(session_maker: async_sessionmaker[AsyncSession]) -> list:
    memory = MemoryService(UnavailableEmbeddingProvider(1024))

    async def committed_receipt(
        db: AsyncSession,
        runtime: ToolRuntime,
        action_type: str,
        resource_type: str,
        resource_id: str | None,
        safe_summary: str,
    ) -> dict[str, Any]:
        space = await ensure_space(db, runtime.context.user_id)
        receipt = ActionReceipt(
            space_id=space.id,
            user_id=runtime.context.user_id,
            conversation_id=runtime.context.conversation_id,
            source_message_id=runtime.context.source_message_id,
            action_type=action_type,
            resource_type=resource_type,
            resource_id=resource_id,
            status="committed",
            safe_summary=safe_summary,
            committed_at=utcnow(),
        )
        db.add(receipt)
        await db.commit()
        await db.refresh(receipt)
        return serialize_model(receipt)

    def definition(resource: str) -> ResourceDefinition:
        if resource not in RESOURCE_DEFINITIONS:
            raise ValueError(f"不支持的资源：{resource}")
        return RESOURCE_DEFINITIONS[resource]

    @tool("site_resource_list")
    async def resource_list(resource: str, runtime: ToolRuntime) -> list[dict[str, Any]]:
        """查询站内资源。

        resource 可选：plan（计划）/ wish（心愿）/ photo（照片）/
        milestone（故事线上的事，可能带地点坐标）/ message（留言板）/ timer（纪念日倒计时）/
        mood（心情打卡）/ letter（未来情书）/
        dailyQuestion（每日一问）。
        """
        async with session_maker() as db:
            if resource == "photo":
                return [
                    item.model_dump(by_alias=True, mode="json")
                    for item in await PhotoService().list(db)
                ]
            if resource in READ_ONLY_RESOURCES:
                return await read_only_resource(db, resource)
            model, _, _ = definition(resource)
            return [
                serialize_model(entity) for entity in await CrudService(model, resource).list(db)
            ]

    @tool("site_resource_create")
    async def resource_create(
        resource: str,
        payload: dict[str, Any],
        runtime: ToolRuntime,
    ) -> dict[str, Any]:
        """新增站内资源，payload 使用对应网页 API 的 camelCase 字段。"""
        async with session_maker() as db:
            if resource == "photo":
                result = await PhotoService().create(
                    db,
                    runtime.context.user_id,
                    PhotoCreate.model_validate(payload),
                    commit=False,
                )
                serialized = result.model_dump(by_alias=True, mode="json")
                receipt = await committed_receipt(
                    db,
                    runtime,
                    "resource.create",
                    resource,
                    result.id,
                    f"已创建照片：{result.caption[:80]}",
                )
                return {"resource": serialized, "actionReceipt": receipt}
            model, create_schema, _ = definition(resource)
            data = create_schema.model_validate(payload)
            entity = await CrudService(model, resource).create(
                db,
                data,
                created_by=runtime.context.user_id,
                created_by_companion=runtime.context.companion_id,
                commit=False,
            )
            serialized = serialize_model(entity)
            receipt = await committed_receipt(
                db,
                runtime,
                "resource.create",
                resource,
                entity.id,
                "已创建"
                f"{resource}："
                f"{str(serialized.get('title') or serialized.get('content') or entity.id)[:80]}",
            )
            return {"resource": serialized, "actionReceipt": receipt}

    @tool("site_resource_update")
    async def resource_update(
        resource: str,
        entity_id: str,
        payload: dict[str, Any],
        runtime: ToolRuntime,
    ) -> dict[str, Any]:
        """修改站内资源。只传需要修改的字段。"""
        async with session_maker() as db:
            if resource == "photo":
                result = await PhotoService().update(
                    db,
                    entity_id,
                    PhotoUpdate.model_validate(payload),
                    commit=False,
                )
                serialized = result.model_dump(by_alias=True, mode="json")
                receipt = await committed_receipt(
                    db,
                    runtime,
                    "resource.update",
                    resource,
                    entity_id,
                    "已修改照片",
                )
                return {"resource": serialized, "actionReceipt": receipt}
            model, _, update_schema = definition(resource)
            data = update_schema.model_validate(payload)
            entity = await CrudService(model, resource).update(db, entity_id, data, commit=False)
            serialized = serialize_model(entity)
            receipt = await committed_receipt(
                db,
                runtime,
                "resource.update",
                resource,
                entity_id,
                f"已修改{resource}",
            )
            return {"resource": serialized, "actionReceipt": receipt}

    @tool("site_resource_delete")
    async def resource_delete(
        resource: str,
        entity_id: str,
        runtime: ToolRuntime,
    ) -> dict[str, Any]:
        """删除指定站内资源。"""
        async with session_maker() as db:
            if resource == "photo":
                await PhotoService().delete(db, entity_id, commit=False)
            else:
                model, _, _ = definition(resource)
                await CrudService(model, resource).delete(db, entity_id, commit=False)
            receipt = await committed_receipt(
                db,
                runtime,
                "resource.delete",
                resource,
                entity_id,
                f"已删除{resource}",
            )
        return {
            "resource": {"id": entity_id, "status": "deleted"},
            "actionReceipt": receipt,
        }

    @tool("memory_upsert")
    async def memory_upsert(
        content: str,
        memory_type: str,
        visibility: str,
        runtime: ToolRuntime,
        importance: int = 70,
    ) -> dict[str, Any]:
        """明确记住长期事实/偏好/约定。不要用它代替计划、心愿或文档工具。"""

        companion_id = (
            runtime.context.companion_id if visibility == "companion_relationship" else None
        )
        async with session_maker() as db:
            item, receipt = await memory.create_with_receipt(
                db,
                runtime.context.user_id,
                MemoryCreate(
                    visibility=visibility,
                    memory_type=memory_type,
                    content=content,
                    importance=importance,
                    companion_id=companion_id,
                    subject_type=(
                        "companion"
                        if visibility == "companion_relationship"
                        else "couple"
                        if visibility == "couple_shared"
                        else "user"
                    ),
                    subject_id=(
                        companion_id
                        if visibility == "companion_relationship"
                        else runtime.context.user_id
                        if visibility == "user_private"
                        else None
                    ),
                    source_type="chat_message",
                    source_ids=(
                        [runtime.context.source_message_id]
                        if runtime.context.source_message_id
                        else []
                    ),
                    source_excerpt=content,
                ),
                conversation_id=runtime.context.conversation_id,
                source_message_id=runtime.context.source_message_id,
            )
            return {
                "memory": serialize_model(item),
                "actionReceipt": serialize_model(receipt),
            }

    @tool("memory_correct")
    async def memory_correct(
        memory_id: str,
        content: str,
        runtime: ToolRuntime,
        reason: str = "用户纠正",
    ) -> dict[str, Any]:
        """纠正一条现有长期记忆，保留旧值和修订历史。"""

        async with session_maker() as db:
            item, receipt = await memory.correct(
                db,
                runtime.context.user_id,
                memory_id,
                MemoryCorrect(content=content, reason=reason),
            )
            return {
                "memory": serialize_model(item),
                "actionReceipt": serialize_model(receipt),
            }

    @tool("memory_retract")
    async def memory_retract(
        memory_id: str,
        runtime: ToolRuntime,
        reason: str = "用户要求忘记",
    ) -> dict[str, Any]:
        """删除/忘记一条长期记忆，并立即停止检索。"""

        async with session_maker() as db:
            item, receipt = await memory.retract(
                db,
                runtime.context.user_id,
                memory_id,
                reason=reason,
            )
            return {
                "memory": serialize_model(item),
                "actionReceipt": serialize_model(receipt),
            }

    @tool("site_pet_action")
    async def pet_action(
        runtime: ToolRuntime,
        action: str,
        animation: str = "idle",
        message: str | None = None,
        duration: int = 1800,
    ) -> dict[str, Any]:
        """让桌面宠物执行动作；duration 为毫秒。"""
        async with session_maker() as db:
            # 改造前这里读全站单例 Pet，两个用户共用一只。现在按调用方
            # 上下文里的伴侣解析，各自的宠物各自动。
            _, profile = await resolve_pet(db, runtime.context.user_id)
            payload = {
                "action": action,
                "animation": animation,
                "assetId": profile.body_asset_id,
                "message": message,
                "duration": duration,
            }
            db.add(
                OutboxEvent(
                    topic="pet.action",
                    aggregate_type="pet",
                    aggregate_id=profile.companion_id,
                    payload=payload,
                )
            )
            await db.commit()
            return payload

    return [
        resource_list,
        resource_create,
        resource_update,
        resource_delete,
        memory_upsert,
        memory_correct,
        memory_retract,
        pet_action,
    ]
