"""表情包。

重点验的是**归属**：各存各的，能看对方的，但只能删自己的。这一条不是 UI 约定，
是服务端规则——前端藏起删除按钮不算数。
"""

import pytest

from app.storage import get_storage
from tests.test_storage import FakeJobQueue, FakeStorage


async def _upload(client, name="e.png", content_type="image/png"):
    """走真实的 presign → complete 上传路径拿一个附件。"""
    app = client._transport.app
    app.dependency_overrides[get_storage] = lambda: FakeStorage()
    app.state.job_queue = FakeJobQueue()
    request = {
        "filename": name,
        "contentType": content_type,
        "size": 12,
        "sha256": FakeStorage.sha,
    }
    presigned = await client.post("/api/v1/attachments/presign", json=request)
    assert presigned.status_code == 200, presigned.text
    body = presigned.json()
    completed = await client.post(
        "/api/v1/attachments/complete",
        json={**request, "bucket": body["bucket"], "objectKey": body["objectKey"]},
    )
    assert completed.status_code == 201, completed.text
    return completed.json()["id"]


@pytest.mark.anyio
async def test_saving_the_same_image_twice_does_not_duplicate(authenticated_client):
    """重复长按同一张不该攒出两份，也不该报错。"""
    attachment = await _upload(authenticated_client)
    first = await authenticated_client.post(
        "/api/v1/stickers", json={"attachmentId": attachment}
    )
    second = await authenticated_client.post(
        "/api/v1/stickers", json={"attachmentId": attachment}
    )
    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    assert first.json()["id"] == second.json()["id"]

    listed = (await authenticated_client.get("/api/v1/stickers")).json()
    assert len([item for item in listed if item["attachmentId"] == attachment]) == 1


@pytest.mark.anyio
async def test_only_images_can_become_stickers(authenticated_client):
    attachment = await _upload(authenticated_client, "note.txt", "text/plain")
    response = await authenticated_client.post(
        "/api/v1/stickers", json={"attachmentId": attachment}
    )
    assert response.status_code == 409
    assert "PNG" in response.json()["detail"]


@pytest.mark.anyio
async def test_move_to_front_puts_the_chosen_one_first(authenticated_client):
    """抄微信的「移到最前」。验的是顺序真的变了，不只是接口返回 204。"""
    ids = []
    for index in range(3):
        attachment = await _upload(authenticated_client, f"e{index}.png")
        created = await authenticated_client.post(
            "/api/v1/stickers", json={"attachmentId": attachment}
        )
        ids.append(created.json()["id"])

    # **先确认这三个真的是三个。** FakeStorage 的 sha 固定，附件按内容哈希
    # 去重——如果三次上传拿回同一个附件，下面的顺序断言就会因为「只有一个」
    # 而恒真，测出来的是空气。
    assert len(set(ids)) == 3, f"三次上传被去重成了 {len(set(ids))} 个，这条用例无效"

    last = ids[0]  # 最先存的，此刻排在最后
    before = [item["id"] for item in (await authenticated_client.get("/api/v1/stickers")).json()]
    assert before[-1] == last

    moved = await authenticated_client.post(
        "/api/v1/stickers/reorder", json={"stickerIds": [last]}
    )
    assert moved.status_code == 204
    after = [item["id"] for item in (await authenticated_client.get("/api/v1/stickers")).json()]
    assert after[0] == last


@pytest.mark.anyio
async def test_partner_can_read_attachments_that_reached_the_thread(session_maker):
    """**对方发给你的附件你要取得到。**

    原来的规则是「只有主人能取，相册照片除外」，于是私聊里收到的图片是碎的、
    语音和表情根本不出现——这个洞一直都在，表情和语音只是把它显眼地暴露了。

    这里直接测那条规则本身，不绕 HTTP：要验的是「谁能读」，不是路由。
    """
    from sqlalchemy import select

    from app.api import may_read_attachment
    from app.auth import hash_password
    from app.direct_messages import send_message
    from app.models import Attachment, User

    async with session_maker() as db:
        me = await db.scalar(select(User).limit(1))
        partner = User(
            username="honey2",
            display_name="宝贝",
            password_hash=hash_password("x" * 12),
        )
        db.add(partner)
        await db.flush()

        mine = Attachment(
            owner_id=me.id, bucket="b", object_key="k1", filename="pic.png",
            content_type="image/png", size=10, sha256="a" * 64, status="ready",
        )
        draft = Attachment(
            owner_id=me.id, bucket="b", object_key="k2", filename="draft.png",
            content_type="image/png", size=10, sha256="b" * 64, status="ready",
        )
        db.add_all([mine, draft])
        await db.flush()

        await send_message(db, me.id, partner.id, "", [mine.id])
        await db.commit()

        # 发出去的：收件人读得到
        assert await may_read_attachment(db, partner.id, mine) is True
        # 没发出去的：仍然只有主人能读——放行范围不能顺手扩大成「同一个空间」
        assert await may_read_attachment(db, partner.id, draft) is False
        # 主人自己当然读得到
        assert await may_read_attachment(db, me.id, draft) is True


@pytest.mark.anyio
async def test_every_attachment_route_uses_the_shared_rule():
    """五个附件端点不能各写一份归属判断。

    上一轮就是这么漏的：改了 content / thumbnail / preview 三个**下载**端点，
    漏了 `GET /attachments/{id}` 这个**元数据**端点——而前端是先调它填缓存的，
    取不到就把整条消息过滤掉，收件方看到的是「什么都没有」而不是坏图。

    直接扫源码而不是逐个发请求：要守的正是「别再冒出第六处各写一份的判断」。
    """
    from pathlib import Path

    source = Path(__file__).resolve().parents[1] / "app" / "api.py"
    text = source.read_text(encoding="utf-8")
    assert "owner_id != user.id" not in text, (
        "又有端点自己写归属判断了。附件的可读性只有一条规则："
        "may_read_attachment。"
    )


@pytest.mark.anyio
async def test_partner_stickers_can_be_sent_not_just_viewed(session_maker):
    """对方的表情要能**发**，不只是能看。

    面板里写着「可见、可发、不可删」，但发消息那道校验只认「附件属于我」——
    于是对方的表情按下去就是「表情没发出去」，那半个面板全是摆设。

    同时守住反面：放行只开给**表情**，不是「对方的附件都能转发」。对方发过的
    照片、语音、文档不该变成我可以随手再发一遍的东西。
    """
    from sqlalchemy import select

    from app.auth import hash_password
    from app.couple_space import ensure_space
    from app.direct_messages import PartnerUnavailable, verify_attachments
    from app.models import Attachment, Sticker, User

    async with session_maker() as db:
        me = await db.scalar(select(User).limit(1))
        partner = User(
            username="honey3", display_name="宝贝",
            password_hash=hash_password("x" * 12),
        )
        db.add(partner)
        await db.flush()
        space = await ensure_space(db, me.id)

        theirs = Attachment(
            owner_id=partner.id, bucket="b", object_key="s1", filename="cute.gif",
            content_type="image/gif", size=10, sha256="e" * 64, status="ready",
        )
        private = Attachment(
            owner_id=partner.id, bucket="b", object_key="p1", filename="photo.png",
            content_type="image/png", size=10, sha256="f" * 64, status="ready",
        )
        db.add_all([theirs, private])
        await db.flush()
        db.add(Sticker(
            space_id=space.id, owner_id=partner.id,
            attachment_id=theirs.id, sort_order=0,
        ))
        await db.commit()

        # 对方存的表情：我发得出去
        assert await verify_attachments(db, me.id, [theirs.id]) == [theirs.id]

        # 对方的普通附件：仍然发不出去
        with pytest.raises(PartnerUnavailable):
            await verify_attachments(db, me.id, [private.id])
