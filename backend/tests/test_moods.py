"""情绪打卡（计划文档 §2.4）。

功能本身很简单，两处值得测：**一人一天一条**（重复打卡是更新，否则曲线不知道
该画哪个值），以及 `partner_today` 给 Cognition 的那个字符串——它是这个功能存在
的真正理由（让宠物「有事说事」而不是「没话找话」）。
"""

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import select

from app.auth import hash_password
from app.models import MoodEntry, User
from app.moods import describe, entry_for, history, partner_today, upsert


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


def _today() -> str:
    return datetime.now(UTC).date().isoformat()


# ---- 一人一天一条 ----


async def test_second_checkin_same_day_updates(session_maker):
    """心情会变，下午改一次很正常；插新记录的话同一天就有两个值。"""
    me, _ = await _two_users(session_maker)
    async with session_maker() as db:
        await upsert(db, me, 2, "早上不太好")
        await upsert(db, me, 4, "下午好起来了")
        await db.commit()

        rows = list(await db.scalars(select(MoodEntry).where(MoodEntry.user_id == me)))
    assert len(rows) == 1
    assert rows[0].mood == 4
    assert rows[0].note == "下午好起来了"


async def test_different_days_are_separate_rows(session_maker):
    me, _ = await _two_users(session_maker)
    yesterday = (datetime.now(UTC).date() - timedelta(days=1)).isoformat()
    async with session_maker() as db:
        await upsert(db, me, 3, None, yesterday)
        await upsert(db, me, 5, None)
        await db.commit()

        rows = await history(db, me)
    assert len(rows) == 2
    # 曲线按日期正序，画图直接用
    assert [row.date for row in rows] == [yesterday, _today()]


async def test_two_people_do_not_collide(session_maker):
    """唯一约束是 (userId, date)，不是 date——两个人同一天都能打卡。"""
    me, partner_id = await _two_users(session_maker)
    async with session_maker() as db:
        await upsert(db, me, 5, None)
        await upsert(db, partner_id, 1, None)
        await db.commit()

        mine = await history(db, me)
        theirs = await history(db, partner_id)
    assert [row.mood for row in mine] == [5]
    assert [row.mood for row in theirs] == [1]


async def test_note_can_be_cleared(session_maker):
    me, _ = await _two_users(session_maker)
    async with session_maker() as db:
        await upsert(db, me, 3, "写了点什么")
        await upsert(db, me, 3, None)
        await db.commit()

        entry = await entry_for(db, me)
    assert entry.note is None


async def test_history_window_excludes_old_entries(session_maker):
    me, _ = await _two_users(session_maker)
    long_ago = (datetime.now(UTC).date() - timedelta(days=400)).isoformat()
    async with session_maker() as db:
        await upsert(db, me, 3, None, long_ago)
        await upsert(db, me, 4, None)
        await db.commit()

        rows = await history(db, me, window_days=180)
    assert [row.date for row in rows] == [_today()]


# ---- 给 Cognition 的输入 ----


async def test_partner_today_is_human_readable(session_maker):
    """传「2」模型不知道那是好是坏，所以给的是人话。"""
    _, partner_id = await _two_users(session_maker)
    async with session_maker() as db:
        await upsert(db, partner_id, 2, None)
        await db.commit()

        described = await partner_today(db, partner_id)
    assert described == "有点低落"


async def test_partner_today_includes_the_note(session_maker):
    _, partner_id = await _two_users(session_maker)
    async with session_maker() as db:
        await upsert(db, partner_id, 1, "没睡好")
        await db.commit()

        described = await partner_today(db, partner_id)
    assert described == "很低落（没睡好）"


async def test_partner_today_is_none_without_a_checkin(session_maker):
    """没打卡就是没打卡。宠物不许拿「没数据」当「心情不好」用。"""
    _, partner_id = await _two_users(session_maker)
    async with session_maker() as db:
        assert await partner_today(db, partner_id) is None


async def test_yesterdays_mood_is_not_todays(session_maker):
    """打卡是「今天」的事。昨天标了低落，今天没标就不该继续拿来说事。"""
    _, partner_id = await _two_users(session_maker)
    yesterday = (datetime.now(UTC).date() - timedelta(days=1)).isoformat()
    async with session_maker() as db:
        await upsert(db, partner_id, 1, None, yesterday)
        await db.commit()

        assert await partner_today(db, partner_id) is None


@pytest.mark.parametrize("mood", [1, 2, 3, 4, 5])
def test_every_valid_mood_has_a_label(mood):
    assert describe(mood) != "说不清"


# ---- API ----


async def test_api_checkin_returns_both_curves(session_maker, client):
    _, partner_id = await _two_users(session_maker)
    login = await client.post(
        "/api/v1/auth/login",
        json={"username": "daniela", "password": "secret-password"},
    )
    assert login.status_code == 200

    async with session_maker() as db:
        await upsert(db, partner_id, 2, "有点累")
        await db.commit()

    written = await client.put("/api/v1/moods", json={"mood": 5, "note": "今天很好"})
    assert written.status_code == 200
    payload = written.json()
    assert [row["mood"] for row in payload["mine"]] == [5]
    assert [row["mood"] for row in payload["theirs"]] == [2]
    assert payload["partner"]["displayName"] == "宝贝"

    read = await client.get("/api/v1/moods")
    assert read.status_code == 200
    assert read.json()["mine"][0]["note"] == "今天很好"


@pytest.mark.parametrize("mood", [0, 6, -1])
async def test_api_rejects_out_of_range_mood(session_maker, client, mood):
    await _two_users(session_maker)
    await client.post(
        "/api/v1/auth/login",
        json={"username": "daniela", "password": "secret-password"},
    )
    response = await client.put("/api/v1/moods", json={"mood": mood})
    assert response.status_code == 422


async def test_api_rejects_malformed_date(session_maker, client):
    await _two_users(session_maker)
    await client.post(
        "/api/v1/auth/login",
        json={"username": "daniela", "password": "secret-password"},
    )
    response = await client.put(
        "/api/v1/moods", json={"mood": 3, "date": "2026/08/01"}
    )
    assert response.status_code == 422


async def test_api_backfilling_an_earlier_day_is_allowed(session_maker, client):
    """明确传 date 就是补记。曲线上留个洞比逼人假装今天的心情要好。"""
    await _two_users(session_maker)
    await client.post(
        "/api/v1/auth/login",
        json={"username": "daniela", "password": "secret-password"},
    )
    earlier = (date.today() - timedelta(days=3)).isoformat()
    response = await client.put(
        "/api/v1/moods", json={"mood": 3, "date": earlier}
    )
    assert response.status_code == 200
    assert [row["date"] for row in response.json()["mine"]] == [earlier]
