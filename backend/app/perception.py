"""Deterministic site perception with a strict privacy boundary.

Page adapters send compact semantics, never DOM dumps, free-form drafts, local paths,
credentials, or command output. Model-facing agents only read this normalized layer.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.couple_space import ensure_space
from app.models import (
    Companion,
    Conversation,
    PerceptionEvent,
    PerceptionSession,
    utcnow,
)
from app.schemas import PerceptionEventWrite, PerceptionSessionWrite

SESSION_TTL = timedelta(minutes=2)

ROUTE_KINDS = {
    "/": "home",
    "/timeline": "timeline",
    "/gallery": "gallery",
    "/plan": "plan",
    "/chat": "direct_chat",
    "/guestbook": "guestbook",
    "/companion": "companion",
    "/settings": "settings",
    "/desktop-pet": "desktop_pet",
}
PRIVATE_ROUTES = ("/admin", "/verify")
CONTEXT_KEYS = frozenset(
    {
        "pageTitle",
        "section",
        "focusedEntity",
        "selectedEntity",
        "visibleEntities",
        "activeTask",
        "filters",
        "counts",
        "interactionMode",
    }
)
ENTITY_KEYS = frozenset({"id", "type", "label", "status"})
FORBIDDEN_KEYS = (
    "path",
    "directory",
    "workspace",
    "authorization",
    "credential",
    "password",
    "secret",
    "token",
    "command",
    "stdout",
    "stderr",
    "body",
    "content",
    "draft",
)


def route_kind(route: str) -> str:
    normalized = "/" + route.strip().split("?", 1)[0].strip("/")
    if normalized == "/":
        return "home"
    for prefix, kind in ROUTE_KINDS.items():
        if prefix != "/" and normalized.startswith(prefix):
            return kind
    return "site"


def _short(value: Any, limit: int = 160) -> str | None:
    if not isinstance(value, (str, int, float, bool)):
        return None
    text = str(value).strip()
    return text[:limit] if text else None


def _entity(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {key: safe for key in ENTITY_KEYS if (safe := _short(value.get(key), 120)) is not None}


def sanitize_page_context(route: str, raw: dict[str, Any]) -> dict[str, Any]:
    if route.startswith(PRIVATE_ROUTES):
        return {}
    clean: dict[str, Any] = {}
    for key in CONTEXT_KEYS:
        value = raw.get(key)
        if key in {"focusedEntity", "selectedEntity"}:
            entity = _entity(value)
            if entity:
                clean[key] = entity
        elif key == "visibleEntities" and isinstance(value, list):
            entities = [_entity(item) for item in value[:20]]
            clean[key] = [item for item in entities if item]
        elif key in {"filters", "counts"} and isinstance(value, dict):
            clean[key] = {
                str(child_key)[:40]: safe
                for child_key, child_value in list(value.items())[:20]
                if not any(term in str(child_key).lower() for term in FORBIDDEN_KEYS)
                if (safe := _short(child_value, 80)) is not None
            }
        elif (safe := _short(value)) is not None:
            clean[key] = safe
    return clean


def sanitize_event_data(raw: dict[str, Any]) -> dict[str, Any]:
    clean: dict[str, Any] = {}
    for key, value in list(raw.items())[:30]:
        normalized = str(key).lower()
        if any(term in normalized for term in FORBIDDEN_KEYS):
            continue
        if isinstance(value, dict):
            nested = _entity(value)
            if nested:
                clean[str(key)[:60]] = nested
        elif isinstance(value, list):
            values = [safe for item in value[:20] if (safe := _short(item, 100))]
            if values:
                clean[str(key)[:60]] = values
        elif (safe := _short(value, 160)) is not None:
            clean[str(key)[:60]] = safe
    return clean


async def upsert_session(
    db: AsyncSession,
    user_id: str,
    data: PerceptionSessionWrite,
) -> PerceptionSession:
    space = await ensure_space(db, user_id)
    route = data.route.split("?", 1)[0][:255] or "/"
    page_context = sanitize_page_context(route, data.page_context)
    active_conversation_id = data.active_conversation_id
    if active_conversation_id:
        conversation = await db.get(Conversation, active_conversation_id)
        if (
            conversation is None
            or conversation.user_id != user_id
            or conversation.space_id != space.id
        ):
            active_conversation_id = None

    now = utcnow()
    session = await db.scalar(
        select(PerceptionSession).where(
            PerceptionSession.user_id == user_id,
            PerceptionSession.device_session_id == data.device_session_id,
            PerceptionSession.surface == data.surface,
        )
    )
    if session is None:
        # **revision 必须在这里显式给。**
        #
        # 列上的 `default=1` 是 SQLAlchemy 在 INSERT 时填的，不是构造对象时——
        # 新对象在落库之前 `session.revision` 一直是 None，于是下面那句
        # `max(session.revision, data.revision)` 抛
        # `'>' not supported between 'int' and 'NoneType'`，整个请求 500。
        #
        # 它看起来时灵时不灵，是因为下面 `if data.foreground:` 那条 `db.execute`
        # 会触发 autoflush，顺带把这条 INSERT 冲下去、revision 被填上 1。
        # 也就是说：**前台上报的新会话正常，后台上报的新会话必炸**——而桌宠窗口
        # 和压在底层的主窗口恰好都是后台。
        session = PerceptionSession(
            space_id=space.id,
            user_id=user_id,
            surface=data.surface,
            device_session_id=data.device_session_id,
            revision=data.revision,
            expires_at=now + SESSION_TTL,
        )
        db.add(session)
    elif data.revision < session.revision:
        session.last_seen_at = now
        session.expires_at = now + SESSION_TTL
        await db.commit()
        await db.refresh(session)
        return session

    if data.foreground:
        await db.execute(
            update(PerceptionSession)
            .where(
                PerceptionSession.user_id == user_id,
                PerceptionSession.id != session.id,
            )
            .values(foreground=False)
        )
    session.route = route
    session.page_kind = route_kind(route)
    session.page_context = page_context
    session.active_conversation_id = active_conversation_id
    session.foreground = data.foreground
    session.revision = max(session.revision, data.revision)
    session.last_seen_at = now
    session.expires_at = now + SESSION_TTL
    await db.commit()
    await db.refresh(session)
    return session


async def current_session(
    db: AsyncSession,
    user_id: str,
) -> PerceptionSession | None:
    return await db.scalar(
        select(PerceptionSession)
        .where(
            PerceptionSession.user_id == user_id,
            PerceptionSession.expires_at > utcnow(),
        )
        .order_by(
            PerceptionSession.foreground.desc(),
            PerceptionSession.last_seen_at.desc(),
        )
        .limit(1)
    )


async def record_event(
    db: AsyncSession,
    user_id: str,
    data: PerceptionEventWrite,
) -> PerceptionEvent:
    space = await ensure_space(db, user_id)
    existing = await db.scalar(
        select(PerceptionEvent).where(PerceptionEvent.dedupe_key == data.dedupe_key)
    )
    if existing is not None:
        if existing.space_id != space.id:
            raise ValueError("感知事件去重键冲突")
        return existing
    companion_id = await db.scalar(
        select(Companion.id)
        .where(Companion.owner_id == user_id)
        .order_by(Companion.created_at)
        .limit(1)
    )
    event = PerceptionEvent(
        space_id=space.id,
        actor_user_id=user_id,
        companion_id=companion_id,
        source=data.source,
        type=data.type,
        subject_type=data.subject_type,
        subject_id=data.subject_id,
        occurred_at=data.occurred_at or utcnow(),
        observed_at=utcnow(),
        data=sanitize_event_data(data.data),
        sensitivity=data.sensitivity,
        retention=data.retention,
        correlation_id=data.correlation_id,
        causation_id=data.causation_id,
        dedupe_key=data.dedupe_key,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event
