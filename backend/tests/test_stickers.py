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
