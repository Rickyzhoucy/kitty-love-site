from __future__ import annotations

import hashlib
import math
from collections import defaultdict
from datetime import UTC
from typing import Any

from sqlalchemy import delete, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.couple_space import ensure_space, require_membership
from app.embeddings import EmbeddingProvider
from app.memory_policy import assert_memory_allowed
from app.models import (
    ActionReceipt,
    ChatMessage,
    Companion,
    Conversation,
    DirectMessage,
    EmbeddingProfile,
    MemoryEvidence,
    MemoryExclusion,
    MemoryPreference,
    MemoryRecord,
    MemoryRecordEmbedding,
    MemoryRevision,
    utcnow,
)
from app.runtime_config import get as get_runtime_config
from app.runtime_config import live
from app.schemas import MemoryCorrect, MemoryCreate

DEFAULT_NEAR_DUPLICATE_THRESHOLD = 0.55
DEFAULT_NEAR_DUPLICATE_SCAN = 60
DEFAULT_RECENCY_HALF_LIFE_DAYS = 180.0
DEFAULT_MIN_RECENCY_WEIGHT = 0.35

NORMAL_VISIBILITIES = frozenset({"user_private", "couple_shared", "companion_relationship"})


class MemoryService:
    """新版本长期记忆服务；所有路径共享同一套权限、证据和污染防线。"""

    def __init__(self, embedding_provider: EmbeddingProvider):
        if embedding_provider.dimensions != 1024:
            raise ValueError("MemoryRecordEmbedding 固定使用 1024 维")
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
                raise ValueError("companion_relationship 必须指定 Companion")
            return
        companion = await db.get(Companion, companion_id)
        if companion is None or companion.owner_id != owner_id:
            raise ValueError("Companion 不存在")

    async def ensure_profile(self, db: AsyncSession) -> EmbeddingProfile:
        if db.get_bind().dialect.name == "postgresql":
            await db.execute(text("SELECT pg_advisory_xact_lock(hashtext('embedding-profile'))"))
        profile = await db.scalar(
            select(EmbeddingProfile).where(
                EmbeddingProfile.provider == self.embedding_provider.provider_name,
                EmbeddingProfile.model == self.embedding_provider.model_name,
                EmbeddingProfile.dimensions == self.embedding_provider.dimensions,
            )
        )
        if profile is None:
            version = (await db.scalar(select(func.max(EmbeddingProfile.version)))) or 0
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

    @staticmethod
    def _normalized_key(data: MemoryCreate) -> str:
        if data.predicate:
            return ":".join(
                [
                    data.subject_type.strip().lower(),
                    (data.subject_id or "").strip().lower(),
                    data.predicate.strip().lower(),
                    data.memory_type,
                ]
            )[:255]
        return hashlib.sha256(
            "|".join([data.memory_type, " ".join(data.content.lower().split())]).encode()
        ).hexdigest()

    @staticmethod
    def _snapshot(item: MemoryRecord) -> dict[str, Any]:
        return {
            "visibility": item.visibility,
            "memoryType": item.memory_type,
            "content": item.content,
            "confidence": item.confidence,
            "importance": item.importance,
            "sensitivity": item.sensitivity,
            "status": item.status,
            "validFrom": item.valid_from.isoformat() if item.valid_from else None,
            "validTo": item.valid_to.isoformat() if item.valid_to else None,
        }

    @staticmethod
    def _revision(
        memory_id: str,
        operation: str,
        actor_type: str,
        actor_id: str | None,
        *,
        before: dict[str, Any] | None = None,
        after: dict[str, Any] | None = None,
        reason: str = "",
    ) -> MemoryRevision:
        return MemoryRevision(
            memory_id=memory_id,
            operation=operation,
            before_json=before,
            after_json=after,
            actor_type=actor_type,
            actor_id=actor_id,
            reason=reason,
        )

    async def _validate_source(
        self,
        db: AsyncSession,
        actor_user_id: str,
        space_id: str,
        source_type: str,
        source_id: str,
    ) -> tuple[str | None, str | None]:
        if source_type == "chat_message":
            row = await db.execute(
                select(ChatMessage, Conversation)
                .join(Conversation, Conversation.id == ChatMessage.conversation_id)
                .where(ChatMessage.id == source_id)
            )
            found = row.first()
            if found is None:
                raise ValueError("记忆来源消息不存在")
            message, conversation = found
            if conversation.user_id != actor_user_id or conversation.space_id != space_id:
                raise ValueError("记忆来源消息不可见")
            if message.memory_excluded:
                raise ValueError("这条消息已排除记忆")
            return actor_user_id if message.role == "user" else None, message.content

        if source_type == "direct_message":
            message = await db.get(DirectMessage, source_id)
            if message is None or message.space_id != space_id:
                raise ValueError("私聊记忆来源不存在")
            if actor_user_id not in {message.sender_id, message.recipient_id}:
                raise ValueError("私聊记忆来源不可见")
            if message.memory_excluded:
                raise ValueError("这条私聊已排除记忆")
            return message.sender_id, message.body

        return actor_user_id, None

    async def _add_evidence(
        self,
        db: AsyncSession,
        item: MemoryRecord,
        actor_user_id: str,
        data: MemoryCreate,
    ) -> None:
        source_ids = list(dict.fromkeys(data.source_ids)) or [item.id]
        for source_id in source_ids:
            actor_id, source_text = await self._validate_source(
                db,
                actor_user_id,
                item.space_id,
                data.source_type,
                source_id,
            )
            excerpt = data.source_excerpt or source_text or data.content
            excerpt = " ".join(excerpt.strip().split())[:240]
            excerpt_hash = hashlib.sha256(excerpt.encode()).hexdigest()
            existing = await db.scalar(
                select(MemoryEvidence.id).where(
                    MemoryEvidence.memory_id == item.id,
                    MemoryEvidence.source_type == data.source_type,
                    MemoryEvidence.source_id == source_id,
                )
            )
            if existing is not None:
                continue
            db.add(
                MemoryEvidence(
                    memory_id=item.id,
                    source_type=data.source_type,
                    source_id=source_id,
                    actor_user_id=actor_id,
                    excerpt=(excerpt if item.sensitivity == "normal" else None),
                    excerpt_hash=excerpt_hash,
                    observed_at=utcnow(),
                    extractor_version=data.extractor_version,
                )
            )

    async def create(
        self,
        db: AsyncSession,
        actor_user_id: str,
        data: MemoryCreate,
        *,
        embed: bool = False,
        commit: bool = True,
    ) -> MemoryRecord:
        policy = assert_memory_allowed(
            data.content,
            proposed_kind=data.memory_type,
            source_type=data.source_type,
        )
        if data.visibility not in NORMAL_VISIBILITIES:
            raise ValueError("未知记忆作用域")
        space = await ensure_space(db, actor_user_id)
        await require_membership(db, actor_user_id, space.id)
        await self.validate_companion(
            db,
            actor_user_id,
            data.companion_id,
            required=data.visibility == "companion_relationship",
        )
        if data.visibility != "companion_relationship" and data.companion_id:
            await self.validate_companion(db, actor_user_id, data.companion_id)

        owner_id = None if data.visibility == "couple_shared" else actor_user_id
        companion_id = data.companion_id if data.visibility == "companion_relationship" else None
        content = " ".join(data.content.strip().split())
        content_hash = hashlib.sha256(content.encode()).hexdigest()
        normalized_key = self._normalized_key(data)
        sensitivity = data.sensitivity if data.sensitivity != "normal" else policy.sensitivity
        auto_activate_confidence = float(
            await get_runtime_config(db, "memory.auto_activate_confidence")
        )
        target_status = (
            "active"
            if data.source_type == "explicit_user" or data.confidence >= auto_activate_confidence
            else "pending_review"
        )

        existing = await db.scalar(
            select(MemoryRecord).where(
                MemoryRecord.space_id == space.id,
                MemoryRecord.visibility == data.visibility,
                MemoryRecord.owner_id == owner_id,
                MemoryRecord.companion_id == companion_id,
                MemoryRecord.memory_type == data.memory_type,
                MemoryRecord.content_hash == content_hash,
                MemoryRecord.status.in_(("active", "pending_review")),
            )
        )
        if existing is not None:
            before = self._snapshot(existing)
            existing.importance = max(existing.importance, data.importance)
            existing.confidence = max(existing.confidence, data.confidence)
            if target_status == "active":
                existing.status = "active"
            existing.last_confirmed_at = utcnow()
            await self._add_evidence(db, existing, actor_user_id, data)
            db.add(
                self._revision(
                    existing.id,
                    "merge",
                    "user" if data.source_type == "explicit_user" else "system",
                    actor_user_id,
                    before=before,
                    after=self._snapshot(existing),
                    reason="same_content_reinforced",
                )
            )
            if embed:
                await self.embed_item(db, existing)
            if commit:
                await db.commit()
                await db.refresh(existing)
            return existing

        near = await self._find_near_duplicate(
            db,
            space.id,
            owner_id,
            companion_id,
            data,
            content_hash,
        )
        if near is not None:
            before = self._snapshot(near)
            near.importance = max(near.importance, data.importance)
            near.confidence = max(near.confidence, data.confidence)
            if target_status == "active":
                near.status = "active"
            near.last_confirmed_at = utcnow()
            await self._add_evidence(db, near, actor_user_id, data)
            db.add(
                self._revision(
                    near.id,
                    "merge",
                    "user" if data.source_type == "explicit_user" else "system",
                    actor_user_id,
                    before=before,
                    after=self._snapshot(near),
                    reason="near_duplicate_reinforced",
                )
            )
            if commit:
                await db.commit()
                await db.refresh(near)
            return near

        superseded = None
        if data.predicate and target_status == "active":
            superseded = await db.scalar(
                select(MemoryRecord)
                .where(
                    MemoryRecord.space_id == space.id,
                    MemoryRecord.visibility == data.visibility,
                    MemoryRecord.owner_id == owner_id,
                    MemoryRecord.companion_id == companion_id,
                    MemoryRecord.normalized_key == normalized_key,
                    MemoryRecord.status == "active",
                )
                .order_by(MemoryRecord.created_at.desc())
                .limit(1)
            )

        now = utcnow()
        item = MemoryRecord(
            space_id=space.id,
            visibility=data.visibility,
            owner_id=owner_id,
            companion_id=companion_id,
            memory_type=data.memory_type,
            content=content,
            subject_type=data.subject_type,
            subject_id=data.subject_id,
            predicate=data.predicate,
            object_json=data.object_json,
            confidence=data.confidence,
            importance=data.importance,
            sensitivity=sensitivity,
            status=target_status,
            content_hash=content_hash,
            normalized_key=normalized_key,
            valid_from=data.valid_from,
            valid_to=data.valid_to,
            occurred_at=data.occurred_at,
            last_confirmed_at=now,
            supersedes_id=superseded.id if superseded else None,
            extractor_version=data.extractor_version,
            created_by_kind=("user" if data.source_type == "explicit_user" else "system"),
        )
        db.add(item)
        await db.flush()
        await self._add_evidence(db, item, actor_user_id, data)
        db.add(
            self._revision(
                item.id,
                "create",
                item.created_by_kind,
                actor_user_id,
                after=self._snapshot(item),
            )
        )
        if superseded is not None:
            before = self._snapshot(superseded)
            superseded.status = "superseded"
            superseded.valid_to = data.valid_from or now
            db.add(
                self._revision(
                    superseded.id,
                    "supersede",
                    item.created_by_kind,
                    actor_user_id,
                    before=before,
                    after=self._snapshot(superseded),
                    reason=f"replaced_by:{item.id}",
                )
            )
        if embed:
            await self.embed_item(db, item)
        if commit:
            await db.commit()
            await db.refresh(item)
        return item

    async def _find_near_duplicate(
        self,
        db: AsyncSession,
        space_id: str,
        owner_id: str | None,
        companion_id: str | None,
        data: MemoryCreate,
        content_hash: str,
    ) -> MemoryRecord | None:
        candidates = list(
            await db.scalars(
                select(MemoryRecord)
                .where(
                    MemoryRecord.space_id == space_id,
                    MemoryRecord.visibility == data.visibility,
                    MemoryRecord.owner_id == owner_id,
                    MemoryRecord.companion_id == companion_id,
                    MemoryRecord.memory_type == data.memory_type,
                    MemoryRecord.content_hash != content_hash,
                    MemoryRecord.status == "active",
                )
                .order_by(MemoryRecord.created_at.desc())
                .limit(int(live("memory.near_duplicate_scan")))
            )
        )
        for candidate in candidates:
            if self._bigram_similarity(data.content, candidate.content) >= float(
                live("memory.near_duplicate_threshold")
            ):
                return candidate
        return None

    async def embed_item(
        self,
        db: AsyncSession,
        item: MemoryRecord,
    ) -> MemoryRecordEmbedding:
        profile = await self.ensure_profile(db)
        if db.get_bind().dialect.name == "postgresql":
            await db.execute(
                text("SELECT pg_advisory_xact_lock(hashtext(:embedding_lock_key))"),
                {"embedding_lock_key": f"{profile.id}:{item.id}"},
            )
        vector = await self.embedding_provider.embed_query(item.content)
        existing = await db.scalar(
            select(MemoryRecordEmbedding).where(
                MemoryRecordEmbedding.memory_id == item.id,
                MemoryRecordEmbedding.profile_id == profile.id,
            )
        )
        if existing is not None:
            existing.embedding = vector
            return existing
        embedding = MemoryRecordEmbedding(
            memory_id=item.id,
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
        user_id: str,
        companion_id: str | None = None,
        *,
        visibility: str | None = None,
        status: str = "active",
        include_sensitive: bool = True,
        limit: int = 500,
    ) -> list[MemoryRecord]:
        space = await ensure_space(db, user_id)
        await self.validate_companion(db, user_id, companion_id)
        visible = or_(
            (MemoryRecord.visibility == "couple_shared") & (MemoryRecord.space_id == space.id),
            (MemoryRecord.visibility == "user_private") & (MemoryRecord.owner_id == user_id),
            (MemoryRecord.visibility == "companion_relationship")
            & (MemoryRecord.owner_id == user_id)
            & (
                MemoryRecord.companion_id == companion_id
                if companion_id
                else MemoryRecord.companion_id.is_not(None)
            ),
        )
        query = select(MemoryRecord).where(visible)
        if visibility:
            query = query.where(MemoryRecord.visibility == visibility)
        if status:
            query = query.where(MemoryRecord.status == status)
        if not include_sensitive:
            query = query.where(MemoryRecord.sensitivity == "normal")
        if status == "active":
            query = query.where(
                or_(MemoryRecord.valid_to.is_(None), MemoryRecord.valid_to > utcnow())
            )
        return list(
            await db.scalars(
                query.order_by(MemoryRecord.created_at.desc()).limit(max(1, min(limit, 500)))
            )
        )

    async def search(
        self,
        db: AsyncSession,
        user_id: str,
        query: str,
        companion_id: str | None = None,
        *,
        role: str = "conversation",
        limit: int = 8,
    ) -> list[MemoryRecord]:
        visibility = "couple_shared" if role == "assist" else None
        items = await self.list(
            db,
            user_id,
            companion_id,
            visibility=visibility,
            include_sensitive=role == "conversation",
        )
        if not items:
            return []
        if db.get_bind().dialect.name == "postgresql":
            profile = await self.current_profile(db)
            query_vector: list[float] | None = None
            if profile is not None and self._profile_matches_provider(profile):
                try:
                    query_vector = await self.embedding_provider.embed_query(query)
                except Exception:
                    query_vector = None
            ranked = await self._postgres_search(
                db, items, query, query_vector, profile, limit=limit
            )
        else:
            profile = await self.current_profile(db)
            query_vector = None
            if profile is not None and self._profile_matches_provider(profile):
                try:
                    query_vector = await self.embedding_provider.embed_query(query)
                except Exception:
                    query_vector = None
            ranked = await self._python_search(db, items, query, query_vector, profile, limit=limit)
        now = utcnow()
        for item in ranked:
            item.last_accessed_at = now
            item.access_count += 1
        await db.flush()
        return ranked

    async def _postgres_search(
        self,
        db: AsyncSession,
        items: list[MemoryRecord],
        query: str,
        query_vector: list[float] | None,
        profile: EmbeddingProfile | None,
        *,
        limit: int,
    ) -> list[MemoryRecord]:
        ids = [item.id for item in items]
        lexical = list(
            await db.scalars(
                select(MemoryRecord)
                .where(MemoryRecord.id.in_(ids))
                .order_by(func.similarity(MemoryRecord.content, query).desc())
                .limit(limit * 3)
            )
        )
        if profile is None or query_vector is None:
            return sorted(
                lexical,
                key=self._freshness,
                reverse=True,
            )[:limit]
        semantic = list(
            await db.scalars(
                select(MemoryRecord)
                .join(
                    MemoryRecordEmbedding,
                    MemoryRecordEmbedding.memory_id == MemoryRecord.id,
                )
                .where(
                    MemoryRecord.id.in_(ids),
                    MemoryRecordEmbedding.profile_id == profile.id,
                )
                .order_by(MemoryRecordEmbedding.embedding.cosine_distance(query_vector))
                .limit(limit * 3)
            )
        )
        return self._rrf(lexical, semantic, limit)

    async def _python_search(
        self,
        db: AsyncSession,
        items: list[MemoryRecord],
        query: str,
        query_vector: list[float] | None,
        profile: EmbeddingProfile | None,
        *,
        limit: int,
    ) -> list[MemoryRecord]:
        lexical = sorted(
            items,
            key=lambda item: self._trigram_similarity(item.content, query),
            reverse=True,
        )
        if profile is None or query_vector is None:
            return sorted(lexical, key=self._freshness, reverse=True)[:limit]
        embeddings = list(
            await db.scalars(
                select(MemoryRecordEmbedding).where(
                    MemoryRecordEmbedding.memory_id.in_([item.id for item in items]),
                    MemoryRecordEmbedding.profile_id == profile.id,
                )
            )
        )
        vectors = {embedding.memory_id: list(embedding.embedding) for embedding in embeddings}
        semantic = sorted(
            [item for item in items if item.id in vectors],
            key=lambda item: self._cosine(vectors[item.id], query_vector),
            reverse=True,
        )
        return self._rrf(lexical, semantic, limit)

    @staticmethod
    def _rrf(
        lexical: list[MemoryRecord],
        semantic: list[MemoryRecord],
        limit: int,
    ) -> list[MemoryRecord]:
        scores: defaultdict[str, float] = defaultdict(float)
        lookup = {item.id: item for item in lexical + semantic}
        for rank, item in enumerate(lexical, 1):
            scores[item.id] += 1 / (60 + rank)
        for rank, item in enumerate(semantic, 1):
            scores[item.id] += 1 / (60 + rank)
        ranked = sorted(
            scores,
            key=lambda item_id: scores[item_id] * MemoryService._freshness(lookup[item_id]),
            reverse=True,
        )
        return [lookup[item_id] for item_id in ranked[:limit]]

    @staticmethod
    def _freshness(item: MemoryRecord) -> float:
        occurred = item.occurred_at or item.created_at
        if occurred is None:
            return 1.0
        if occurred.tzinfo is None:
            occurred = occurred.replace(tzinfo=UTC)
        age_days = max(0.0, (utcnow() - occurred).total_seconds() / 86_400)
        recency_floor = (
            0.5
            if item.memory_type in {"fact", "preference"}
            else float(live("memory.min_recency_weight"))
        )
        recency = max(
            recency_floor,
            0.5 ** (age_days / float(live("memory.recency_half_life_days"))),
        )
        item_importance = item.importance if item.importance is not None else 50
        item_confidence = item.confidence if item.confidence is not None else 1.0
        importance = 1.0 + item_importance / 200
        confidence = 0.75 + max(0.0, min(1.0, item_confidence)) / 4
        return recency * importance * confidence

    async def format_context(
        self,
        db: AsyncSession,
        items: list[MemoryRecord],
    ) -> str:
        if not items:
            return ""
        evidence_rows = list(
            await db.scalars(
                select(MemoryEvidence)
                .where(MemoryEvidence.memory_id.in_([item.id for item in items]))
                .order_by(MemoryEvidence.observed_at.desc())
            )
        )
        evidence_by_memory: dict[str, MemoryEvidence] = {}
        for evidence in evidence_rows:
            evidence_by_memory.setdefault(evidence.memory_id, evidence)
        lines: list[str] = []
        for item in items:
            evidence = evidence_by_memory.get(item.id)
            source = evidence.source_type if evidence else "unknown"
            observed = evidence.observed_at.date().isoformat() if evidence else "unknown"
            lines.append(
                f"- [memory:{item.id}][{item.visibility}/{item.memory_type}]"
                f"[source:{source}@{observed}] {item.content}"
            )
        return "\n".join(lines)

    async def correct(
        self,
        db: AsyncSession,
        actor_user_id: str,
        memory_id: str,
        data: MemoryCorrect,
    ) -> tuple[MemoryRecord, ActionReceipt]:
        old = await self.get(db, actor_user_id, memory_id, allow_inactive=True)
        policy = assert_memory_allowed(data.content, proposed_kind=old.memory_type)
        now = utcnow()
        new = MemoryRecord(
            space_id=old.space_id,
            visibility=old.visibility,
            owner_id=old.owner_id,
            companion_id=old.companion_id,
            memory_type=old.memory_type,
            content=" ".join(data.content.strip().split()),
            subject_type=old.subject_type,
            subject_id=old.subject_id,
            predicate=old.predicate,
            object_json=old.object_json,
            confidence=1.0,
            importance=data.importance if data.importance is not None else old.importance,
            sensitivity=data.sensitivity or policy.sensitivity,
            status="active",
            content_hash=hashlib.sha256(data.content.strip().encode()).hexdigest(),
            normalized_key=old.normalized_key,
            valid_from=data.valid_from or now,
            occurred_at=old.occurred_at,
            last_confirmed_at=now,
            supersedes_id=old.id,
            extractor_version="explicit-correct-v1",
            created_by_kind="user",
        )
        db.add(new)
        await db.flush()
        before = self._snapshot(old)
        old.status = "superseded"
        old.valid_to = new.valid_from
        db.add(
            self._revision(
                old.id,
                "supersede",
                "user",
                actor_user_id,
                before=before,
                after=self._snapshot(old),
                reason=f"corrected_by:{new.id}",
            )
        )
        db.add(
            self._revision(
                new.id,
                "correct",
                "user",
                actor_user_id,
                before=before,
                after=self._snapshot(new),
                reason=data.reason,
            )
        )
        await self._add_evidence(
            db,
            new,
            actor_user_id,
            MemoryCreate(
                visibility=new.visibility,
                memory_type=new.memory_type,
                content=new.content,
                importance=new.importance,
                confidence=1.0,
                sensitivity=new.sensitivity,
                companion_id=new.companion_id,
                subject_type=new.subject_type,
                subject_id=new.subject_id,
                predicate=new.predicate,
                object_json=new.object_json,
                valid_from=new.valid_from,
                occurred_at=new.occurred_at,
                source_type="explicit_user",
                extractor_version="explicit-correct-v1",
            ),
        )
        receipt = self._receipt(
            old.space_id,
            actor_user_id,
            "memory.correct",
            new.id,
            f"已更正记忆：{new.content[:80]}",
        )
        db.add(receipt)
        await db.commit()
        await db.refresh(new)
        await db.refresh(receipt)
        return new, receipt

    async def get(
        self,
        db: AsyncSession,
        user_id: str,
        memory_id: str,
        *,
        allow_inactive: bool = False,
    ) -> MemoryRecord:
        item = await db.get(MemoryRecord, memory_id)
        space = await ensure_space(db, user_id)
        permitted = bool(
            item
            and item.space_id == space.id
            and (item.visibility == "couple_shared" or item.owner_id == user_id)
            and (allow_inactive or item.status == "active")
        )
        if not permitted or item is None:
            raise LookupError("记忆不存在")
        return item

    @staticmethod
    def _receipt(
        space_id: str,
        user_id: str,
        action_type: str,
        resource_id: str | None,
        summary: str,
        *,
        conversation_id: str | None = None,
        source_message_id: str | None = None,
    ) -> ActionReceipt:
        now = utcnow()
        return ActionReceipt(
            space_id=space_id,
            user_id=user_id,
            conversation_id=conversation_id,
            source_message_id=source_message_id,
            action_type=action_type,
            resource_type="memory",
            resource_id=resource_id,
            status="committed",
            safe_summary=summary,
            committed_at=now,
        )

    async def create_with_receipt(
        self,
        db: AsyncSession,
        actor_user_id: str,
        data: MemoryCreate,
        *,
        conversation_id: str | None = None,
        source_message_id: str | None = None,
    ) -> tuple[MemoryRecord, ActionReceipt]:
        item = await self.create(db, actor_user_id, data, commit=False)
        receipt = self._receipt(
            item.space_id,
            actor_user_id,
            "memory.create",
            item.id,
            f"已记住：{item.content[:80]}",
            conversation_id=conversation_id,
            source_message_id=source_message_id,
        )
        db.add(receipt)
        await db.commit()
        await db.refresh(item)
        await db.refresh(receipt)
        return item, receipt

    async def retract(
        self,
        db: AsyncSession,
        actor_user_id: str,
        memory_id: str,
        *,
        reason: str = "用户删除",
    ) -> tuple[MemoryRecord, ActionReceipt]:
        item = await self.get(db, actor_user_id, memory_id, allow_inactive=True)
        before = self._snapshot(item)
        item.status = "retracted"
        item.valid_to = item.valid_to or utcnow()
        db.add(
            self._revision(
                item.id,
                "retract",
                "user",
                actor_user_id,
                before=before,
                after=self._snapshot(item),
                reason=reason,
            )
        )
        await db.execute(
            delete(MemoryRecordEmbedding).where(MemoryRecordEmbedding.memory_id == item.id)
        )
        receipt = self._receipt(
            item.space_id,
            actor_user_id,
            "memory.retract",
            item.id,
            "已删除这条记忆",
        )
        db.add(receipt)
        await db.commit()
        await db.refresh(item)
        await db.refresh(receipt)
        return item, receipt

    async def restore(
        self,
        db: AsyncSession,
        actor_user_id: str,
        memory_id: str,
    ) -> tuple[MemoryRecord, ActionReceipt]:
        item = await self.get(db, actor_user_id, memory_id, allow_inactive=True)
        if item.status != "retracted":
            raise ValueError("只有已删除记忆可以恢复")
        evidence_count = (
            await db.scalar(
                select(func.count(MemoryEvidence.id)).where(MemoryEvidence.memory_id == item.id)
            )
        ) or 0
        if evidence_count == 0:
            raise ValueError("这条记忆的来源已被排除，不能恢复")
        before = self._snapshot(item)
        item.status = "active"
        item.valid_to = None
        db.add(
            self._revision(
                item.id,
                "restore",
                "user",
                actor_user_id,
                before=before,
                after=self._snapshot(item),
            )
        )
        receipt = self._receipt(
            item.space_id,
            actor_user_id,
            "memory.restore",
            item.id,
            "已恢复这条记忆",
        )
        db.add(receipt)
        await db.commit()
        await db.refresh(item)
        await db.refresh(receipt)
        return item, receipt

    async def approve(
        self,
        db: AsyncSession,
        actor_user_id: str,
        memory_id: str,
    ) -> tuple[MemoryRecord, ActionReceipt]:
        item = await self.get(db, actor_user_id, memory_id, allow_inactive=True)
        if item.status != "pending_review":
            raise ValueError("只有待确认记忆可以确认")
        before = self._snapshot(item)
        item.status = "active"
        item.confidence = 1.0
        item.last_confirmed_at = utcnow()
        db.add(
            self._revision(
                item.id,
                "approve",
                "user",
                actor_user_id,
                before=before,
                after=self._snapshot(item),
            )
        )
        receipt = self._receipt(
            item.space_id,
            actor_user_id,
            "memory.approve",
            item.id,
            "已确认这条记忆",
        )
        db.add(receipt)
        await db.commit()
        await db.refresh(item)
        await db.refresh(receipt)
        return item, receipt

    async def evidence(
        self,
        db: AsyncSession,
        user_id: str,
        memory_id: str,
    ) -> list[MemoryEvidence]:
        await self.get(db, user_id, memory_id, allow_inactive=True)
        return list(
            await db.scalars(
                select(MemoryEvidence)
                .where(MemoryEvidence.memory_id == memory_id)
                .order_by(MemoryEvidence.observed_at)
            )
        )

    async def history(
        self,
        db: AsyncSession,
        user_id: str,
        memory_id: str,
    ) -> list[MemoryRevision]:
        await self.get(db, user_id, memory_id, allow_inactive=True)
        return list(
            await db.scalars(
                select(MemoryRevision)
                .where(MemoryRevision.memory_id == memory_id)
                .order_by(MemoryRevision.created_at)
            )
        )

    async def exclude_evidence(
        self,
        db: AsyncSession,
        actor_user_id: str,
        memory_id: str,
        evidence_id: str,
    ) -> tuple[MemoryRecord, ActionReceipt]:
        item = await self.get(db, actor_user_id, memory_id, allow_inactive=True)
        evidence = await db.get(MemoryEvidence, evidence_id)
        if evidence is None or evidence.memory_id != item.id:
            raise LookupError("记忆来源不存在")
        existing = await db.scalar(
            select(MemoryExclusion).where(
                MemoryExclusion.source_type == evidence.source_type,
                MemoryExclusion.source_id == evidence.source_id,
            )
        )
        if existing is None:
            db.add(
                MemoryExclusion(
                    space_id=item.space_id,
                    actor_user_id=actor_user_id,
                    source_type=evidence.source_type,
                    source_id=evidence.source_id,
                    reason="user_excluded",
                )
            )
        if evidence.source_type == "chat_message":
            source = await db.get(ChatMessage, evidence.source_id)
            if source is not None:
                source.memory_excluded = True
        elif evidence.source_type == "direct_message":
            source = await db.get(DirectMessage, evidence.source_id)
            if source is not None and source.space_id == item.space_id:
                source.memory_excluded = True

        before = self._snapshot(item)
        await db.delete(evidence)
        await db.flush()
        remaining = (
            await db.scalar(
                select(func.count(MemoryEvidence.id)).where(MemoryEvidence.memory_id == item.id)
            )
        ) or 0
        if remaining == 0:
            item.status = "retracted"
            item.valid_to = utcnow()
            await db.execute(
                delete(MemoryRecordEmbedding).where(MemoryRecordEmbedding.memory_id == item.id)
            )
        db.add(
            self._revision(
                item.id,
                "exclude_evidence",
                "user",
                actor_user_id,
                before=before,
                after=self._snapshot(item),
                reason=f"excluded:{evidence.source_type}:{evidence.source_id}",
            )
        )
        receipt = self._receipt(
            item.space_id,
            actor_user_id,
            "memory.exclude_source",
            item.id,
            "已排除这条来源；不会再从它形成记忆",
        )
        db.add(receipt)
        await db.commit()
        await db.refresh(item)
        await db.refresh(receipt)
        return item, receipt

    @staticmethod
    async def preference(db: AsyncSession, user_id: str) -> MemoryPreference:
        item = await db.scalar(select(MemoryPreference).where(MemoryPreference.user_id == user_id))
        if item is None:
            item = MemoryPreference(user_id=user_id)
            db.add(item)
            await db.commit()
            await db.refresh(item)
        return item

    @staticmethod
    def _bigram_similarity(left: str, right: str) -> float:
        def bigrams(value: str) -> set[str]:
            normalized = value.lower().strip()
            if len(normalized) < 2:
                return {normalized} if normalized else set()
            return {normalized[index : index + 2] for index in range(len(normalized) - 1)}

        left_set = bigrams(left)
        right_set = bigrams(right)
        union = left_set | right_set
        return len(left_set & right_set) / len(union) if union else 0.0

    @staticmethod
    def _trigram_similarity(left: str, right: str) -> float:
        def trigrams(value: str) -> set[str]:
            normalized = f"  {value.lower().strip()} "
            return {normalized[index : index + 3] for index in range(max(0, len(normalized) - 2))}

        left_set = trigrams(left)
        right_set = trigrams(right)
        union = left_set | right_set
        return len(left_set & right_set) / len(union) if union else 0.0

    @staticmethod
    def _cosine(left: list[float], right: list[float]) -> float:
        numerator = sum(a * b for a, b in zip(left, right, strict=False))
        left_norm = math.sqrt(sum(value * value for value in left))
        right_norm = math.sqrt(sum(value * value for value in right))
        if left_norm == 0 or right_norm == 0:
            return 0.0
        return numerator / (left_norm * right_norm)
