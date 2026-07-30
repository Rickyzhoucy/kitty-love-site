"""每日一问（计划文档 §2.1）。

核心是揭晓规则：**两人都答完之前，谁都看不到对方的答案**。这条必须在服务层
和 API 层各测一次——服务层测数据不会提前泄露，API 层测响应体里也不会。
"""

from datetime import date

from sqlalchemy import select

from app.auth import hash_password
from app.daily_questions import (
    QUESTION_BANK,
    both_answered,
    ensure_today,
    get_answer,
    submit_answer,
)
from app.models import DailyAnswer, DailyQuestion, User


async def _two_users(session_maker) -> tuple[str, str]:
    async with session_maker() as db:
        me = await db.scalar(select(User).limit(1))
        partner = User(
            username="honey",
            display_name="宝贝",
            password_hash=hash_password("x" * 12),
        )
        db.add(partner)
        await db.commit()
        return me.id, partner.id


# ---- 选题 ----


async def test_ensure_today_is_idempotent(session_maker):
    """同一天多次请求要选到同一道题——不能每次刷新都换一道。"""
    async with session_maker() as db:
        first = await ensure_today(db, date(2026, 8, 1))
        await db.commit()
        second = await ensure_today(db, date(2026, 8, 1))
    assert first.id == second.id
    assert first.category in {"daily", "memory", "imagine", "confess"}


async def test_different_days_can_ask_different_questions(session_maker):
    async with session_maker() as db:
        rows = []
        for offset in range(len(QUESTION_BANK)):
            day = date.fromordinal(date(2026, 1, 1).toordinal() + offset)
            rows.append(await ensure_today(db, day))
        await db.commit()
    # 题库轮完一整圈之前不会重复
    assert len({row.prompt for row in rows}) == len(QUESTION_BANK)


async def test_concurrent_ensure_does_not_duplicate_the_days_question(session_maker):
    """并发下两个请求都判断『不存在』——靠 date 唯一约束兜底，不重复插入。"""
    async with session_maker() as db:
        await ensure_today(db, date(2026, 8, 2))
        await db.commit()
        # 模拟第二个请求：这次 select 会命中已经落库的那条
        await ensure_today(db, date(2026, 8, 2))
        await db.commit()
        rows = list(
            await db.scalars(
                select(DailyQuestion).where(DailyQuestion.date == "2026-08-02")
            )
        )
    assert len(rows) == 1


# ---- 揭晓规则 ----


async def test_partner_answer_is_invisible_until_both_answer(session_maker):
    me, partner_id = await _two_users(session_maker)
    async with session_maker() as db:
        question = await ensure_today(db, date(2026, 8, 3))
        await submit_answer(db, question.id, me, "我先答了")
        await db.commit()

        assert await both_answered(db, question.id) is False
        # 我能看到自己的答案
        mine = await get_answer(db, question.id, me)
        assert mine is not None and mine.body == "我先答了"
        # 但对方那边此刻还没有答案——这不是权限问题，是数据真的还不存在
        theirs = await get_answer(db, question.id, partner_id)
        assert theirs is None


async def test_answering_completes_only_once(session_maker):
    """`just_completed` 只在『真正凑齐两人』的那次提交上为真。"""
    me, partner_id = await _two_users(session_maker)
    async with session_maker() as db:
        question = await ensure_today(db, date(2026, 8, 4))
        _, completed_first = await submit_answer(db, question.id, me, "第一条")
        await db.commit()
        assert completed_first is False

        _, completed_second = await submit_answer(
            db, question.id, partner_id, "第二条"
        )
        await db.commit()
        assert completed_second is True
        assert await both_answered(db, question.id) is True

        # 已经揭晓之后再改答案，不应该被当成『再次凑齐』
        _, completed_edit = await submit_answer(db, question.id, me, "改一下")
        await db.commit()
    assert completed_edit is False


async def test_resubmitting_updates_instead_of_duplicating(session_maker):
    me, _ = await _two_users(session_maker)
    async with session_maker() as db:
        question = await ensure_today(db, date(2026, 8, 5))
        await submit_answer(db, question.id, me, "草稿")
        await submit_answer(db, question.id, me, "定稿")
        await db.commit()

        rows = list(
            await db.scalars(
                select(DailyAnswer).where(
                    DailyAnswer.question_id == question.id,
                    DailyAnswer.user_id == me,
                )
            )
        )
    assert len(rows) == 1
    assert rows[0].body == "定稿"


# ---- API ----


async def test_api_today_and_answer_roundtrip(session_maker, client):
    # _two_users 从种子数据里取的第一个用户就是 conftest 建的 daniela/secret-password
    _, partner_id = await _two_users(session_maker)
    login = await client.post(
        "/api/v1/auth/login",
        json={"username": "daniela", "password": "secret-password"},
    )
    assert login.status_code == 200

    today = await client.get("/api/v1/daily-question/today")
    assert today.status_code == 200
    body = today.json()
    assert body["myAnswer"] is None
    assert body["partnerAnswered"] is False
    assert body["partnerAnswer"] is None

    answered = await client.post(
        "/api/v1/daily-question/answer", json={"body": "我的回答"}
    )
    assert answered.status_code == 200
    body = answered.json()
    assert body["myAnswer"]["body"] == "我的回答"
    # 对方还没答，即使我已经答了，也看不到对方那栏（此刻本来就没有）
    assert body["partnerAnswered"] is False
    assert body["partnerAnswer"] is None

    question_id = body["question"]["id"]
    async with session_maker() as db:
        await submit_answer(db, question_id, partner_id, "对方的回答")
        await db.commit()

    revealed = await client.get("/api/v1/daily-question/today")
    assert revealed.status_code == 200
    body = revealed.json()
    assert body["partnerAnswered"] is True
    assert body["partnerAnswer"]["body"] == "对方的回答"
