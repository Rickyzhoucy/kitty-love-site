from __future__ import annotations

import hashlib
import math
from collections import defaultdict
from datetime import UTC

from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.embeddings import EmbeddingProvider
from app.runtime_config import live
from app.models import (
    Companion,
    EmbeddingProfile,
    MemoryEmbedding,
    MemoryItem,
    utcnow,
)
from app.schemas import MemoryCreate

#: 二元组相似度到这个程度就当成同一件事。
#:
#: **用 2-gram 而不是检索那边的 3-gram**，这不是随手选的。实测中文语料：
#:
#: | 案例                | 3-gram | 2-gram |
#: |---------------------|--------|--------|
#: | 同义·只换语序        |  0.29  |  0.64  |
#: | 同义·加了个语气词    |  0.73  |  0.88  |
#: | 不同·只换宾语        |  0.29  |  0.27  |
#: | 不同·同句式反义      |  0.20  |  0.14  |
#:
#: 3-gram 下「换语序」和「换宾语」都是 0.29——**完全分不开**，拿它做去重要么
#: 全放过要么全误合。中文没有空格，3-gram 跨词切分，挪动一个双字词会打乱一大片；
#: 而多数中文词就是两个字，2-gram 近似于按词比对，所以能分开。
#:
#: 0.55 取在「同义最低 0.64」和「不同最高 0.33」之间。宁可漏合并——多一条近义
#: 记忆只是冗余，错误合并会让一件真事**永远进不了库**。
#:
#: 下面四个是**默认值**，实际取值在后台可改（`memory.*` 那一组）。它们留在
#: 这里而不是搬进注册表，是因为上面这段实测属于算法旁边；注册表里放的是同样
#: 的字面量，`test_memory_defaults_match_registry` 盯着两边不许漂移。
DEFAULT_NEAR_DUPLICATE_THRESHOLD = 0.55

#: 每次只跟最近这些条比。全表比对在条目多起来之后是平方级开销，而措辞重复
#: 几乎总是发生在相邻的几次反思之间。
DEFAULT_NEAR_DUPLICATE_SCAN = 60

#: 检索排序的时间半衰期（天）。
DEFAULT_RECENCY_HALF_LIFE_DAYS = 180.0

#: 衰减下限。「第一次见面」是两年前的事，不该因为年头久就检索不到。
DEFAULT_MIN_RECENCY_WEIGHT = 0.35


class MemoryService:
    def __init__(self, embedding_provider: EmbeddingProvider):
        if embedding_provider.dimensions != 1024:
            raise ValueError("MemoryEmbedding 固定使用 1024 维")
        self.embedding_provider = embedding_provider

    @staticmethod
    async def validate_companion(
        db: AsyncSession,
        owner_id: str,
        companion_id: str | None,
        *,
        required: bool = False,
    ) -> None:
        if companion_id is None:
            if required:
                raise ValueError("companion scope 必须指定 Companion")
            return
        companion = await db.get(Companion, companion_id)
        if companion is None or companion.owner_id != owner_id:
            raise ValueError("Companion 不存在")

    async def ensure_profile(self, db: AsyncSession) -> EmbeddingProfile:
        if db.get_bind().dialect.name == "postgresql":
            await db.execute(
                text("SELECT pg_advisory_xact_lock(hashtext('embedding-profile'))")
            )
        profile = await db.scalar(
            select(EmbeddingProfile).where(
                EmbeddingProfile.provider == self.embedding_provider.provider_name,
                EmbeddingProfile.model == self.embedding_provider.model_name,
                EmbeddingProfile.dimensions == self.embedding_provider.dimensions,
            )
        )
        if profile is None:
            version = (
                await db.scalar(select(func.max(EmbeddingProfile.version)))
            ) or 0
            current = await self.current_profile(db)
            profile = EmbeddingProfile(
                provider=self.embedding_provider.provider_name,
                model=self.embedding_provider.model_name,
                dimensions=self.embedding_provider.dimensions,
                version=version + 1,
                active=current is None,
            )
            db.add(profile)
            await db.flush()
        return profile

    @staticmethod
    async def current_profile(db: AsyncSession) -> EmbeddingProfile | None:
        return await db.scalar(
            select(EmbeddingProfile)
            .where(EmbeddingProfile.active.is_(True))
            .order_by(EmbeddingProfile.version.desc())
            .limit(1)
        )

    async def create(
        self,
        db: AsyncSession,
        owner_id: str,
        data: MemoryCreate,
        *,
        embed: bool = False,
    ) -> MemoryItem:
        await self.validate_companion(
            db,
            owner_id,
            data.companion_id,
            required=data.scope == "companion",
        )
        content_hash = hashlib.sha256(data.content.encode()).hexdigest()
        existing = await db.scalar(
            select(MemoryItem).where(
                MemoryItem.owner_id
                == (owner_id if data.scope != "shared" else None),
                MemoryItem.companion_id == data.companion_id,
                MemoryItem.scope == data.scope,
                MemoryItem.kind == data.kind,
                MemoryItem.content_hash == content_hash,
            )
        )
        if existing is not None:
            if embed:
                await self.embed_item(db, existing)
                await db.commit()
            return existing

        # 近义去重。哈希只挡得住一字不差的重复，而记忆是模型生成的散文——
        # 「他们今天一起看了电影」和「今天他们一起看了电影」哈希不同，语义
        # 完全一样。反复反思同一段经历会把检索池填满近义条目，真正不同的事
        # 反而被挤出前 8 条。
        #
        # 用词面相似度而不是 embedding：不花 API 调用，而这里要挡的正是措辞
        # 微调这种表层重复，词面比对对它足够敏感。真正的语义改写（换一套说法
        # 讲同一件事）挡不住，那个只能靠 embedding，代价是每写一条记忆多一次
        # API 调用——按现在的量不值得。
        near = await self._find_near_duplicate(
            db, owner_id, data, content_hash
        )
        if near is not None:
            # 同一件事又被提起一次，说明它更要紧，不是什么都没发生。
            near.importance = max(near.importance or 50, data.importance)
            if data.occurred_at is not None:
                near.occurred_at = data.occurred_at
            await db.commit()
            await db.refresh(near)
            return near

        item = MemoryItem(
            owner_id=owner_id if data.scope != "shared" else None,
            companion_id=data.companion_id,
            scope=data.scope,
            kind=data.kind,
            content=data.content,
            importance=data.importance,
            content_hash=content_hash,
            occurred_at=data.occurred_at,
        )
        db.add(item)
        await db.flush()
        if embed:
            await self.embed_item(db, item)
        await db.commit()
        await db.refresh(item)
        return item

    async def _find_near_duplicate(
        self,
        db: AsyncSession,
        owner_id: str,
        data: MemoryCreate,
        content_hash: str,
    ) -> MemoryItem | None:
        """在同一 scope/companion/kind 里找措辞不同但意思一样的旧条目。

        限定在同 kind 内比较：`preference`（喜欢吃辣）和 `experience`（今天吃了
        辣的）字面上很像，但它们是两类东西，合并会把「一次经历」误当成「长期
        偏好」。
        """
        candidates = list(
            await db.scalars(
                select(MemoryItem)
                .where(
                    MemoryItem.owner_id
                    == (owner_id if data.scope != "shared" else None),
                    MemoryItem.companion_id == data.companion_id,
                    MemoryItem.scope == data.scope,
                    MemoryItem.kind == data.kind,
                    MemoryItem.content_hash != content_hash,
                )
                .order_by(MemoryItem.created_at.desc())
                .limit(int(live("memory.near_duplicate_scan")))
            )
        )
        for candidate in candidates:
            score = self._bigram_similarity(data.content, candidate.content)
            if score >= float(live("memory.near_duplicate_threshold")):
                return candidate
        return None

    async def embed_item(self, db: AsyncSession, item: MemoryItem) -> MemoryEmbedding:
        profile = await self.ensure_profile(db)
        if db.get_bind().dialect.name == "postgresql":
            await db.execute(
                text(
                    "SELECT pg_advisory_xact_lock("
                    "hashtext(:embedding_lock_key))"
                ),
                {"embedding_lock_key": f"{profile.id}:{item.id}"},
            )
        vector = await self.embedding_provider.embed_query(item.content)
        existing = await db.scalar(
            select(MemoryEmbedding).where(
                MemoryEmbedding.memory_item_id == item.id,
                MemoryEmbedding.profile_id == profile.id,
            )
        )
        if existing:
            existing.embedding = vector
            return existing
        embedding = MemoryEmbedding(
            memory_item_id=item.id,
            profile_id=profile.id,
            embedding=vector,
        )
        db.add(embedding)
        return embedding

    def _profile_matches_provider(self, profile: EmbeddingProfile) -> bool:
        return (
            profile.provider == self.embedding_provider.provider_name
            and profile.model == self.embedding_provider.model_name
            and profile.dimensions == self.embedding_provider.dimensions
        )

    async def list(
        self,
        db: AsyncSession,
        owner_id: str,
        companion_id: str | None = None,
    ) -> list[MemoryItem]:
        await self.validate_companion(db, owner_id, companion_id)
        owned = MemoryItem.owner_id == owner_id
        if companion_id:
            owned = owned & or_(
                MemoryItem.companion_id.is_(None),
                MemoryItem.companion_id == companion_id,
            )
        scope = or_(MemoryItem.scope == "shared", owned)
        return list(
            await db.scalars(
                select(MemoryItem)
                .where(scope)
                .order_by(MemoryItem.created_at.desc())
                .limit(500)
            )
        )

    async def search(
        self,
        db: AsyncSession,
        owner_id: str,
        query: str,
        companion_id: str | None = None,
        limit: int = 8,
    ) -> list[MemoryItem]:
        items = await self.list(db, owner_id, companion_id)
        if not items:
            return []
        if db.get_bind().dialect.name == "postgresql":
            query_vector: list[float] | None = None
            # 无 active profile 或 profile 与 provider 不匹配时走纯词法检索，
            # 避免白调一次必然浪费/失败的 embedding API
            profile = await self.current_profile(db)
            if profile is not None and self._profile_matches_provider(profile):
                query_vector = await self.embedding_provider.embed_query(query)
            return await self._postgres_search(
                db, items, query, query_vector, profile, limit=limit
            )
        query_vector = await self.embedding_provider.embed_query(query)
        return await self._python_search(db, items, query, query_vector, limit=limit)

    async def _postgres_search(
        self,
        db: AsyncSession,
        items: list[MemoryItem],
        query: str,
        query_vector: list[float] | None,
        profile: EmbeddingProfile | None,
        *,
        limit: int,
    ) -> list[MemoryItem]:
        ids = [item.id for item in items]
        lexical = list(
            await db.scalars(
                select(MemoryItem)
                .where(MemoryItem.id.in_(ids))
                .order_by(func.similarity(MemoryItem.content, query).desc())
                .limit(limit * 3)
            )
        )
        if profile is None or query_vector is None:
            return lexical[:limit]
        semantic = list(
            await db.scalars(
                select(MemoryItem)
                .join(MemoryEmbedding, MemoryEmbedding.memory_item_id == MemoryItem.id)
                .join(
                    EmbeddingProfile,
                    EmbeddingProfile.id == MemoryEmbedding.profile_id,
                )
                .where(MemoryItem.id.in_(ids))
                .where(EmbeddingProfile.id == profile.id)
                .order_by(MemoryEmbedding.embedding.cosine_distance(query_vector))
                .limit(limit * 3)
            )
        )
        return self._rrf(lexical, semantic, limit)

    async def _python_search(
        self,
        db: AsyncSession,
        items: list[MemoryItem],
        query: str,
        query_vector: list[float],
        *,
        limit: int,
    ) -> list[MemoryItem]:
        lexical = sorted(
            items,
            key=lambda item: self._trigram_similarity(item.content, query),
            reverse=True,
        )
        profile = await self.current_profile(db)
        if profile is None or not self._profile_matches_provider(profile):
            return lexical[:limit]
        embeddings = list(
            await db.scalars(
                select(MemoryEmbedding).where(
                    MemoryEmbedding.memory_item_id.in_([item.id for item in items]),
                    MemoryEmbedding.profile_id == profile.id,
                )
            )
        )
        vectors = {embedding.memory_item_id: list(embedding.embedding) for embedding in embeddings}
        semantic = sorted(
            [item for item in items if item.id in vectors],
            key=lambda item: self._cosine(vectors[item.id], query_vector),
            reverse=True,
        )
        return self._rrf(lexical, semantic, limit)

    @staticmethod
    def _rrf(
        lexical: list[MemoryItem],
        semantic: list[MemoryItem],
        limit: int,
    ) -> list[MemoryItem]:
        scores: defaultdict[str, float] = defaultdict(float)
        lookup = {item.id: item for item in lexical + semantic}
        for rank, item in enumerate(lexical, 1):
            scores[item.id] += 1 / (60 + rank)
        for rank, item in enumerate(semantic, 1):
            scores[item.id] += 1 / (60 + rank)
        # 同分时让新的、重要的排前面。RRF 本身只看排名，不看条目属性——
        # 结果是半年前的琐事和昨天的大事权重一样，检索池越大这个问题越明显。
        ranked = sorted(
            scores,
            key=lambda item_id: (
                scores[item_id] * MemoryService._freshness(lookup[item_id])
            ),
            reverse=True,
        )
        return [lookup[item_id] for item_id in ranked[:limit]]

    @staticmethod
    def _freshness(item: MemoryItem) -> float:
        """时间衰减 × 重要度，作为 RRF 分数的乘数。

        **衰减但不清零**：半衰期 180 天，且乘数有下限——「我们第一次见面」是
        两年前的事，它不该因为年头久就检索不到。这里要的是「同等相关度下更偏
        新的」，不是「旧的就不算数」。

        重要度同理只做温和加权（最多 1.5 倍）：让它主导排序的话，反思给出的
        importance 稍有偏差就会长期霸榜。
        """
        occurred = item.occurred_at or item.created_at
        if occurred is None:
            return 1.0
        if occurred.tzinfo is None:
            occurred = occurred.replace(tzinfo=UTC)
        age_days = max(0.0, (utcnow() - occurred).total_seconds() / 86_400)
        recency = max(
            float(live("memory.min_recency_weight")),
            0.5 ** (age_days / float(live("memory.recency_half_life_days"))),
        )
        weight = 1.0 + (item.importance or 50) / 200
        return recency * weight

    @staticmethod
    def _bigram_similarity(left: str, right: str) -> float:
        """按二元组算 Jaccard 相似度。近义去重专用，理由见 DEFAULT_NEAR_DUPLICATE_THRESHOLD 上面那段实测。

        与下面的 `_trigram_similarity` 并存而不是替换它：那个是检索侧的词法打分，
        改动会连带影响排序行为，而这里要的是另一件事（判同）。
        """
        def bigrams(value: str) -> set[str]:
            text_value = value.lower().strip()
            if len(text_value) < 2:
                return {text_value} if text_value else set()
            return {
                text_value[index : index + 2]
                for index in range(len(text_value) - 1)
            }

        a, b = bigrams(left), bigrams(right)
        return len(a & b) / max(1, len(a | b))

    @staticmethod
    def _trigram_similarity(left: str, right: str) -> float:
        def trigrams(value: str) -> set[str]:
            padded = f"  {value.lower()} "
            return {padded[index : index + 3] for index in range(max(1, len(padded) - 2))}

        a, b = trigrams(left), trigrams(right)
        return len(a & b) / max(1, len(a | b))

    @staticmethod
    def _cosine(left: list[float], right: list[float]) -> float:
        numerator = sum(a * b for a, b in zip(left, right, strict=True))
        denominator = math.sqrt(sum(a * a for a in left)) * math.sqrt(
            sum(b * b for b in right)
        )
        return numerator / denominator if denominator else 0.0
