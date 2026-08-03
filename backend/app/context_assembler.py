"""为四类 Agent 统一组装页面、工作记忆和长期记忆。"""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.memory import MemoryService
from app.models import MemoryRecord, PerceptionEvent, PerceptionSession, utcnow
from app.runtime_config import get as get_runtime_config


@dataclass(frozen=True)
class ContextBundle:
    page: str = ""
    page_context: dict = field(default_factory=dict)
    active_conversation_id: str | None = None
    active_task: str | None = None
    recent_interactions: list[str] = field(default_factory=list)
    memories: list[MemoryRecord] = field(default_factory=list)
    memory_context: str = ""


class ContextAssembler:
    def __init__(self, memory: MemoryService):
        self.memory = memory

    async def assemble(
        self,
        db: AsyncSession,
        user_id: str,
        companion_id: str,
        *,
        query: str,
        role: str,
        limit: int = 8,
    ) -> ContextBundle:
        now = utcnow()
        session = await db.scalar(
            select(PerceptionSession)
            .where(
                PerceptionSession.user_id == user_id,
                PerceptionSession.expires_at > now,
            )
            .order_by(
                PerceptionSession.foreground.desc(),
                PerceptionSession.last_seen_at.desc(),
            )
            .limit(1)
        )
        page_context = dict(session.page_context) if session else {}
        page = session.route if session else ""
        focused = page_context.get("focusedEntity") or page_context.get("selectedEntity")
        retrieval_query = query
        if isinstance(focused, dict):
            label = focused.get("label")
            if isinstance(label, str) and label:
                retrieval_query = f"{query}\n当前页面实体：{label}"

        preference = await self.memory.preference(db, user_id)
        reference_enabled = (
            bool(await get_runtime_config(db, "memory.reference_enabled"))
            and preference.reference_enabled
        )
        retrieval_limit = min(
            limit,
            int(await get_runtime_config(db, "memory.retrieval_limit")),
        )
        memories = (
            await self.memory.search(
                db,
                user_id,
                retrieval_query,
                companion_id,
                role=role,
                limit=retrieval_limit,
            )
            if reference_enabled
            else []
        )
        memory_context = await self.memory.format_context(db, memories)
        recent = (
            list(
                await db.scalars(
                    select(PerceptionEvent.type)
                    .where(
                        PerceptionEvent.space_id == (session.space_id if session else "__none__"),
                        PerceptionEvent.retention.in_(("working", "episodic")),
                        or_(
                            PerceptionEvent.actor_user_id == user_id,
                            PerceptionEvent.actor_user_id.is_(None),
                        ),
                    )
                    .order_by(PerceptionEvent.occurred_at.desc())
                    .limit(8)
                )
            )
            if session
            else []
        )
        active_task = page_context.get("activeTask")
        if not isinstance(active_task, str):
            active_task = None
        return ContextBundle(
            page=page,
            page_context=page_context,
            active_conversation_id=session.active_conversation_id if session else None,
            active_task=active_task,
            recent_interactions=recent,
            memories=memories,
            memory_context=memory_context,
        )
