"""未来情书（计划文档 §2.6）。

技术上最轻的一个功能，但有**一条不能做错的**：`unlockAt` 之前服务端不返回正文。

只在前端藏等于没锁——正文已经在响应体里了，打开网络面板就能看到，而这个功能
的全部意义就是「到时候才看得到」。所以这里提供 `redact()`，让「锁着的信长什么
样」只有一处定义，API 层拿到的对象已经是脱敏过的。

刻意没有 recipientId：这是写给「我们」的信，解锁后两人都能看。也刻意不让作者
提前重读自己的信——能偷看的时间胶囊没有意义。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import FutureLetter, utcnow

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class LetterView:
    """一封信对外的样子。锁着的时候 `body` 是 None，不是空字符串。"""

    id: str
    created_at: datetime
    author_id: str
    unlock_at: datetime
    opened_at: datetime | None
    unlocked: bool
    body: str | None
    attachment_ids: list[str]


def _aware(moment: datetime) -> datetime:
    """SQLite 路径会存成 naive，统一按 UTC 解释后再比较。

    不统一的话 `naive < aware` 直接抛 TypeError，而且是只在某一种数据库上抛。
    """
    return moment if moment.tzinfo is not None else moment.replace(tzinfo=UTC)


def is_unlocked(letter: FutureLetter, now: datetime | None = None) -> bool:
    return _aware(letter.unlock_at) <= (now or utcnow())


def redact(letter: FutureLetter, now: datetime | None = None) -> LetterView:
    """把一封信变成能安全发出去的样子。

    **锁着的信在这里就丢掉了正文和附件**，调用方拿不到也就漏不出去。这是整个
    功能唯一的安全边界，所以只留这一个入口。
    """
    unlocked = is_unlocked(letter, now)
    return LetterView(
        id=letter.id,
        created_at=letter.created_at,
        author_id=letter.author_id,
        unlock_at=letter.unlock_at,
        opened_at=letter.opened_at,
        unlocked=unlocked,
        body=letter.body if unlocked else None,
        attachment_ids=list(letter.attachment_ids or []) if unlocked else [],
    )


async def create(
    db: AsyncSession,
    author_id: str,
    body: str,
    attachment_ids: list[str],
    unlock_at: datetime,
) -> FutureLetter:
    letter = FutureLetter(
        author_id=author_id,
        body=body,
        attachment_ids=attachment_ids,
        unlock_at=unlock_at,
    )
    db.add(letter)
    await db.flush()
    return letter


async def list_letters(db: AsyncSession) -> list[FutureLetter]:
    """全部的信，快解锁的排前面。

    没有按作者过滤：这是两个人共同的收件箱，谁写的都在一起（`authorId` 只是
    署名）。锁着的那些正文由 `redact` 摘掉，列表本身是可以互相看见的——知道
    「有一封信在等着」正是这个功能好玩的地方。
    """
    return list(
        await db.scalars(select(FutureLetter).order_by(FutureLetter.unlock_at))
    )


async def open_letter(
    db: AsyncSession,
    letter_id: str,
    now: datetime | None = None,
) -> FutureLetter | None:
    """读一封信，顺手记下第一次被读到的时刻。

    还没解锁时**不**写 `openedAt`：那个字段的意思是「已经被人看到了」，
    在锁着的时候访问一次不算看到。
    """
    letter = await db.get(FutureLetter, letter_id)
    if letter is None:
        return None
    if is_unlocked(letter, now) and letter.opened_at is None:
        letter.opened_at = now or utcnow()
    return letter


async def newly_unlocked(
    db: AsyncSession,
    now: datetime | None = None,
) -> list[FutureLetter]:
    """已解锁但还没被打开的信。解锁当天宠物来送信，靠这个查。"""
    moment = now or utcnow()
    rows = list(
        await db.scalars(
            select(FutureLetter).where(FutureLetter.opened_at.is_(None))
        )
    )
    return [letter for letter in rows if is_unlocked(letter, moment)]
