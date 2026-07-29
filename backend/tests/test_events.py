import json

import pytest

from app.events import encode_sse, stream_outbox
from app.models import OutboxEvent


def test_sse_encoding_preserves_event_contract():
    event = OutboxEvent(
        id="event123",
        topic="resource.changed",
        aggregate_type="memo",
        aggregate_id="memo123",
        payload={"resource": "memo", "action": "created", "id": "memo123"},
    )
    encoded = encode_sse(event)
    assert "id: event123\n" in encoded
    assert "event: resource.changed\n" in encoded
    data = encoded.split("data: ", 1)[1].strip()
    assert json.loads(data)["id"] == "memo123"


@pytest.mark.asyncio
async def test_new_sse_connection_skips_history_and_emits_future_events(session_maker):
    async with session_maker() as db:
        db.add(
            OutboxEvent(
                topic="resource.changed",
                aggregate_type="memo",
                aggregate_id="old",
                payload={"resource": "memo", "action": "created", "id": "old"},
            )
        )
        await db.commit()

    stream = stream_outbox(session_maker, poll_seconds=0)
    assert await anext(stream) == ": keep-alive\n\n"

    async with session_maker() as db:
        db.add(
            OutboxEvent(
                topic="resource.changed",
                aggregate_type="memo",
                aggregate_id="new",
                payload={"resource": "memo", "action": "created", "id": "new"},
            )
        )
        await db.commit()

    assert '"id":"new"' in await anext(stream)
    await stream.aclose()


@pytest.mark.asyncio
async def test_expired_sse_cursor_starts_at_current_tail(session_maker):
    async with session_maker() as db:
        db.add(
            OutboxEvent(
                topic="resource.changed",
                aggregate_type="memo",
                aggregate_id="old",
                payload={"id": "old"},
            )
        )
        await db.commit()

    stream = stream_outbox(
        session_maker,
        poll_seconds=0,
        last_event_id="expired-event",
    )

    assert await anext(stream) == ": keep-alive\n\n"
    await stream.aclose()
