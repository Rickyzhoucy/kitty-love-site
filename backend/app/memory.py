from __future__ import annotations

import hashlib
import math
from collections import defaultdict

from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.embeddings import EmbeddingProvider
from app.models import Companion, EmbeddingProfile, MemoryEmbedding, MemoryItem
from app.schemas import MemoryCreate


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

    async def rebuild_profile(self, db: AsyncSession) -> EmbeddingProfile:
        target = await self.ensure_profile(db)
        target = await db.scalar(
            select(EmbeddingProfile)
            .where(EmbeddingProfile.id == target.id)
            .with_for_update()
        )
        if target is None:
            raise RuntimeError("Embedding profile disappeared during rebuild")
        if target.active:
            return target
        items = list(await db.scalars(select(MemoryItem).order_by(MemoryItem.created_at)))
        for item in items:
            await self.embed_item(db, item)
            await db.flush()
        await db.execute(
            EmbeddingProfile.__table__.update().values(active=False)
        )
        target.active = True
        await db.commit()
        return target

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
        query_vector = await self.embedding_provider.embed_query(query)
        if db.get_bind().dialect.name == "postgresql":
            return await self._postgres_search(
                db, items, query, query_vector, limit=limit
            )
        return await self._python_search(db, items, query, query_vector, limit=limit)

    async def _postgres_search(
        self,
        db: AsyncSession,
        items: list[MemoryItem],
        query: str,
        query_vector: list[float],
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
        profile = await self.current_profile(db)
        if profile is None or not self._profile_matches_provider(profile):
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
        return [lookup[item_id] for item_id in sorted(scores, key=scores.get, reverse=True)[:limit]]

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
