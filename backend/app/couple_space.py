"""情侣空间：共享记忆、私聊和感知的数据库租户边界。"""

from __future__ import annotations

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CoupleSpace, CoupleSpaceMember, User


class CoupleSpaceUnavailable(ValueError):
    pass


async def _lock(db: AsyncSession) -> None:
    if db.get_bind().dialect.name == "postgresql":
        await db.execute(text("SELECT pg_advisory_xact_lock(hashtext('couple-space'))"))


async def member_space(db: AsyncSession, user_id: str) -> CoupleSpace | None:
    return await db.scalar(
        select(CoupleSpace)
        .join(CoupleSpaceMember, CoupleSpaceMember.space_id == CoupleSpace.id)
        .where(CoupleSpaceMember.user_id == user_id)
        .limit(1)
    )


async def ensure_space(db: AsyncSession, user_id: str) -> CoupleSpace:
    """返回用户所在空间；当前双人产品只允许一个两人空间。"""

    await _lock(db)
    found = await member_space(db, user_id)
    user = await db.get(User, user_id)
    if user is None or not user.enabled:
        raise CoupleSpaceUnavailable("当前用户不可用")

    enabled_ids = list(
        await db.scalars(select(User.id).where(User.enabled.is_(True)).order_by(User.created_at))
    )
    if len(enabled_ids) > 2:
        raise CoupleSpaceUnavailable(
            f"可用账号超出这个站的设计（当前 {len(enabled_ids)} 个），无法安全确定情侣空间。"
        )

    candidate = found
    if candidate is None:
        candidate = await db.scalar(
            select(CoupleSpace)
            .outerjoin(CoupleSpaceMember, CoupleSpaceMember.space_id == CoupleSpace.id)
            .group_by(CoupleSpace.id)
            .having(func.count(CoupleSpaceMember.id) < 2)
            .order_by(CoupleSpace.created_at)
            .limit(1)
        )
    if candidate is None:
        candidate = CoupleSpace(name="我们的小世界")
        db.add(candidate)
        await db.flush()

    existing_ids = set(await member_ids(db, candidate.id))
    for enabled_id in enabled_ids:
        other_space = await member_space(db, enabled_id)
        if other_space is not None and other_space.id != candidate.id:
            raise CoupleSpaceUnavailable("账号已经属于另一个情侣空间")
        if enabled_id not in existing_ids:
            db.add(
                CoupleSpaceMember(
                    space_id=candidate.id,
                    user_id=enabled_id,
                    role="member",
                )
            )
    await db.flush()
    return candidate


async def member_ids(db: AsyncSession, space_id: str) -> list[str]:
    return list(
        await db.scalars(
            select(CoupleSpaceMember.user_id)
            .where(CoupleSpaceMember.space_id == space_id)
            .order_by(CoupleSpaceMember.created_at)
        )
    )


async def require_membership(
    db: AsyncSession,
    user_id: str,
    space_id: str,
) -> None:
    exists = await db.scalar(
        select(CoupleSpaceMember.id).where(
            CoupleSpaceMember.space_id == space_id,
            CoupleSpaceMember.user_id == user_id,
        )
    )
    if exists is None:
        raise CoupleSpaceUnavailable("没有这个情侣空间的访问权限")


async def require_same_space(
    db: AsyncSession,
    first_user_id: str,
    second_user_id: str,
) -> CoupleSpace:
    space = await ensure_space(db, first_user_id)
    await ensure_space(db, second_user_id)
    await require_membership(db, second_user_id, space.id)
    return space
