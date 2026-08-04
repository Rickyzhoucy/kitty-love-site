"""双人私聊（计划文档 §3）。

**「对方」在这个站里的定义是「另一个 enabled 用户」。** 这个站就是给两个人用的，
不需要一套配对流程；`cli.create_user` 里的两人上限保证了这个定义无歧义。

少于两人时**明确报错**，不静默降级——静默的话聊天页会显示成一个空对话，
用户不知道是没消息还是功能没配好。多于两人也报错：出现第三个账号说明配置
错了，随便挑一个比报错危险得多。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.couple_space import CoupleSpaceUnavailable, ensure_space, member_ids, require_same_space
from app.models import Attachment, DirectMessage, PetInterjection, User, utcnow

logger = logging.getLogger(__name__)


class PartnerUnavailable(Exception):
    """没有可用的「对方」。消息原样给用户看，所以要写成人话。"""


@dataclass(frozen=True)
class Partner:
    id: str
    username: str
    display_name: str


async def resolve_partner(db: AsyncSession, user_id: str) -> Partner:
    """同一 CoupleSpace 中的另一位 enabled 用户。"""
    try:
        space = await ensure_space(db, user_id)
    except CoupleSpaceUnavailable as error:
        raise PartnerUnavailable(str(error)) from error
    ids = [item for item in await member_ids(db, space.id) if item != user_id]
    if not ids:
        raise PartnerUnavailable(
            "还没有第二个人。去后台建一个账号，或者跑 `python -m app.cli seed-users`。"
        )
    if len(ids) > 1:
        raise PartnerUnavailable(
            f"当前情侣空间有 {len(ids) + 1} 个账号，超出这个站的设计（两个人）。"
        )
    partner = await db.get(User, ids[0])
    if partner is None or not partner.enabled:
        raise PartnerUnavailable("情侣空间里的另一位账号当前不可用。")
    return Partner(
        id=partner.id,
        username=partner.username,
        display_name=partner.display_name,
    )


async def verify_attachments(
    db: AsyncSession,
    user_id: str,
    attachment_ids: list[str],
) -> list[str]:
    """校验附件都属于当前用户。

    不校验的话，只要猜到 id 就能把别人的附件挂到自己的消息上——虽然这个站
    只有两个人，但那两个人的边界也是边界。
    """
    unique = list(dict.fromkeys(attachment_ids))
    if not unique:
        return []
    owned = set(
        await db.scalars(
            select(Attachment.id).where(
                Attachment.id.in_(unique),
                Attachment.owner_id == user_id,
            )
        )
    )
    missing = [item for item in unique if item not in owned]
    if missing:
        raise PartnerUnavailable("有附件不存在或不属于你。")
    return unique


async def send_message(
    db: AsyncSession,
    sender_id: str,
    recipient_id: str,
    body: str,
    attachment_ids: list[str],
    reply_to_id: str | None = None,
) -> DirectMessage:
    space = await require_same_space(db, sender_id, recipient_id)

    # **被引用的那条必须是这条线里的。** 只信客户端传来的 id 的话，任何人都能
    # 拿一个别的空间的消息 id 当引用——渲染时那段正文就跟着漏到这条线上来。
    if reply_to_id is not None:
        quoted = await db.get(DirectMessage, reply_to_id)
        if quoted is None or quoted.space_id != space.id:
            raise PartnerUnavailable("被引用的消息不在这段对话里。")

    message = DirectMessage(
        space_id=space.id,
        sender_id=sender_id,
        recipient_id=recipient_id,
        body=body.strip(),
        attachment_ids=attachment_ids,
        reply_to_id=reply_to_id,
    )
    db.add(message)
    await db.flush()
    return message


async def list_thread(
    db: AsyncSession,
    user_id: str,
    partner_id: str,
    limit: int = 200,
) -> list[DirectMessage]:
    """两个人之间的全部消息，按时间正序。"""
    rows = list(
        await db.scalars(
            select(DirectMessage)
            .where(
                or_(
                    (DirectMessage.sender_id == user_id)
                    & (DirectMessage.recipient_id == partner_id),
                    (DirectMessage.sender_id == partner_id)
                    & (DirectMessage.recipient_id == user_id),
                )
            )
            .order_by(DirectMessage.created_at.desc())
            .limit(max(1, min(limit, 500)))
        )
    )
    return list(reversed(rows))


async def mark_read(db: AsyncSession, user_id: str) -> int:
    """把发给我的未读全部标为已读，返回这次标记了几条。

    只标**发给我的**：自己发出去的没有已读概念。
    """
    unread = list(
        await db.scalars(
            select(DirectMessage).where(
                DirectMessage.recipient_id == user_id,
                DirectMessage.read_at.is_(None),
            )
        )
    )
    now = utcnow()
    for message in unread:
        message.read_at = now
    return len(unread)


async def unread_count(db: AsyncSession, user_id: str) -> int:
    return (
        await db.scalar(
            select(func.count(DirectMessage.id)).where(
                DirectMessage.recipient_id == user_id,
                DirectMessage.read_at.is_(None),
            )
        )
    ) or 0


async def oldest_unread(
    db: AsyncSession,
    user_id: str,
) -> DirectMessage | None:
    """收件人最早的一条未读。宠物的唠叨节奏按它的年龄算。"""
    return await db.scalar(
        select(DirectMessage)
        .where(
            DirectMessage.recipient_id == user_id,
            DirectMessage.read_at.is_(None),
        )
        .order_by(DirectMessage.created_at)
        .limit(1)
    )


#: 不进聊天记录的插话类型。
#:
#: `unread_nudge` 是「快去看消息」，说给还没打开聊天页的人听——等你真的在看这
#: 条流了，它的使命已经完成。留在记录里的唯一效果是：以后回看这段对话时，每两
#: 条消息之间夹一句「有新消息哦」，把真正说过的话冲淡。
#:
#: 它**照常落库**，只是不在这条流里显示：宠物的递减节奏（0/10/30 分钟后不再
#: 主动提）就是靠数这些行算「这是第几次」的，见 pet_mediation.count_interjections。
#: 真正的送达渠道是浮窗宠物的气泡（ChatMediationProvider → FloatingPet），
#: 那里说完就散，正好是这种话该有的生命周期。
#:
#: 代答（standin / company）不在此列：那是说给**在等的另一个人**听的，解释了
#: 对话里的那段空白，属于对话记录的一部分。
THREAD_HIDDEN_KINDS = frozenset({"unread_nudge"})


async def list_interjections(
    db: AsyncSession,
    audience_id: str,
    since: datetime | None = None,
    hide_kinds: frozenset[str] = THREAD_HIDDEN_KINDS,
) -> list[PetInterjection]:
    query = select(PetInterjection).where(PetInterjection.audience_id == audience_id)
    if hide_kinds:
        query = query.where(PetInterjection.kind.notin_(hide_kinds))
    if since is not None:
        query = query.where(PetInterjection.created_at >= since)
    else:
        # 默认只看最近一天的：更早的插话已经没有语境了
        query = query.where(PetInterjection.created_at >= utcnow() - timedelta(days=1))
    return list(await db.scalars(query.order_by(PetInterjection.created_at)))
