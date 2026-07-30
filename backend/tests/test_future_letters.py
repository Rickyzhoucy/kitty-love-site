"""未来情书（计划文档 §2.6）。

这个功能只有**一条**不能做错：`unlockAt` 之前服务端不返回正文。只在前端藏等于
没锁——正文已经在响应体里，打开网络面板就看到了。所以这里在服务层和 API 层
各测一遍，API 那几条尤其重要：它们检查的是真实响应体的字节。
"""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.future_letters import (
    create,
    is_unlocked,
    list_letters,
    newly_unlocked,
    open_letter,
    redact,
)
from app.models import FutureLetter, User


def _future() -> datetime:
    return datetime.now(UTC) + timedelta(days=30)


def _past() -> datetime:
    return datetime.now(UTC) - timedelta(minutes=1)


# ---- 锁 ----


async def test_locked_letter_carries_no_body(session_maker):
    """**全文最重要的一条。** 锁着的信在 redact 之后就没有正文了。"""
    async with session_maker() as db:
        me = await db.scalar(select(User.id))
        letter = await create(db, me, "还没到时候", ["att1"], _future())
        await db.commit()

        view = redact(letter)
    assert view.unlocked is False
    assert view.body is None
    # 附件也一样：图片本身就是内容
    assert view.attachment_ids == []


async def test_unlocked_letter_reveals_body(session_maker):
    async with session_maker() as db:
        me = await db.scalar(select(User.id))
        letter = await create(db, me, "到点啦", ["att1"], _past())
        await db.commit()

        view = redact(letter)
    assert view.unlocked is True
    assert view.body == "到点啦"
    assert view.attachment_ids == ["att1"]


async def test_author_cannot_peek_either(session_maker):
    """能偷看的时间胶囊没有意义——作者本人也一样看不到。"""
    async with session_maker() as db:
        me = await db.scalar(select(User.id))
        letter = await create(db, me, "我自己写的", [], _future())
        await db.commit()

        view = redact(letter)
    assert view.author_id == me
    assert view.body is None


@pytest.mark.parametrize("offset_seconds", [-1, 0])
async def test_unlock_boundary_is_inclusive(session_maker, offset_seconds):
    """到点即解锁。差一秒不给看，正好到点要给看。"""
    async with session_maker() as db:
        me = await db.scalar(select(User.id))
        now = datetime.now(UTC)
        letter = await create(db, me, "边界", [], now + timedelta(seconds=offset_seconds))
        await db.commit()
    assert is_unlocked(letter, now) is True


async def test_not_yet_unlocked_one_second_early(session_maker):
    async with session_maker() as db:
        me = await db.scalar(select(User.id))
        now = datetime.now(UTC)
        letter = await create(db, me, "还差一秒", [], now + timedelta(seconds=1))
        await db.commit()
    assert is_unlocked(letter, now) is False


# ---- openedAt ----


async def test_reading_a_locked_letter_does_not_mark_it_opened(session_maker):
    """`openedAt` 的意思是「已经被人看到了」。锁着的时候访问不算看到。"""
    async with session_maker() as db:
        me = await db.scalar(select(User.id))
        letter = await create(db, me, "锁着的", [], _future())
        await db.commit()

        reopened = await open_letter(db, letter.id)
        await db.commit()
    assert reopened.opened_at is None


async def test_first_read_after_unlock_records_opened_at(session_maker):
    async with session_maker() as db:
        me = await db.scalar(select(User.id))
        letter = await create(db, me, "解锁了", [], _past())
        await db.commit()

        first = await open_letter(db, letter.id)
        await db.commit()
        stamped = first.opened_at
        assert stamped is not None

        # 再读一次不该刷新时间——那是「第一次被看到」的记录
        second = await open_letter(db, letter.id)
        await db.commit()
    assert second.opened_at == stamped


async def test_newly_unlocked_lists_only_undelivered(session_maker):
    """解锁当天宠物来送信，靠这个查——已经看过的不该再送一遍。"""
    async with session_maker() as db:
        me = await db.scalar(select(User.id))
        await create(db, me, "该送的", [], _past())
        seen = await create(db, me, "已经看过的", [], _past())
        seen.opened_at = datetime.now(UTC)
        await create(db, me, "还锁着的", [], _future())
        await db.commit()

        pending = await newly_unlocked(db)
    assert [letter.body for letter in pending] == ["该送的"]


async def test_letters_are_ordered_by_unlock_time(session_maker):
    async with session_maker() as db:
        me = await db.scalar(select(User.id))
        now = datetime.now(UTC)
        await create(db, me, "后开的", [], now + timedelta(days=60))
        await create(db, me, "先开的", [], now + timedelta(days=10))
        await db.commit()

        rows = await list_letters(db)
    assert [letter.body for letter in rows] == ["先开的", "后开的"]


# ---- API：检查真实响应体 ----


async def test_api_never_ships_a_locked_body(authenticated_client):
    """接口层的守卫。前端藏得再好，只要响应体里有正文这个功能就是坏的。"""
    created = await authenticated_client.post(
        "/api/v1/letters",
        json={"body": "绝密内容", "unlockAt": _future().isoformat()},
    )
    assert created.status_code == 201
    payload = created.json()
    assert payload["unlocked"] is False
    assert payload["body"] is None
    # 最直接的检查：正文这几个字根本不该出现在响应的字节里
    assert "绝密内容" not in created.text

    listed = await authenticated_client.get("/api/v1/letters")
    assert listed.status_code == 200
    assert "绝密内容" not in listed.text

    detail = await authenticated_client.get(f"/api/v1/letters/{payload['id']}")
    assert detail.status_code == 200
    assert detail.json()["body"] is None
    assert "绝密内容" not in detail.text


async def test_api_reveals_after_unlock(authenticated_client, session_maker):
    created = await authenticated_client.post(
        "/api/v1/letters",
        json={"body": "到点可见", "unlockAt": _future().isoformat()},
    )
    letter_id = created.json()["id"]

    # 把解锁时间改到过去，模拟时间到了
    async with session_maker() as db:
        letter = await db.get(FutureLetter, letter_id)
        letter.unlock_at = _past()
        await db.commit()

    detail = await authenticated_client.get(f"/api/v1/letters/{letter_id}")
    assert detail.status_code == 200
    body = detail.json()
    assert body["unlocked"] is True
    assert body["body"] == "到点可见"
    assert body["openedAt"] is not None


async def test_api_rejects_unlock_in_the_past(authenticated_client):
    """写给未来的信，解锁时间在过去就没意义了。"""
    response = await authenticated_client.post(
        "/api/v1/letters",
        json={"body": "现在就能看", "unlockAt": _past().isoformat()},
    )
    assert response.status_code == 422


async def test_api_missing_letter_is_404(authenticated_client):
    response = await authenticated_client.get("/api/v1/letters/nope")
    assert response.status_code == 404
