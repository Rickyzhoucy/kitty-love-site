"""纪念日提醒（计划文档 §2.2）。

改造前 `EventTimer` 只是个静态倒计时：**没有任何东西会在日子快到时说一句**。
这个模块补上那一句。

两个关键判断：

1. **周期性纪念日的下一次日期在读取时计算，不落库。** 落库就得维护一个
   「过期后自动推到明年」的作业，多一个会出错的地方；而算一次的成本是几微秒。
2. **提醒走 `CompanionPetEvent`，不直接推送。** 这样它自动经过宠物已有的
   打扰预算与安静模式，而不是绕开那套约束另开一个通知渠道。
"""

from __future__ import annotations

import logging
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Companion,
    CompanionPetEvent,
    EventTimer,
    OutboxEvent,
    utcnow,
)

logger = logging.getLogger(__name__)

#: 纪念日提醒的事件类型。当天与提前几天用同一个类型，靠 payload 区分。
ANNIVERSARY_EVENT = "anniversary.due"

#: 当天的重要度高于提前提醒——当天那条允许突破安静模式，提前的不行。
IMPORTANCE_ON_DAY = 80
IMPORTANCE_AHEAD = 55


def parse_date(raw: str) -> date | None:
    """旧数据里 `date` 是自由文本，解析不出来就跳过这条，不要整批失败。"""
    text = (raw or "").strip().replace("/", "-")
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except ValueError:
        pass
    for fmt in ("%Y-%m-%d", "%Y年%m月%d日"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    # 只给了月日的，按今年算。手工拆而不是用 strptime("%m-%d")——
    # 后者依赖一个默认年份，Python 3.15 起会直接报错。
    parts = text.split("-")
    if len(parts) == 2 and all(part.isdigit() for part in parts):
        try:
            return date(date.today().year, int(parts[0]), int(parts[1]))
        except ValueError:
            return None
    return None


def next_occurrence(anchor: date, recurrence: str, today: date) -> date | None:
    """下一次发生的日期。

    `none` 的过去日期返回 None——一次性的日子过了就是过了，不该再提醒。
    """
    if recurrence == "none":
        return anchor if anchor >= today else None

    if recurrence == "yearly":
        for year in (today.year, today.year + 1):
            try:
                candidate = anchor.replace(year=year)
            except ValueError:
                # 2 月 29 日在平年不存在。落到 2 月 28 日，而不是跳过整个纪念日。
                candidate = anchor.replace(year=year, day=28)
            if candidate >= today:
                return candidate
        return None

    if recurrence == "monthly":
        for offset in range(0, 2):
            month = today.month + offset
            year = today.year + (month - 1) // 12
            month = (month - 1) % 12 + 1
            day = anchor.day
            # 31 号在只有 30 天的月份不存在，往前退到月末
            while day > 0:
                try:
                    candidate = date(year, month, day)
                    break
                except ValueError:
                    day -= 1
            else:
                continue
            if candidate >= today:
                return candidate
        return None

    return None


def due_reminders(
    timer: EventTimer,
    today: date,
) -> tuple[date, int] | None:
    """这个纪念日今天该不该提醒。返回 (发生日期, 提前天数)。

    只在**恰好等于**某个提前量的那天提醒。用「小于等于」的话，设了提前 7 天
    就会连着念叨 8 天。
    """
    anchor = parse_date(timer.date)
    if anchor is None:
        return None
    days_before = timer.remind_days_before or []
    if not days_before:
        return None
    occurrence = next_occurrence(anchor, timer.recurrence or "none", today)
    if occurrence is None:
        return None
    delta = (occurrence - today).days
    return (occurrence, delta) if delta in set(days_before) else None


def _describe(timer: EventTimer, occurrence: date, days: int) -> str:
    if days == 0:
        return f"今天是{timer.title}"
    return f"还有 {days} 天就是{timer.title}（{occurrence.strftime('%m月%d日')}）"


async def scan_anniversaries(
    db: AsyncSession,
    today: date | None = None,
) -> list[str]:
    """扫描所有纪念日，为到点的写 `CompanionPetEvent`。返回写入的描述。

    幂等：同一个纪念日、同一天只写一条。定时任务重跑或手工触发都不会重复念叨。
    """
    today = today or datetime.now(UTC).date()
    companions = list(await db.scalars(select(Companion)))
    if not companions:
        return []

    timers = list(await db.scalars(select(EventTimer)))

    # 已写过的去重键。一次查回来在内存里比对，而不是每条都查一次库——
    # 更重要的是**不依赖 JSON 路径查询**：那个语法在 SQLite 与 Postgres
    # 之间不一致，写出来的条件在测试库能跑、在生产库悄悄失效是最坏的情况。
    recent = list(
        await db.scalars(
            select(CompanionPetEvent).where(
                CompanionPetEvent.type == ANNIVERSARY_EVENT,
                CompanionPetEvent.occurred_at
                >= datetime.now(UTC) - timedelta(days=400),
            )
        )
    )
    seen = {
        (event.companion_id, str((event.payload or {}).get("dedupe", "")))
        for event in recent
    }

    written: list[str] = []
    for timer in timers:
        due = due_reminders(timer, today)
        if due is None:
            continue
        occurrence, days = due
        text = _describe(timer, occurrence, days)
        for companion in companions:
            # 去重键：同一纪念日的同一次发生 + 同一提前量。
            dedupe = f"{timer.id}:{occurrence.isoformat()}:{days}"
            if (companion.id, dedupe) in seen:
                continue
            seen.add((companion.id, dedupe))
            db.add(
                CompanionPetEvent(
                    companion_id=companion.id,
                    type=ANNIVERSARY_EVENT,
                    payload={
                        "dedupe": dedupe,
                        "timerId": timer.id,
                        "title": timer.title,
                        "occurrence": occurrence.isoformat(),
                        "daysBefore": days,
                        "text": text,
                        # 当天可以突破安静模式；提前几天的不行。
                        "urgent": days == 0,
                    },
                    importance=IMPORTANCE_ON_DAY if days == 0 else IMPORTANCE_AHEAD,
                )
            )
        written.append(text)

    if written:
        await db.commit()
        logger.info("纪念日提醒写入 %s 条", len(written))
    return written


def upcoming(timers: list[EventTimer], today: date, within_days: int = 30) -> list[dict]:
    """近期纪念日，供首页与 Cognition 的输入使用。"""
    result = []
    for timer in timers:
        anchor = parse_date(timer.date)
        if anchor is None:
            continue
        occurrence = next_occurrence(anchor, timer.recurrence or "none", today)
        if occurrence is None:
            continue
        delta = (occurrence - today).days
        if 0 <= delta <= within_days:
            result.append(
                {
                    "id": timer.id,
                    "title": timer.title,
                    "occurrence": occurrence.isoformat(),
                    "daysLeft": delta,
                }
            )
    return sorted(result, key=lambda item: item["daysLeft"])


def next_scan_at(now: datetime | None = None) -> datetime:
    """下一次扫描时刻。仅供测试与日志用。"""
    now = now or utcnow()
    return (now + timedelta(days=1)).replace(hour=1, minute=7, second=0, microsecond=0)


async def deliver_due(
    db: AsyncSession,
    now: datetime | None = None,
) -> list[dict]:
    """把还没送达的纪念日提醒变成宠物真的会说出来的话。

    ## 为什么需要这一步

    `scan_anniversaries` 只负责**写事件**，写完就完了。改造前没有任何代码读它
    ——事件安静地堆在表里，宠物一次都没念过。这个函数就是那个缺失的消费端：
    把未处理的事件转成 `pet.action`（宠物已有的说话通道，前端 usePetActivityBridge
    在听），然后标记已处理。

    ## 送达即标记，即使没人在线

    `processedAt` 记的是「已经送出去了」，不是「用户看到了」。人不在站上时这条
    SSE 就丢了——那是已知边界（计划文档 §3.6 同一条），真正的推送要 Web Push。
    不标记的话，事件会在下一次扫描时再送一遍，攒上几天就变成一串刷屏。
    """
    moment = now or utcnow()
    pending = list(
        await db.scalars(
            select(CompanionPetEvent)
            .where(
                CompanionPetEvent.type == ANNIVERSARY_EVENT,
                CompanionPetEvent.processed_at.is_(None),
            )
            .order_by(CompanionPetEvent.occurred_at)
            .limit(20)
        )
    )
    if not pending:
        return []

    delivered: list[dict] = []
    for event in pending:
        payload = event.payload or {}
        text = str(payload.get("text") or "").strip()
        event.processed_at = moment
        if not text:
            continue
        action = {
            "action": "celebrate" if payload.get("urgent") else "idle",
            "animation": "celebrate" if payload.get("urgent") else "idle",
            "message": text,
            # 当天那条留久一点，提前提醒的说完就走
            "duration": 9_000 if payload.get("urgent") else 6_000,
        }
        db.add(
            OutboxEvent(
                topic="pet.action",
                aggregate_type="pet",
                aggregate_id=event.companion_id,
                payload=action,
            )
        )
        delivered.append(action)

    await db.commit()
    if delivered:
        logger.info("纪念日提醒送达 %s 条", len(delivered))
    return delivered
