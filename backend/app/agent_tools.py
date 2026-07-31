from datetime import date, datetime
from typing import Any

from langchain.tools import ToolRuntime, tool
from pydantic import BaseModel
from sqlalchemy import inspect, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.future_letters import redact as redact_letter
from app.models import (
    DailyAnswer,
    DailyQuestion,
    EventTimer,
    FutureLetter,
    MapPin,
    Message,
    Milestone,
    MoodEntry,
    OutboxEvent,
    Plan,
    Wish,
)
from app.moods import describe as describe_mood
from app.pet_state import resolve_pet
from app.photo_service import PhotoService
from app.schemas import (
    MapPinCreate,
    MapPinUpdate,
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
    "mapPin": (MapPin, MapPinCreate, MapPinUpdate),
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

LISTABLE_RESOURCES = (
    sorted(RESOURCE_DEFINITIONS) + ["photo"] + sorted(READ_ONLY_RESOURCES)
)


def serialize_model(model: Any) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for attribute in inspect(model).mapper.column_attrs:
        column = attribute.columns[0]
        value = getattr(model, attribute.key)
        if isinstance(value, (date, datetime)):
            value = value.isoformat()
        result[column.name] = value
    return result


async def read_only_resource(
    db: AsyncSession, resource: str
) -> list[dict[str, Any]]:
    """取那三样有额外规则的资源，**规则在这里重新执行一遍**。

    绝不能图省事直接 serialize_model：未来情书的正文在解锁前不该存在于任何
    响应里，每日一问的答案要两人都答完才互相可见。这两条锁写在各自的服务层，
    绕过它们等于这个工具成了后门——模型问一句就能读到锁着的信。
    """
    if resource == "mood":
        rows = list(
            await db.scalars(
                select(MoodEntry).order_by(MoodEntry.date.desc()).limit(60)
            )
        )
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
            await db.scalars(
                select(FutureLetter).order_by(FutureLetter.unlock_at).limit(60)
            )
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
        await db.scalars(
            select(DailyQuestion).order_by(DailyQuestion.date.desc()).limit(30)
        )
    )
    result: list[dict[str, Any]] = []
    for question in questions:
        answers = list(
            await db.scalars(
                select(DailyAnswer).where(DailyAnswer.question_id == question.id)
            )
        )
        revealed = len(answers) >= 2
        result.append(
            {
                "date": question.date,
                "prompt": question.prompt,
                "category": question.category,
                "bothAnswered": revealed,
                "answers": (
                    [
                        {"userId": answer.user_id, "body": answer.body}
                        for answer in answers
                    ]
                    if revealed
                    # 没揭晓时连是谁答的都不给：知道「只有一个人答了」没问题，
                    # 但那个人是谁本身就是信息。
                    else []
                ),
            }
        )
    return result


def build_domain_tools(session_maker: async_sessionmaker[AsyncSession]) -> list:
    def definition(resource: str) -> ResourceDefinition:
        if resource not in RESOURCE_DEFINITIONS:
            raise ValueError(f"不支持的资源：{resource}")
        return RESOURCE_DEFINITIONS[resource]

    @tool("site_resource_list")
    async def resource_list(
        resource: str, runtime: ToolRuntime
    ) -> list[dict[str, Any]]:
        """查询站内资源。

        resource 可选：plan（计划）/ wish（心愿）/ photo（照片）/
        milestone（里程碑）/ message（留言板）/ timer（纪念日倒计时）/
        mapPin（恋爱地图上的地点）/ mood（心情打卡）/ letter（未来情书）/
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
                serialize_model(entity)
                for entity in await CrudService(model, resource).list(db)
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
                )
                return result.model_dump(by_alias=True, mode="json")
            model, create_schema, _ = definition(resource)
            data = create_schema.model_validate(payload)
            entity = await CrudService(model, resource).create(
                db,
                data,
                created_by=runtime.context.user_id,
                created_by_companion=runtime.context.companion_id,
            )
            return serialize_model(entity)

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
                    db, entity_id, PhotoUpdate.model_validate(payload)
                )
                return result.model_dump(by_alias=True, mode="json")
            model, _, update_schema = definition(resource)
            data = update_schema.model_validate(payload)
            entity = await CrudService(model, resource).update(db, entity_id, data)
            return serialize_model(entity)

    @tool("site_resource_delete")
    async def resource_delete(
        resource: str,
        entity_id: str,
        runtime: ToolRuntime,
    ) -> dict[str, str]:
        """删除指定站内资源。"""
        async with session_maker() as db:
            if resource == "photo":
                await PhotoService().delete(db, entity_id)
            else:
                model, _, _ = definition(resource)
                await CrudService(model, resource).delete(db, entity_id)
        return {"id": entity_id, "status": "deleted"}

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
        pet_action,
    ]
