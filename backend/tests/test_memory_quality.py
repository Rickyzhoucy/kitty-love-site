"""记忆的两个质量问题：近义重复，和「旧的和新的一样重」。

这两件事在小数据量下都看不出来，攒上几个月才会显形：检索永远返回同一批措辞
略有出入的旧条目，真正相关的新事进不了前 8 条。所以用构造数据把它们钉住。
"""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.memory import (
    DEFAULT_MIN_RECENCY_WEIGHT,
    DEFAULT_NEAR_DUPLICATE_THRESHOLD,
    MemoryService,
)
from app.models import Companion, MemoryItem, User
from app.schemas import MemoryCreate


class _FakeEmbeddings:
    provider_name = "fake"
    model_name = "fake-1024"
    dimensions = 1024

    async def embed_query(self, text: str) -> list[float]:
        return [0.0] * 1024


def _service() -> MemoryService:
    return MemoryService(_FakeEmbeddings())


async def _companion(session_maker) -> tuple[str, str]:
    async with session_maker() as db:
        user = await db.scalar(select(User).limit(1))
        companion = Companion(owner_id=user.id, name="yo yo")
        db.add(companion)
        await db.commit()
        return user.id, companion.id


def _memory(content: str, **overrides) -> MemoryCreate:
    payload = {
        "scope": "companion",
        "kind": "experience",
        "content": content,
        "importance": 60,
    }
    payload.update(overrides)
    return MemoryCreate(**payload)


# ---- 近义去重 ----


async def test_reworded_memory_does_not_create_a_second_row(session_maker):
    """哈希挡不住语序调整，而记忆是模型生成的散文，措辞每次都不一样。"""
    owner, companion_id = await _companion(session_maker)
    service = _service()
    async with session_maker() as db:
        await service.create(
            db, owner, _memory("他们今天一起看了电影", companionId=companion_id)
        )
        await service.create(
            db, owner, _memory("今天他们一起看了电影", companionId=companion_id)
        )
        rows = list(await db.scalars(select(MemoryItem)))
    assert len(rows) == 1


async def test_repeating_a_memory_raises_its_importance(session_maker):
    """同一件事又被提起，说明它更要紧——不是什么都没发生。"""
    owner, companion_id = await _companion(session_maker)
    service = _service()
    async with session_maker() as db:
        first = await service.create(
            db,
            owner,
            _memory("他们一起去了海边", companionId=companion_id, importance=40),
        )
        again = await service.create(
            db,
            owner,
            _memory("他们一起去了海边呀", companionId=companion_id, importance=85),
        )
    assert again.id == first.id
    assert again.importance == 85


async def test_genuinely_different_events_are_both_kept(session_maker):
    """**比漏合并更糟的是错误合并**——那会让一件真事永远进不了库。"""
    owner, companion_id = await _companion(session_maker)
    service = _service()
    async with session_maker() as db:
        await service.create(
            db, owner, _memory("他们一起看了电影", companionId=companion_id)
        )
        await service.create(
            db, owner, _memory("他们一起吃了火锅", companionId=companion_id)
        )
        rows = list(await db.scalars(select(MemoryItem)))
    assert len(rows) == 2


async def test_same_words_different_kind_stay_separate(session_maker):
    """「喜欢吃辣」是偏好，「今天吃了辣的」是经历。合并会把一次经历
    误当成长期偏好。"""
    owner, companion_id = await _companion(session_maker)
    service = _service()
    async with session_maker() as db:
        await service.create(
            db,
            owner,
            _memory("他喜欢吃辣", companionId=companion_id, kind="preference"),
        )
        await service.create(
            db,
            owner,
            _memory("他喜欢吃辣", companionId=companion_id, kind="experience"),
        )
        rows = list(await db.scalars(select(MemoryItem)))
    assert len(rows) == 2


@pytest.mark.parametrize(
    ("left", "right"),
    [
        ("他们今天一起看了电影", "今天他们一起看了电影"),   # 只换语序
        ("他们一起去了海边", "他们一起去了海边呀"),         # 加了个语气词
    ],
)
def test_threshold_catches_rewording(left, right):
    assert MemoryService._bigram_similarity(left, right) >= DEFAULT_NEAR_DUPLICATE_THRESHOLD


@pytest.mark.parametrize(
    ("left", "right"),
    [
        ("他们一起看了电影", "他们一起吃了火锅"),   # 同句式换宾语
        ("他喜欢吃辣", "他讨厌吃辣"),               # 同句式反义
        ("他们一起看了电影", "她今天心情不好"),      # 完全无关
        ("他们今天一起看了电影", "今天两个人一起看了场电影"),  # 语义改写，词面差得远
    ],
)
def test_threshold_rejects_different_facts(left, right):
    """最后那条是刻意漏掉的：语义相同但词面差太远，词面比对够不着。

    漏合并只是多一条冗余记忆；把「看电影」和「吃火锅」合成一条，会让后者
    永远进不了库。所以阈值往保守取。
    """
    assert MemoryService._bigram_similarity(left, right) < DEFAULT_NEAR_DUPLICATE_THRESHOLD


def test_trigram_cannot_do_this_job_on_chinese():
    """记录选型依据：3-gram 下「换语序」和「换宾语」分数相同，无法判同。

    这条不是测功能，是防止有人「统一一下」把去重换回 _trigram_similarity。
    """
    reworded = MemoryService._trigram_similarity(
        "他们今天一起看了电影", "今天他们一起看了电影"
    )
    different = MemoryService._trigram_similarity(
        "他们一起看了电影", "他们一起吃了火锅"
    )
    assert abs(reworded - different) < 0.05  # 分不开


# ---- 时间衰减 ----


def _item(days_ago: float, importance: int = 50) -> MemoryItem:
    return MemoryItem(
        scope="companion",
        kind="experience",
        content="x",
        importance=importance,
        content_hash="h",
        occurred_at=datetime.now(UTC) - timedelta(days=days_ago),
    )


def test_recent_memories_outrank_old_ones_at_equal_relevance():
    fresh = MemoryService._freshness(_item(1))
    stale = MemoryService._freshness(_item(365))
    assert fresh > stale


def test_old_memories_never_decay_to_nothing():
    """「第一次见面」是两年前的事，不该因为年头久就检索不到。"""
    ancient = MemoryService._freshness(_item(3_650, importance=50))
    assert ancient >= DEFAULT_MIN_RECENCY_WEIGHT


def test_importance_only_nudges_the_ranking():
    """让重要度主导排序的话，反思给出的分数稍有偏差就会长期霸榜。"""
    trivial = MemoryService._freshness(_item(1, importance=0))
    critical = MemoryService._freshness(_item(1, importance=100))
    assert critical > trivial
    # 最多 1.5 倍，不是数量级差异
    assert critical / trivial <= 1.5


@pytest.mark.parametrize("days", [0, 30, 180, 720])
def test_freshness_is_always_positive(days):
    assert MemoryService._freshness(_item(days)) > 0


def test_missing_timestamps_do_not_crash_ranking():
    """老数据可能没有 occurredAt，不能因此排不了序。"""
    item = MemoryItem(
        scope="companion", kind="experience", content="x",
        importance=50, content_hash="h",
    )
    assert MemoryService._freshness(item) == 1.0


def test_memory_defaults_match_registry():
    """算法旁边的默认值，和后台注册表里的默认值，必须是同一个数。

    这两处**故意分开**：相似度阈值上面那段实测属于算法旁边，而后台要的是
    一个能渲染成表单的声明。分开的代价就是可能漂移——所以用这条测试钉住。
    改其中一处而不改另一处，这里会红。
    """
    from app import memory
    from app.runtime_config import BY_KEY

    pairs = {
        "memory.near_duplicate_threshold": memory.DEFAULT_NEAR_DUPLICATE_THRESHOLD,
        "memory.near_duplicate_scan": memory.DEFAULT_NEAR_DUPLICATE_SCAN,
        "memory.recency_half_life_days": memory.DEFAULT_RECENCY_HALF_LIFE_DAYS,
        "memory.min_recency_weight": memory.DEFAULT_MIN_RECENCY_WEIGHT,
    }
    for key, expected in pairs.items():
        assert BY_KEY[key].fallback == expected, f"{key} 与 memory.py 里的默认值不一致"
