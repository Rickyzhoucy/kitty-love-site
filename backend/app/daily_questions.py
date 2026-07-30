"""每日一问（计划文档 §2.1）。

核心机制来自 Paired：**两个人都答完才能看到对方的答案**。这不是防作弊，是把
回答从表演变成交换——能先看到对方答案的话，后答的人会不自觉地往对方那儿靠。
所以「揭晓」这件事必须在服务层做，不能只在前端藏（前端藏了等于没锁）。

题目不需要人工每天排期：按日期确定性地从题库里选一道（`date.toordinal() %
len(BANK)`），同一天多次请求也选到同一道，写库前再靠 `date` 唯一约束兜底并发。
题库轮完一整圈之前不会重复。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DailyAnswer, DailyQuestion

logger = logging.getLogger(__name__)

Category = str  # daily / memory / imagine / confess

#: 题库。分四类，见计划文档 §2.1。顺序即抽取顺序的一部分（按天数取模），
#: 改动顺序会让「今天问的题」跟着变，扩容时请只在末尾追加。
QUESTION_BANK: tuple[tuple[Category, str], ...] = (
    ("daily", "今天最让你会心一笑的一件小事是什么？"),
    ("memory", "我们认识的头一个月，你对我的第一印象后来被推翻了吗？"),
    ("imagine", "如果我们能一起搬到任何一个城市住一年，你会选哪儿？"),
    ("confess", "有没有一件小事，你一直没告诉我，其实当时挺在意的？"),
    ("daily", "这一周你最想被我夸的一件事是什么？"),
    ("memory", "我们吵过的架里，现在回头看最没必要的是哪一次？"),
    ("imagine", "十年后的一个普通周末，你希望我们在做什么？"),
    ("confess", "我有什么习惯，你其实不太喜欢，但从来没说？"),
    ("daily", "如果今天可以什么都不做，你最想跟我一起做的『什么都不做』是什么？"),
    ("memory", "我们第一次一起旅行，你现在还记得的最清楚的画面是哪个？"),
    ("imagine", "如果我们养一只宠物，你希望它像我们俩谁多一点？"),
    ("confess", "有没有哪一次我说的话，其实伤到你了，但你当时忍过去了？"),
    ("daily", "最近有没有什么小事，你觉得我做得特别贴心？"),
    ("memory", "我们之间有没有一句『梗』，是外人完全听不懂但我们一说就笑的？"),
    ("imagine", "如果给我们的关系拍一部电影，你会给它起什么名字？"),
    ("confess", "有没有什么事，你希望我主动一点，但一直没好意思说？"),
    ("daily", "今天有没有什么时刻，你特别想给我发一条消息但没发？"),
    ("memory", "我们一起做过最『离谱』但现在想起来很值得的一件事是什么？"),
    ("imagine", "如果可以许一个关于『我们』的愿望，你会许什么？"),
    ("confess", "有没有什么担心，是关于这段关系的，但你一直放在心里没说出来？"),
    ("daily", "如果今天要给这段关系打一个分数（1-10），你会打几分，为什么？"),
    ("memory", "我们相处这么久，你觉得我变化最大的地方是什么？"),
    ("imagine", "如果我们能重新认识一次，你还会像当初那样靠近我吗？"),
    ("confess", "有没有一件很小的事，你希望我以后能多做一点？"),
    ("daily", "最近让你觉得『还好有ta』的一个瞬间是什么？"),
    ("memory", "我们一起养成的习惯里，你最喜欢哪一个？"),
    ("imagine", "如果我们各自能实现一个愿望，你希望我先实现哪一个？"),
    ("confess", "有没有什么话，你现在最想对我说，但还没找到合适的时机？"),
)


@dataclass(frozen=True)
class TodayQuestion:
    question: DailyQuestion
    created: bool


def _question_for_date(today: date) -> tuple[Category, str]:
    return QUESTION_BANK[today.toordinal() % len(QUESTION_BANK)]


async def ensure_today(db: AsyncSession, today: date | None = None) -> DailyQuestion:
    """今天的题，没有就按日期确定性地选一道并落库。

    并发下两个请求可能同时判断『不存在』——靠 `date` 的唯一约束兜底：
    后写入的那个捕获 `IntegrityError`，回滚后重新查一次即可，不需要显式加锁。
    """
    today = today or date.today()
    iso = today.isoformat()
    existing = await db.scalar(select(DailyQuestion).where(DailyQuestion.date == iso))
    if existing is not None:
        return existing

    category, prompt = _question_for_date(today)
    question = DailyQuestion(date=iso, category=category, prompt=prompt)
    db.add(question)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        existing = await db.scalar(
            select(DailyQuestion).where(DailyQuestion.date == iso)
        )
        if existing is None:
            raise
        return existing
    return question


async def get_answer(
    db: AsyncSession, question_id: str, user_id: str
) -> DailyAnswer | None:
    return await db.scalar(
        select(DailyAnswer).where(
            DailyAnswer.question_id == question_id,
            DailyAnswer.user_id == user_id,
        )
    )


async def submit_answer(
    db: AsyncSession, question_id: str, user_id: str, body: str
) -> tuple[DailyAnswer, bool]:
    """提交或更新我今天的回答。返回 (回答, 这次是否让『两人都答完』首次成立)。

    允许更新：对方还没答之前，改主意很正常。已经揭晓之后再改，看到的人也是
    我自己和已经看过的对方——不是新增的信息泄露，不需要额外拦。
    """
    existing = await get_answer(db, question_id, user_id)
    was_both_before = await both_answered(db, question_id)
    if existing is not None:
        existing.body = body
        answer = existing
    else:
        answer = DailyAnswer(question_id=question_id, user_id=user_id, body=body)
        db.add(answer)
    await db.flush()
    now_both = await both_answered(db, question_id)
    return answer, (now_both and not was_both_before)


async def both_answered(db: AsyncSession, question_id: str) -> bool:
    """这个站只有两个人，所以『两人都答』就是『这道题有两条回答』。"""
    count = len(
        list(
            await db.scalars(
                select(DailyAnswer.id).where(DailyAnswer.question_id == question_id)
            )
        )
    )
    return count >= 2
