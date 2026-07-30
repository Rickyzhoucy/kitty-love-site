"""宠物身份与状态的服务层（架构文档 §11）。

`Companion` 是宠物的统一身份，本模块负责它的两张附属表：

- `CompanionPetProfile` —— 出生就定下的（物种、身体资源、性格、生日）
- `CompanionPetState`   —— 随时间漂移的（需求、情绪、关系、当前目标）

**离线结算的分工**：服务端只负责存快照并把「离开了多久」夹到上限，真正的
衰减计算留在客户端 `brain/needs.ts` 的 `settleElapsed` 里。把那套衰减公式
在 Python 里再写一遍，等于让同一个物理模型有两份实现——它们一定会漂。
上限（架构文档 §6.2 的「离线超过 12 小时按 12 小时算」）是服务端的职责，
因为那是防止「回来看到一只濒死的宠物」的策略，不能交给客户端自觉。
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Companion,
    CompanionPetProfile,
    CompanionPetState,
    utcnow,
)

#: 离线结算的时长上限。超过这个时长一律按这个时长算。
MAX_OFFLINE_SECONDS = 12 * 60 * 60

DEFAULT_ASSET = "kitty"

ALLOWED_ASSETS = frozenset(
    {"kitty", "momo", "hello-kitty", "snoopy", "shiba", "bichon"}
)

#: 资源 id → 物种。与迁移 0013 的表保持一致。
SPECIES_BY_ASSET = {
    "shiba": "dog",
    "bichon": "dog",
    "snoopy": "dog",
    "kitty": "cat",
    "hello-kitty": "cat",
    "momo": "cat",
}


def species_of(asset_id: str) -> str:
    return SPECIES_BY_ASSET.get(asset_id, "cat")


async def owned_companion(db: AsyncSession, user_id: str) -> Companion:
    """取用户的伴侣，没有就建一个。

    刻意不复用 `ConversationService.ensure_companion`——那个还要建人格、
    做 checkpoint 命名，宠物这条路径不需要，也不该被它的失败拖下水。
    """
    companion = await db.scalar(
        select(Companion).where(Companion.owner_id == user_id)
    )
    if companion is None:
        companion = Companion(owner_id=user_id, name="Kitty")
        db.add(companion)
        await db.flush()
    return companion


async def get_or_create_profile(
    db: AsyncSession,
    companion: Companion,
) -> CompanionPetProfile:
    profile = await db.scalar(
        select(CompanionPetProfile).where(
            CompanionPetProfile.companion_id == companion.id
        )
    )
    if profile is None:
        profile = CompanionPetProfile(
            companion_id=companion.id,
            species=species_of(DEFAULT_ASSET),
            body_asset_id=DEFAULT_ASSET,
        )
        db.add(profile)
        await db.flush()
    elif profile.body_asset_id not in ALLOWED_ASSETS:
        # 资源被删或改名后回落到默认，避免前端拿到一个加载不出来的 id。
        profile.body_asset_id = DEFAULT_ASSET
        profile.species = species_of(DEFAULT_ASSET)
    return profile


async def resolve_pet(
    db: AsyncSession,
    user_id: str,
) -> tuple[Companion, CompanionPetProfile]:
    companion = await owned_companion(db, user_id)
    profile = await get_or_create_profile(db, companion)
    return companion, profile


def elapsed_seconds(evaluated_at: datetime, now: datetime | None = None) -> float:
    """距上次结算过了多久，已夹到 `MAX_OFFLINE_SECONDS`。

    数据库里可能存着 naive datetime（SQLite 路径），统一按 UTC 解释。
    """
    now = now or utcnow()
    if evaluated_at.tzinfo is None:
        evaluated_at = evaluated_at.replace(tzinfo=UTC)
    if now.tzinfo is None:
        now = now.replace(tzinfo=UTC)
    delta = (now - evaluated_at).total_seconds()
    # 客户端时钟快于服务端时会算出负数，负的衰减等于凭空回血。
    return max(0.0, min(delta, MAX_OFFLINE_SECONDS))


async def load_state(
    db: AsyncSession,
    companion: Companion,
) -> CompanionPetState | None:
    return await db.scalar(
        select(CompanionPetState).where(
            CompanionPetState.companion_id == companion.id
        )
    )


async def save_state(
    db: AsyncSession,
    companion: Companion,
    *,
    needs: dict,
    mood: dict,
    relationship: dict,
    active_goal: str,
) -> CompanionPetState:
    state = await load_state(db, companion)
    if state is None:
        state = CompanionPetState(companion_id=companion.id)
        db.add(state)
    state.needs = needs
    state.mood = mood
    state.relationship = relationship
    state.active_goal = active_goal
    state.evaluated_at = utcnow()
    return state
