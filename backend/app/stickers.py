"""表情包。

## 各存各的，但看得见对方的

`ownerId` 决定归属：只能删自己的、排序也只动自己那份。`spaceId` 决定边界：
查询永远带着它，将来多一个情侣空间时别人的表情不会漏进来。

## 排序抄微信的「移到最前」

微信的表情管理没有拖拽，只有「勾选若干个 → 移到最前」。几百个表情拖拽排序是
灾难，而人真正想要的只是把常用的顶上来。所以这里也不做拖拽：`sortOrder`
越小越靠前，「移到最前」就是给一个比现有最小值更小的数。
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.couple_space import ensure_space
from app.models import Attachment, Sticker

#: 一个人最多存多少。微信从 300 提到了 999；这个站只有两个人，
#: 取中间值够用，主要作用是挡住「误操作把整个相册存成表情」。
MAX_PER_OWNER = 500

#: 能存成表情的格式。**GIF 必须在里面**——表情会动是它一半的意义。
ALLOWED_TYPES = frozenset({"image/gif", "image/png", "image/jpeg", "image/webp"})

#: 单张上限。微信建议 ≤500KB，这里放宽到 2MB：自托管、只有两个人，
#: 存储不是瓶颈，而压得太狠会把 GIF 的帧数砍掉。
MAX_BYTES = 2 * 1024 * 1024


class StickerRejected(ValueError):
    """存不进去，理由是给人看的。"""


async def list_stickers(db: AsyncSession, user_id: str) -> list[Sticker]:
    """这个空间里的全部表情，自己的在前。

    一次把两个人的都取回来，前端分「我的 / 对方的」两个标签展示——分两次请求
    只会让面板打开时闪一下。
    """
    space = await ensure_space(db, user_id)
    rows = await db.scalars(
        select(Sticker)
        .where(Sticker.space_id == space.id)
        .order_by(
            # 自己的排前面，然后按各自的 sortOrder，最后按存入时间
            (Sticker.owner_id != user_id),
            Sticker.sort_order,
            Sticker.created_at.desc(),
        )
    )
    return list(rows)


async def save_sticker(db: AsyncSession, user_id: str, attachment_id: str) -> Sticker:
    """把一张已上传的图存成表情。

    附件必须是**这个人自己的**：只按 id 存的话，拿到别人的附件 id 就能把它
    收进自己的库，而附件的下载地址是带签名的——等于绕过了归属。
    """
    space = await ensure_space(db, user_id)
    attachment = await db.get(Attachment, attachment_id)
    if attachment is None or attachment.owner_id != user_id:
        raise StickerRejected("这张图不在你的附件里。")
    if attachment.content_type.lower() not in ALLOWED_TYPES:
        raise StickerRejected("只支持 PNG / JPEG / GIF / WebP。")
    if attachment.size > MAX_BYTES:
        raise StickerRejected("这张图太大了，换一张小一点的。")

    existing = await db.scalar(
        select(Sticker).where(
            Sticker.owner_id == user_id,
            Sticker.attachment_id == attachment_id,
        )
    )
    if existing is not None:
        # 重复长按同一张不该报错，也不该攒出两份——当作已经存过。
        return existing

    count = await db.scalar(
        select(func.count(Sticker.id)).where(Sticker.owner_id == user_id)
    )
    if (count or 0) >= MAX_PER_OWNER:
        raise StickerRejected(f"表情最多存 {MAX_PER_OWNER} 个，先删掉一些。")

    sticker = Sticker(
        space_id=space.id,
        owner_id=user_id,
        attachment_id=attachment_id,
        sort_order=await _front_of(db, user_id),
    )
    db.add(sticker)
    await db.flush()
    return sticker


async def delete_sticker(db: AsyncSession, user_id: str, sticker_id: str) -> None:
    """只能删自己的。对方的表情在面板里可见、可发，但不可删。"""
    sticker = await db.get(Sticker, sticker_id)
    if sticker is None or sticker.owner_id != user_id:
        raise StickerRejected("这个表情不是你的。")
    await db.delete(sticker)


async def move_to_front(db: AsyncSession, user_id: str, sticker_ids: list[str]) -> None:
    """把选中的这些挪到最前，保持它们之间的相对顺序。

    不重排整张表：只给这几个分配比当前最小值更小的号。表情库可能有几百条，
    每次排序全量 UPDATE 是没必要的写放大。
    """
    if not sticker_ids:
        return
    front = await _front_of(db, user_id)
    rows = await db.scalars(
        select(Sticker).where(
            Sticker.owner_id == user_id,
            Sticker.id.in_(sticker_ids),
        )
    )
    by_id = {row.id: row for row in rows}
    # 按调用方给的顺序编号，而不是按查询返回的顺序
    for offset, sticker_id in enumerate(sticker_ids):
        sticker = by_id.get(sticker_id)
        if sticker is not None:
            sticker.sort_order = front - (len(sticker_ids) - offset)


async def _front_of(db: AsyncSession, user_id: str) -> int:
    """比这个人当前最靠前的还要靠前一位。"""
    smallest = await db.scalar(
        select(func.min(Sticker.sort_order)).where(Sticker.owner_id == user_id)
    )
    return (smallest or 0) - 1
