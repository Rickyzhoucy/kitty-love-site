from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.models import Companion, CompanionPetProfile, CompanionPetState, User
from app.pet_state import MAX_OFFLINE_SECONDS, elapsed_seconds, resolve_pet


def test_elapsed_is_capped_so_the_pet_never_starves():
    """离线太久也只按上限算，否则回来看到的是一只濒死的宠物。"""
    now = datetime(2026, 7, 29, 12, 0, tzinfo=UTC)
    long_ago = now - timedelta(days=30)
    assert elapsed_seconds(long_ago, now) == MAX_OFFLINE_SECONDS


def test_elapsed_never_goes_negative():
    """客户端时钟快于服务端时，负的衰减等于凭空回血。"""
    now = datetime(2026, 7, 29, 12, 0, tzinfo=UTC)
    future = now + timedelta(hours=3)
    assert elapsed_seconds(future, now) == 0.0


def test_naive_timestamps_are_read_as_utc():
    """SQLite 路径存的是 naive datetime，不统一解释就会差整整一个时区。"""
    now = datetime(2026, 7, 29, 12, 0, tzinfo=UTC)
    naive = datetime(2026, 7, 29, 11, 0)
    assert elapsed_seconds(naive, now) == 3600.0


async def test_resolve_pet_creates_companion_and_profile_once(session_maker):
    async with session_maker() as db:
        user_id = await db.scalar(select(User.id))
        companion, profile = await resolve_pet(db, user_id)
        await db.commit()
        first_ids = (companion.id, profile.id)

    async with session_maker() as db:
        companion, profile = await resolve_pet(db, user_id)
        await db.commit()
        assert (companion.id, profile.id) == first_ids
        assert await db.scalar(
            select(CompanionPetProfile).where(
                CompanionPetProfile.companion_id == companion.id
            )
        )


async def test_unknown_asset_falls_back_instead_of_serving_a_broken_id(
    session_maker,
):
    async with session_maker() as db:
        user_id = await db.scalar(select(User.id))
        _, profile = await resolve_pet(db, user_id)
        profile.body_asset_id = "asset-that-was-deleted"
        await db.commit()

    async with session_maker() as db:
        _, profile = await resolve_pet(db, user_id)
        await db.commit()
        assert profile.body_asset_id == "kitty"
        assert profile.species == "cat"


async def test_pet_state_round_trip_through_api(authenticated_client, session_maker):
    empty = await authenticated_client.get("/api/v1/pet/state")
    assert empty.status_code == 200
    assert empty.json()["needs"] is None
    assert empty.json()["elapsedSeconds"] == 0.0
    assert empty.json()["cappedAt"] == MAX_OFFLINE_SECONDS

    written = await authenticated_client.put(
        "/api/v1/pet/state",
        json={
            "needs": {"hunger": 0.4, "energy": 0.8},
            "mood": {"valence": 0.2, "arousal": 0.5, "emotion": "happy"},
            "relationship": {"familiarity": 0.3, "trust": 0.5, "level": 2},
            "activeGoal": "play",
            "traits": {"playful": 0.7},
        },
    )
    assert written.status_code == 200
    assert written.json()["activeGoal"] == "play"

    reread = await authenticated_client.get("/api/v1/pet/state")
    assert reread.json()["needs"]["hunger"] == 0.4
    assert reread.json()["relationship"]["level"] == 2
    assert reread.json()["traits"]["playful"] == 0.7
    # 刚写完就读，离线时长应当约等于 0。
    assert reread.json()["elapsedSeconds"] < 5


async def test_stale_snapshot_reports_capped_elapsed(
    authenticated_client,
    session_maker,
):
    await authenticated_client.put(
        "/api/v1/pet/state",
        json={"needs": {"hunger": 0.1}, "activeGoal": "idle"},
    )
    async with session_maker() as db:
        state = await db.scalar(select(CompanionPetState))
        state.evaluated_at = datetime.now(UTC) - timedelta(days=5)
        await db.commit()

    reread = await authenticated_client.get("/api/v1/pet/state")
    assert reread.json()["elapsedSeconds"] == MAX_OFFLINE_SECONDS


async def test_pet_state_is_scoped_to_the_caller(authenticated_client, session_maker):
    """两个人的宠物是两只，快照不能串。"""
    await authenticated_client.put(
        "/api/v1/pet/state",
        json={"needs": {"hunger": 0.9}, "activeGoal": "eat"},
    )
    async with session_maker() as db:
        owner_id = await db.scalar(select(User.id))
        companion = await db.scalar(
            select(Companion).where(Companion.owner_id == owner_id)
        )
        states = list(await db.scalars(select(CompanionPetState)))
    assert len(states) == 1
    assert states[0].companion_id == companion.id
