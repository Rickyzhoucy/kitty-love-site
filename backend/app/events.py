import asyncio
import json
from collections.abc import AsyncIterator
from datetime import timedelta

from sqlalchemy import delete, desc, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import OutboxEvent, utcnow

outbox_poll_lock = asyncio.Lock()

#: 所有 SSE 响应共用的响应头。**每一条都是必需的，不要精简。**
#:
#: `no-transform` 尤其容易被当成冗余删掉，它恰恰是最关键的一条：前端同源访问
#: 走的是 Next.js 的 rewrite 代理，而 Next 默认对 `text/*` 开 gzip。压缩层要攒
#: 够一个块才吐，于是这条流在代理后面变成「连接是开的、readyState=1、一个事件
#: 都不来」——症状不像是坏了，只像是没人说话。实测：直连 API 361ms 到达，走代理
#: 等 60 秒也收不到。`compression` 中间件唯一认的关闭开关就是 `no-transform`。
#:
#: `X-Accel-Buffering` 管的是 nginx 那一层，与上面那条是两套独立的缓冲，
#: 少给一条就会在对应的部署形态下重现同一个症状。
SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


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
