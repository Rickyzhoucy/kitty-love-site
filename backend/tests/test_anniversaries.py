"""纪念日提醒（计划文档 §2.2）。

重点在**周期与边界**：没有 recurrence 的话，加了提醒也只灵一年；
闰日和月末这些日子不处理的话，会在某些年份直接消失。
"""

from datetime import date

import pytest
from sqlalchemy import select

from app.anniversaries import (
    ANNIVERSARY_EVENT,
    due_reminders,
    next_occurrence,
    parse_date,
    scan_anniversaries,
    upcoming,
)
from app.conversations import ConversationService
from app.models import CompanionPetEvent, EventTimer, User

# ---- 日期解析 ----


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("2026-07-30", date(2026, 7, 30)),
        ("2026/07/30", date(2026, 7, 30)),
        ("2026-07-30T12:00:00+08:00", date(2026, 7, 30)),
        ("2026年07月30日", date(2026, 7, 30)),
    ],
)
def test_parse_date_accepts_the_formats_actually_in_the_data(raw, expected):
    assert parse_date(raw) == expected


def test_unparseable_date_is_skipped_not_fatal():
    """旧数据里 date 是自由文本。一条烂数据不该让整批扫描失败。"""
    assert parse_date("下周三") is None
    assert parse_date("") is None


# ---- 周期 ----


def test_one_off_anniversary_stops_after_it_passes():
    today = date(2026, 7, 30)
    assert next_occurrence(date(2026, 8, 1), "none", today) == date(2026, 8, 1)
    assert next_occurrence(date(2026, 7, 1), "none", today) is None


def test_yearly_rolls_into_next_year():
    """这是 recurrence 存在的理由：不加它，生日过完当年就永远「已过期」。"""
    today = date(2026, 7, 30)
    assert next_occurrence(date(2020, 12, 25), "yearly", today) == date(2026, 12, 25)
    # 今年的已经过了 → 滚到明年
    assert next_occurrence(date(2020, 3, 1), "yearly", today) == date(2027, 3, 1)
    # 就是今天 → 就是今天，不该跳过
    assert next_occurrence(date(2020, 7, 30), "yearly", today) == date(2026, 7, 30)


def test_leap_day_falls_back_instead_of_disappearing():
    """2 月 29 日在平年不存在。跳过整个纪念日比落到 28 日糟得多。"""
    assert next_occurrence(date(2024, 2, 29), "yearly", date(2027, 1, 1)) == date(
        2027, 2, 28
    )


def test_monthly_clamps_to_the_end_of_short_months():
    """每月 31 号在只有 30 天的月份要退到月末，否则那个月直接没有。"""
    assert next_occurrence(date(2026, 1, 31), "monthly", date(2026, 4, 1)) == date(
        2026, 4, 30
    )
    assert next_occurrence(date(2026, 1, 15), "monthly", date(2026, 4, 20)) == date(
        2026, 5, 15
    )


# ---- 触发时机 ----


def _timer(**kwargs) -> EventTimer:
    return EventTimer(
        title=kwargs.get("title", "在一起纪念日"),
        date=kwargs.get("date", "2020-08-06"),
        type="countup",
        recurrence=kwargs.get("recurrence", "yearly"),
        remind_days_before=kwargs.get("remind_days_before", [7, 1, 0]),
    )


@pytest.mark.parametrize(
    ("today", "expected_days"),
    [
        (date(2026, 7, 30), 7),   # 提前 7 天
        (date(2026, 8, 5), 1),    # 提前 1 天
        (date(2026, 8, 6), 0),    # 当天
    ],
)
def test_reminds_exactly_on_the_configured_offsets(today, expected_days):
    due = due_reminders(_timer(), today)
    assert due is not None
    assert due[1] == expected_days


@pytest.mark.parametrize("today", [date(2026, 8, 2), date(2026, 8, 4), date(2026, 8, 7)])
def test_does_not_nag_on_every_day_in_between(today):
    """只在**恰好等于**某个提前量那天提醒。

    用「小于等于」的话，设了提前 7 天就会连着念叨 8 天——那不是提醒，是骚扰。
    """
    assert due_reminders(_timer(), today) is None


def test_empty_offsets_means_no_reminder_at_all():
    assert due_reminders(_timer(remind_days_before=[]), date(2026, 8, 6)) is None


def test_upcoming_sorts_by_how_soon():
    timers = [
        _timer(title="生日", date="2020-09-01"),
        _timer(title="纪念日", date="2020-08-06"),
    ]
    result = upcoming(timers, date(2026, 7, 30), within_days=60)
    assert [item["title"] for item in result] == ["纪念日", "生日"]
    assert result[0]["daysLeft"] == 7


# ---- 落库 ----


async def _companion(session_maker):
    async with session_maker() as db:
        user_id = await db.scalar(select(User.id))
        companion, _ = await ConversationService().ensure_companion(db, user_id)
        return companion.id


async def test_scan_writes_an_event_the_pet_can_say(session_maker):
    await _companion(session_maker)
    async with session_maker() as db:
        db.add(_timer(title="在一起", date="2020-08-06"))
        await db.commit()

        written = await scan_anniversaries(db, today=date(2026, 8, 6))
        assert written == ["今天是在一起"]

        events = list(await db.scalars(select(CompanionPetEvent)))
    assert len(events) == 1
    assert events[0].type == ANNIVERSARY_EVENT
    # 当天的重要度更高，且标了 urgent——只有它允许突破安静模式
    assert events[0].importance == 80
    assert events[0].payload["urgent"] is True


async def test_scan_is_idempotent(session_maker):
    """定时任务重跑或手工触发都不该让宠物把同一件事念两遍。"""
    await _companion(session_maker)
    async with session_maker() as db:
        db.add(_timer(title="在一起", date="2020-08-06"))
        await db.commit()

        await scan_anniversaries(db, today=date(2026, 8, 6))
        await scan_anniversaries(db, today=date(2026, 8, 6))

        events = list(await db.scalars(select(CompanionPetEvent)))
    assert len(events) == 1


async def test_ahead_of_time_reminders_are_not_urgent(session_maker):
    await _companion(session_maker)
    async with session_maker() as db:
        db.add(_timer(title="在一起", date="2020-08-06"))
        await db.commit()
        await scan_anniversaries(db, today=date(2026, 7, 30))
        event = (await db.scalars(select(CompanionPetEvent))).first()
    assert event.payload["daysBefore"] == 7
    assert event.payload["urgent"] is False
    assert event.importance == 55


async def test_a_broken_date_does_not_stop_the_others(session_maker):
    await _companion(session_maker)
    async with session_maker() as db:
        db.add(_timer(title="坏数据", date="下周三"))
        db.add(_timer(title="好数据", date="2020-08-06"))
        await db.commit()
        written = await scan_anniversaries(db, today=date(2026, 8, 6))
    assert written == ["今天是好数据"]
