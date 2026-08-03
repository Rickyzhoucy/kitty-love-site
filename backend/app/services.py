from typing import Any

from fastapi import HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Base, OutboxEvent


class CrudService[ModelT: Base]:
    def __init__(self, model: type[ModelT], resource: str):
        self.model = model
        self.resource = resource

    async def list(self, db: AsyncSession, limit: int = 500) -> list[ModelT]:
        result = await db.scalars(
            select(self.model).order_by(self.model.created_at.desc()).limit(max(1, min(limit, 500)))
        )
        return list(result)

    async def get(self, db: AsyncSession, entity_id: str) -> ModelT:
        entity = await db.get(self.model, entity_id)
        if entity is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"{self.resource} 不存在")
        return entity

    async def create(
        self,
        db: AsyncSession,
        data: BaseModel,
        created_by: str | None = None,
        created_by_companion: str | None = None,
        *,
        commit: bool = True,
    ) -> ModelT:
        values = data.model_dump()
        if hasattr(self.model, "created_by"):
            values["created_by"] = created_by
            values["created_by_companion"] = created_by_companion
        entity = self.model(**values)
        db.add(entity)
        await db.flush()
        await self._event(db, entity.id, "created")
        if commit:
            await db.commit()
            await db.refresh(entity)
        return entity

    async def update(
        self,
        db: AsyncSession,
        entity_id: str,
        data: BaseModel,
        *,
        commit: bool = True,
    ) -> ModelT:
        entity = await self.get(db, entity_id)
        changes: dict[str, Any] = data.model_dump(exclude_unset=True)
        for key, value in changes.items():
            setattr(entity, key, value)
        await self._event(db, entity.id, "updated")
        if commit:
            await db.commit()
            await db.refresh(entity)
        return entity

    async def delete(
        self,
        db: AsyncSession,
        entity_id: str,
        *,
        commit: bool = True,
    ) -> None:
        entity = await self.get(db, entity_id)
        await db.delete(entity)
        await self._event(db, entity_id, "deleted")
        if commit:
            await db.commit()

    async def _event(self, db: AsyncSession, entity_id: str, action: str) -> None:
        event = OutboxEvent(
            topic="resource.changed",
            aggregate_type=self.resource,
            aggregate_id=entity_id,
            payload={"resource": self.resource, "action": action, "id": entity_id},
        )
        db.add(event)
