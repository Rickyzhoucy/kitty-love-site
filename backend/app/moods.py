"""情绪打卡（计划文档 §2.4）。

**它真正的价值不在图表**，在于给 Cognition Agent 一个有依据的关心理由。现在
宠物主动搭话只能基于「你很久没互动了」，有了这条数据就能基于「对方今天标了
低落」——从「没话找话」到「有事说事」。所以除了页面用的两条曲线，这里还导出
`partner_today` 给 Cognition 的输入用。
"""

from __future__ import annotations

import logging
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import MoodEntry

logger = logging.getLogger(__name__)

#: 曲线默认回看多久。两个人的站，半年数据量也就百来条，一次拉回来最省事。
DEFAULT_WINDOW_DAYS = 180

#: mood 数值 → 人话。给 Cognition 的 prompt 用——传「2」模型不知道那是好是坏。
MOOD_LABELS: dict[int, str] = {
    1: "很低落",
    2: "有点低落",
    3: "还行",
    4: "不错",
    5: "很好",
}


def describe(mood: int) -> str:
    return MOOD_LABELS.get(mood, "说不清")


async def upsert(
    db: AsyncSession,
    user_id: str,
    mood: int,
    note: str | None,
    day: str | None = None,
) -> MoodEntry:
    """打卡。一人一天一条，重复打卡是**更新**而不是插入。

    心情会变，下午改一次很正常；插入新记录的话同一天就有两个值，曲线不知道
    该画哪个。并发下靠 `(userId, date)` 唯一约束兜底。
    """
    iso = day or datetime.now(UTC).date().isoformat()
    existing = await db.scalar(
        select(MoodEntry).where(
            MoodEntry.user_id == user_id,
            MoodEntry.date == iso,
        )
    )
    if existing is not None:
        existing.mood = mood
        existing.note = note
        return existing

    entry = MoodEntry(user_id=user_id, date=iso, mood=mood, note=note)
    db.add(entry)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        existing = await db.scalar(
            select(MoodEntry).where(
                MoodEntry.user_id == user_id,
                MoodEntry.date == iso,
            )
        )
        if existing is None:
            raise
        existing.mood = mood
        existing.note = note
        return existing
    return entry


async def history(
    db: AsyncSession,
    user_id: str,
    window_days: int = DEFAULT_WINDOW_DAYS,
) -> list[MoodEntry]:
    since = (datetime.now(UTC).date() - timedelta(days=window_days)).isoformat()
    return list(
        await db.scalars(
            select(MoodEntry)
            .where(MoodEntry.user_id == user_id, MoodEntry.date >= since)
            .order_by(MoodEntry.date)
        )
    )


async def entry_for(
    db: AsyncSession,
    user_id: str,
    day: date | None = None,
) -> MoodEntry | None:
    iso = (day or datetime.now(UTC).date()).isoformat()
    return await db.scalar(
        select(MoodEntry).where(MoodEntry.user_id == user_id, MoodEntry.date == iso)
    )


async def partner_today(db: AsyncSession, partner_id: str) -> str | None:
    """对方今天的心情，给 Cognition 的输入用。没打卡就是 None。

    返回人话而不是数值：这个字符串会进 prompt，模型看到「有点低落」比看到
    「2」能说出更像样的话。宠物**只知道对方标了什么**，不知道为什么——所以它
    可以关心，不可以推断原因（与 §3.2 同一条约束）。
    """
    entry = await entry_for(db, partner_id)
    if entry is None:
        return None
    if entry.note:
        return f"{describe(entry.mood)}（{entry.note}）"
    return describe(entry.mood)
