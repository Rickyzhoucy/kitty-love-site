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

from app.models import Companion, CompanionPetEvent, FutureLetter, utcnow

logger = logging.getLogger(__name__)

#: 「有信解锁了」的待表达事件类型。与 `anniversary.due` 并列，由
#: `anniversaries.deliver_due` 统一送达。
LETTER_EVENT = "letter.unlocked"

#: 与纪念日当天同级：一封等了一年的信到了日子，值得盖过日常闲聊。
IMPORTANCE_UNLOCKED = 80


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


async def announce_unlocked(
    db: AsyncSession,
    now: datetime | None = None,
) -> list[str]:
    """给刚解锁的信写一条待表达事件，让宠物去说一声。返回写了哪些。

    ## 这一步原本是缺的

    `newly_unlocked()` 写好了却没有任何调用方——一封信到了日子，界面上悄悄
    多出一段正文，没有任何人被告知。一个「到时候才看得到」的功能，最要紧的
    那一下就是**到时候那一下**，少了它整个功能等于只剩个倒计时。

    ## 为什么走 CompanionPetEvent 而不是直接发 SSE

    与纪念日同一条理由：这样它自动经过宠物已有的打扰预算与深夜静默，而不是
    绕开那套约束另开一个通知渠道。送达由 `anniversaries.deliver_due` 统一做。

    ## 去重靠 dedupe，不靠 openedAt

    `openedAt` 的语义是「有人读过了」，只有真的去读那封信才该写。拿它当
    「已通知」的标记会让两件事纠缠：用户没点开，宠物就每二十分钟提醒一次。
    所以这里沿用纪念日那套 `payload.dedupe` 去重键（每封信只播报一次）。
    """
    moment = now or utcnow()
    letters = await newly_unlocked(db, moment)
    if not letters:
        return []

    companions = list(await db.scalars(select(Companion)))
    if not companions:
        return []

    # 已播报过的键。一次查回来在内存里比对——理由同 anniversaries.scan：
    # JSON 路径查询的语法在 SQLite 与 Postgres 之间不一致。
    announced = {
        str((event.payload or {}).get("dedupe", ""))
        for event in await db.scalars(
            select(CompanionPetEvent).where(
                CompanionPetEvent.type == LETTER_EVENT
            )
        )
    }

    written: list[str] = []
    for letter in letters:
        dedupe = f"letter:{letter.id}"
        if dedupe in announced:
            continue
        announced.add(dedupe)
        text = "有一封写给以后的信到时候了，去看看吧。"
        for companion in companions:
            db.add(
                CompanionPetEvent(
                    companion_id=companion.id,
                    type=LETTER_EVENT,
                    payload={
                        "dedupe": dedupe,
                        "letterId": letter.id,
                        "text": text,
                        # 拆信是件值得停下来的事，允许它像纪念日当天那样张扬一点
                        "urgent": True,
                    },
                    importance=IMPORTANCE_UNLOCKED,
                )
            )
        written.append(letter.id)

    if written:
        await db.commit()
        logger.info("情书解锁播报 %s 封", len(written))
    return written
