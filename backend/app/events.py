import asyncio
import json
from collections.abc import AsyncIterator
from datetime import timedelta

from sqlalchemy import delete, desc, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import OutboxEvent, utcnow

outbox_poll_lock = asyncio.Lock()


def encode_sse(event: OutboxEvent) -> str:
    data = json.dumps(event.payload, ensure_ascii=False, separators=(",", ":"))
    return f"id: {event.id}\nevent: {event.topic}\ndata: {data}\n\n"


async def stream_outbox(
    session_maker: async_sessionmaker[AsyncSession],
    poll_seconds: float,
    last_event_id: str | None = None,
    retention_days: int = 7,
) -> AsyncIterator[str]:
    cursor_created_at = None
    async with outbox_poll_lock:
        async with session_maker() as db:
            await db.execute(
                delete(OutboxEvent).where(
                    OutboxEvent.created_at < utcnow() - timedelta(days=retention_days)
                )
            )
            await db.commit()
            if last_event_id:
                previous = await db.get(OutboxEvent, last_event_id)
                cursor_created_at = previous.created_at if previous else None
            if last_event_id is None or previous is None:
                # 首次连接或游标已过期时从当前末尾继续，避免全量历史回放。
                latest = await db.scalar(
                    select(OutboxEvent)
                    .order_by(desc(OutboxEvent.created_at), desc(OutboxEvent.id))
                    .limit(1)
                )
                if latest is not None:
                    last_event_id = latest.id
                    cursor_created_at = latest.created_at

    while True:
        async with outbox_poll_lock:
            async with session_maker() as db:
                query = (
                    select(OutboxEvent)
                    .order_by(OutboxEvent.created_at, OutboxEvent.id)
                    .limit(100)
                )
                if cursor_created_at is not None and last_event_id is not None:
                    query = query.where(
                        tuple_(OutboxEvent.created_at, OutboxEvent.id)
                        > tuple_(cursor_created_at, last_event_id)
                    )
                events = list(await db.scalars(query))
        emitted = False
        for event in events:
            emitted = True
            last_event_id = event.id
            cursor_created_at = event.created_at
            yield encode_sse(event)
        if not emitted:
            yield ": keep-alive\n\n"
        await asyncio.sleep(poll_seconds)
