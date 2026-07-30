from datetime import date, datetime
from typing import Any

from langchain.tools import ToolRuntime, tool
from pydantic import BaseModel
from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import EventTimer, Message, Milestone, OutboxEvent, Plan, Wish
from app.pet_state import resolve_pet
from app.photo_service import PhotoService
from app.schemas import (
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


def serialize_model(model: Any) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for attribute in inspect(model).mapper.column_attrs:
        column = attribute.columns[0]
        value = getattr(model, attribute.key)
        if isinstance(value, (date, datetime)):
            value = value.isoformat()
        result[column.name] = value
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
        """查询站内资源。resource 为 plan/wish/photo/milestone/message/timer。"""
        async with session_maker() as db:
            if resource == "photo":
                return [
                    item.model_dump(by_alias=True, mode="json")
                    for item in await PhotoService().list(db)
                ]
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
