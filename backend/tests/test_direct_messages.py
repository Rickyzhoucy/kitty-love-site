"""双人私聊与宠物中介（计划文档 §3）。

最重要的一组测试是 `test_pet_never_fabricates_a_reason` 那几条：宠物可以说
「不知道」，**不能说假话**。那是这个功能全部价值的基础。
"""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.auth import hash_password
from app.direct_messages import (
    PartnerUnavailable,
    mark_read,
    oldest_unread,
    resolve_partner,
    send_message,
    unread_count,
)
from app.models import DirectMessage, PetInterjection, User
from app.pet_mediation import (
    NUDGE_SCHEDULE_MINUTES,
    STANDIN_AFTER_MINUTES,
    STANDIN_TEMPLATES,
    decide_nudge,
    decide_standin,
    in_quiet_hours,
    run_mediation,
)


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


# ---- 「对方」的解析 ----


async def test_partner_is_the_other_enabled_user(session_maker):
    me, partner_id = await _two_users(session_maker)
    async with session_maker() as db:
        partner = await resolve_partner(db, me)
    assert partner.id == partner_id
    assert partner.display_name == "宝贝"


async def test_missing_partner_says_so_instead_of_pretending(session_maker):
    """静默降级会让聊天页显示成一个空对话，用户分不清是没消息还是没配好。"""
    async with session_maker() as db:
        me = await db.scalar(select(User.id))
        with pytest.raises(PartnerUnavailable, match="第二个人"):
            await resolve_partner(db, me)


async def test_a_third_account_is_an_error_not_a_guess(session_maker):
    """这个站的前提就是两个人。随便挑一个比报错危险得多。"""
    me, _ = await _two_users(session_maker)
    async with session_maker() as db:
        db.add(
            User(
                username="third",
                display_name="第三个",
                password_hash=hash_password("y" * 12),
            )
        )
        await db.commit()
        with pytest.raises(PartnerUnavailable, match="超出这个站的设计"):
            await resolve_partner(db, me)


async def test_disabled_user_is_not_a_partner(session_maker):
    me, partner_id = await _two_users(session_maker)
    async with session_maker() as db:
        partner = await db.get(User, partner_id)
        partner.enabled = False
        await db.commit()
        with pytest.raises(PartnerUnavailable):
            await resolve_partner(db, me)


# ---- 收发与已读 ----


async def test_read_marks_only_messages_addressed_to_me(session_maker):
    """自己发出去的没有已读概念。"""
    me, partner_id = await _two_users(session_maker)
    async with session_maker() as db:
        await send_message(db, partner_id, me, "在吗", [])
        await send_message(db, me, partner_id, "我发的", [])
        await db.commit()

        assert await unread_count(db, me) == 1
        assert await mark_read(db, me) == 1
        await db.commit()

        assert await unread_count(db, me) == 0
        mine = await db.scalar(
            select(DirectMessage).where(DirectMessage.sender_id == me)
        )
    # 我自己发的那条不该被标记
    assert mine.read_at is None


async def test_oldest_unread_drives_the_nudge_clock(session_maker):
    me, partner_id = await _two_users(session_maker)
    async with session_maker() as db:
        first = await send_message(db, partner_id, me, "第一条", [])
        first.created_at = datetime.now(UTC) - timedelta(hours=2)
        await send_message(db, partner_id, me, "第二条", [])
        await db.commit()

        unread = await oldest_unread(db, me)
    assert unread.body == "第一条"


# ---- 唠叨节奏 ----


def _now() -> datetime:
    # 固定在中午，避开深夜静默
    return datetime(2026, 7, 30, 12, 0, tzinfo=UTC)


@pytest.mark.parametrize("step", range(len(NUDGE_SCHEDULE_MINUTES)))
def test_nudges_follow_the_configured_schedule(step):
    now = _now()
    since = now - timedelta(minutes=NUDGE_SCHEDULE_MINUTES[step])
    decision = decide_nudge(since, step, now)
    assert decision.should_nudge is True
    assert decision.body


def test_nudging_stops_after_three_times():
    """递减而非递增——三次之后只保持身体姿态，不再发气泡。

    不停的话，提醒就变成骚扰了。
    """
    now = _now()
    decision = decide_nudge(now - timedelta(hours=5), len(NUDGE_SCHEDULE_MINUTES), now)
    assert decision.should_nudge is False
    assert "不再主动提" in decision.reason


def test_no_nudge_before_the_threshold():
    now = _now()
    # 第二次要等 10 分钟，5 分钟时不该催
    decision = decide_nudge(now - timedelta(minutes=5), 1, now)
    assert decision.should_nudge is False


@pytest.mark.parametrize("initiative", ["quiet", "off"])
def test_quiet_and_off_suppress_the_bubble(initiative):
    """「用户可以关闭主动交流」那条验收的实现点。"""
    now = _now()
    decision = decide_nudge(now - timedelta(hours=1), 0, now, initiative=initiative)
    assert decision.should_nudge is False
    assert initiative in decision.reason


@pytest.mark.parametrize("hour", [23, 2, 6])
def test_deep_night_is_silent(hour):
    night = datetime(2026, 7, 30, hour, 30, tzinfo=UTC)
    assert in_quiet_hours(night) is True
    decision = decide_nudge(night - timedelta(hours=1), 0, night)
    assert decision.should_nudge is False
    assert "深夜" in decision.reason


@pytest.mark.parametrize("hour", [9, 14, 20])
def test_daytime_is_not_silent(hour):
    assert in_quiet_hours(datetime(2026, 7, 30, hour, tzinfo=UTC)) is False


def test_no_unread_means_nothing_to_say():
    assert decide_nudge(None, 0, _now()).should_nudge is False


# ---- 代答 ----


def test_standin_needs_both_time_and_a_waiting_sender():
    """只是没看还不够——对方可能发完就去忙了，替他制造一次互动反而是打扰。"""
    now = _now()
    long_ago = now - timedelta(minutes=STANDIN_AFTER_MINUTES + 5)

    should, *_ = decide_standin(long_ago, True, False, now)
    assert should is True

    # 对方没继续发 → 不代答
    should, *_ = decide_standin(long_ago, False, False, now)
    assert should is False

    # 时间不够 → 不代答
    should, *_ = decide_standin(now - timedelta(minutes=5), True, False, now)
    assert should is False


def test_standin_happens_at_most_once_per_unread_event():
    """否则会变成宠物自己在跟对方聊天。"""
    now = _now()
    long_ago = now - timedelta(hours=2)
    should, *_ = decide_standin(long_ago, True, True, now)
    assert should is False


@pytest.mark.parametrize("template", [body for _, body in STANDIN_TEMPLATES])
def test_pet_never_fabricates_a_reason(template):
    """**全文最重要的一条约束**（计划文档 §3.2）。

    宠物不知道你在不在忙。它可以说「还没看到」，不能说「他在忙」——让它编一个
    理由，就是替你对另一个人撒谎。哪怕是善意的，一旦对方后来发现你当时在刷
    手机，这只宠物就不可信了，而可信是它全部价值的基础。
    """
    forbidden = [
        "在忙", "忙着", "开会", "有事", "睡了", "在睡", "洗澡",
        "上班", "加班", "没空", "路上", "开车",
    ]
    for phrase in forbidden:
        assert phrase not in template, f"模板里出现了编造的理由：{phrase}"


@pytest.mark.parametrize("template", [body for _, body in STANDIN_TEMPLATES])
def test_pet_never_speaks_as_the_user(template):
    """宠物永远以自己的身份说话，不以你的名义表态。"""
    forbidden = ["他说", "她说", "他让我", "她让我", "他表示", "帮他回"]
    for phrase in forbidden:
        assert phrase not in template


# ---- 端到端 ----


async def test_mediation_writes_interjections_separate_from_real_messages(
    session_maker,
):
    """宠物的话单独一张表。混进 DirectMessage 会让「谁发的」多出第三种取值。"""
    me, partner_id = await _two_users(session_maker)
    async with session_maker() as db:
        message = await send_message(db, partner_id, me, "在吗", [])
        message.created_at = datetime.now(UTC) - timedelta(hours=2)
        # 对方又发了一条，说明他在等
        await send_message(db, partner_id, me, "还在吗", [])
        await db.commit()

        unread = await oldest_unread(db, me)
        created = await run_mediation(db, me, partner_id, unread)

        messages = list(await db.scalars(select(DirectMessage)))
        interjections = list(await db.scalars(select(PetInterjection)))

    assert len(created) == 2  # 催我一条 + 在对方那侧代答一条
    # 真人消息还是两条，宠物的话没有混进来
    assert len(messages) == 2
    assert len(interjections) == 2
    kinds = {item.kind for item in interjections}
    assert kinds == {"unread_nudge", "standin"}
    # 催我的说给我听，代答的说给对方听
    nudge = next(item for item in interjections if item.kind == "unread_nudge")
    standin = next(item for item in interjections if item.kind == "standin")
    assert nudge.audience_id == me
    assert standin.audience_id == partner_id


async def test_mediation_does_nothing_once_the_message_is_read(session_maker):
    """「你打开了 → 立刻安静」。"""
    me, partner_id = await _two_users(session_maker)
    async with session_maker() as db:
        await send_message(db, partner_id, me, "在吗", [])
        await mark_read(db, me)
        await db.commit()

        unread = await oldest_unread(db, me)
        created = await run_mediation(db, me, partner_id, unread)
    assert unread is None
    assert created == []


async def test_mediation_respects_quiet_mode_end_to_end(session_maker):
    me, partner_id = await _two_users(session_maker)
    async with session_maker() as db:
        message = await send_message(db, partner_id, me, "在吗", [])
        message.created_at = datetime.now(UTC) - timedelta(hours=2)
        await db.commit()

        unread = await oldest_unread(db, me)
        created = await run_mediation(db, me, partner_id, unread, initiative="off")
        # 关闭主动性时不该有任何催促
        assert all(item.kind != "unread_nudge" for item in created)
