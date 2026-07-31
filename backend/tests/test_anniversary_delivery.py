"""纪念日提醒的**送达**环节。

改造前 `scan_anniversaries` 每天把提醒写成事件，然后没有任何代码读它——事件
安静地堆在表里，宠物一次都没念过。这组测试钉住那个缺失的消费端，以及它的两个
关键性质：送达即标记（否则天天重播），以及记忆白名单里刻意没有它。
"""

from datetime import UTC, datetime

from sqlalchemy import select

from app.agents.reflection import DELIBERATELY_FORGOTTEN, MEANINGFUL_TYPES
from app.anniversaries import ANNIVERSARY_EVENT, deliver_due
from app.models import Companion, CompanionPetEvent, OutboxEvent, User


async def _companion(session_maker) -> str:
    async with session_maker() as db:
        user = await db.scalar(select(User).limit(1))
        companion = Companion(owner_id=user.id, name="yo yo")
        db.add(companion)
        await db.commit()
        return companion.id


async def _pending_event(session_maker, companion_id: str, *, urgent: bool, text: str):
    async with session_maker() as db:
        db.add(
            CompanionPetEvent(
                companion_id=companion_id,
                type=ANNIVERSARY_EVENT,
                payload={"text": text, "urgent": urgent},
                importance=80 if urgent else 55,
            )
        )
        await db.commit()


async def test_pending_reminder_becomes_something_the_pet_says(session_maker):
    """核心：事件要变成 pet.action，前端才会让宠物开口。"""
    companion_id = await _companion(session_maker)
    await _pending_event(
        session_maker, companion_id, urgent=True, text="今天是在一起第 300 天"
    )

    async with session_maker() as db:
        delivered = await deliver_due(db)
        events = list(await db.scalars(select(OutboxEvent)))

    assert len(delivered) == 1
    assert delivered[0]["message"] == "今天是在一起第 300 天"
    assert [event.topic for event in events] == ["pet.action"]
    assert events[0].payload["message"] == "今天是在一起第 300 天"


async def test_delivery_marks_processed_so_it_does_not_repeat(session_maker):
    """不标记的话，每次扫描都会再送一遍，攒几天就变成刷屏。"""
    companion_id = await _companion(session_maker)
    await _pending_event(session_maker, companion_id, urgent=False, text="还有 7 天")

    async with session_maker() as db:
        first = await deliver_due(db)
        second = await deliver_due(db)
        event = await db.scalar(select(CompanionPetEvent))

    assert len(first) == 1
    assert second == []  # 第二次没有可送的了
    assert event.processed_at is not None


async def test_urgent_and_ahead_reminders_look_different(session_maker):
    """当天的值得庆祝一下；提前几天的说一声就够，不该同样大动静。"""
    companion_id = await _companion(session_maker)
    await _pending_event(session_maker, companion_id, urgent=True, text="就是今天")
    async with session_maker() as db:
        urgent = (await deliver_due(db))[0]

    await _pending_event(session_maker, companion_id, urgent=False, text="快到了")
    async with session_maker() as db:
        ahead = (await deliver_due(db))[0]

    assert urgent["action"] == "celebrate"
    assert ahead["action"] == "idle"
    assert urgent["duration"] > ahead["duration"]


async def test_empty_text_is_skipped_but_still_marked(session_maker):
    """脏数据不该卡住队列——念不出来就跳过，但别留着下次再试。"""
    companion_id = await _companion(session_maker)
    await _pending_event(session_maker, companion_id, urgent=False, text="")

    async with session_maker() as db:
        delivered = await deliver_due(db)
        event = await db.scalar(select(CompanionPetEvent))

    assert delivered == []
    assert event.processed_at is not None


async def test_nothing_pending_is_a_no_op(session_maker):
    async with session_maker() as db:
        assert await deliver_due(db, now=datetime.now(UTC)) == []


# ---- 记忆白名单 ----


def test_anniversaries_deliberately_do_not_become_memories():
    """日期是算出来的，不是想起来的。写成记忆，明年那条就是错的。"""
    assert ANNIVERSARY_EVENT in DELIBERATELY_FORGOTTEN
    assert ANNIVERSARY_EVENT not in MEANINGFUL_TYPES


def test_daily_question_completion_does_become_a_memory():
    """两人都答完一道题是真正的关系数据，正是该沉淀的东西。"""
    assert "dailyQuestion.completed" in MEANINGFUL_TYPES


def test_forgotten_and_meaningful_never_overlap():
    """同一个类型不能既进记忆又「刻意不进」——那说明有人改了一半。"""
    assert not (DELIBERATELY_FORGOTTEN & MEANINGFUL_TYPES)
