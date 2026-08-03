"""Replace legacy memory with scoped, evidenced memory and perception foundations.

Revision ID: 20260803_0023
Revises: 20260803_0022
Create Date: 2026-08-03
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "20260803_0023"
down_revision: str | Sequence[str] | None = "20260803_0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSON_TYPE = sa.JSON().with_variant(JSONB(), "postgresql")

KIND_MAP = {
    "fact": "fact",
    "preference": "preference",
    "commitment": "commitment",
    "experience": "episode",
    "episode": "episode",
    "interaction_preference": "interaction_preference",
    "relationship": "relationship",
}
FORBIDDEN_KINDS = {
    "authorization",
    "file_location",
    "diary_content",
    "system_permission",
    "workspace",
    "tool_state",
    "command_output",
}
FORBIDDEN_TERMS = (
    "本机授权",
    "授权目录",
    "授权路径",
    "允许目录",
    "工作区路径",
    "工作目录",
    "workspace path",
    "allowedroots",
    "system permission",
    "目录权限",
    "文件全文",
    "命令输出",
)
PATH_PATTERNS = (
    re.compile(
        r"(?<!https:)(?<!http:)(?<![\w.])/(?:Users|home|var|tmp|private|Volumes|opt|etc)/[^\s，。；！？]+",
        re.I,
    ),
    re.compile(r"\b[A-Z]:\\(?:[^\\\s]+\\)*[^\s]*", re.I),
    re.compile(r"\bfile://[^\s]+", re.I),
)
SECRET_PATTERNS = (
    re.compile(r"\b(?:sk|pk)-[A-Za-z0-9_-]{16,}\b"),
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"\b(?:api[_ -]?key|token|password|passwd|cookie)\s*[:=]\s*\S+", re.I),
)


def _id(*parts: str) -> str:
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:32]


def _unsafe(kind: str, content: str) -> bool:
    lowered = content.lower()
    return (
        kind.lower() in FORBIDDEN_KINDS
        or any(term in lowered for term in FORBIDDEN_TERMS)
        or any(pattern.search(content) for pattern in PATH_PATTERNS)
        or any(pattern.search(content) for pattern in SECRET_PATTERNS)
    )


def _json(value):
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, list) else []
        except json.JSONDecodeError:
            return []
    return []


def _create_space_tables() -> None:
    op.create_table(
        "CoupleSpace",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
    )
    op.create_table(
        "CoupleSpaceMember",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "spaceId",
            sa.String(32),
            sa.ForeignKey("CoupleSpace.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "userId",
            sa.String(32),
            sa.ForeignKey("User.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("role", sa.String(20), nullable=False, server_default="member"),
        sa.UniqueConstraint("spaceId", "userId"),
    )
    op.create_index("CoupleSpaceMember_spaceId_idx", "CoupleSpaceMember", ["spaceId"])


def _seed_spaces(connection: sa.Connection) -> tuple[dict[str, str], str | None]:
    rows = connection.execute(
        sa.text('SELECT id, enabled FROM "User" ORDER BY "createdAt", id')
    ).all()
    enabled_users = [user_id for user_id, enabled in rows if enabled]
    disabled_users = [user_id for user_id, enabled in rows if not enabled]
    now = datetime.now(UTC)
    user_spaces: dict[str, str] = {}
    if not rows:
        return user_spaces, None

    enabled_groups = (
        [enabled_users]
        if enabled_users and len(enabled_users) <= 2
        else [[user_id] for user_id in enabled_users]
    )
    groups = [*enabled_groups, *[[user_id] for user_id in disabled_users]]
    for index, group in enumerate(groups):
        space_id = _id("couple-space-v2", *group)
        connection.execute(
            sa.text(
                'INSERT INTO "CoupleSpace" (id, "createdAt", name) VALUES (:id, :created_at, :name)'
            ),
            {
                "id": space_id,
                "created_at": now,
                "name": "我们的小世界" if index == 0 else f"情侣空间 {index + 1}",
            },
        )
        for user_id in group:
            user_spaces[user_id] = space_id
            connection.execute(
                sa.text(
                    'INSERT INTO "CoupleSpaceMember" '
                    '(id, "createdAt", "spaceId", "userId", role) '
                    "VALUES (:id, :created_at, :space_id, :user_id, :role)"
                ),
                {
                    "id": _id("couple-member-v2", space_id, user_id),
                    "created_at": now,
                    "space_id": space_id,
                    "user_id": user_id,
                    "role": "member",
                },
            )
    shared_space_id = (
        user_spaces.get(enabled_users[0]) if enabled_users and len(enabled_users) <= 2 else None
    )
    return user_spaces, shared_space_id


def _create_memory_tables() -> None:
    op.create_table(
        "MemoryRecord",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updatedAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "spaceId",
            sa.String(32),
            sa.ForeignKey("CoupleSpace.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("visibility", sa.String(32), nullable=False),
        sa.Column(
            "ownerId",
            sa.String(32),
            sa.ForeignKey("User.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "companionId",
            sa.String(32),
            sa.ForeignKey("Companion.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("memoryType", sa.String(40), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("subjectType", sa.String(32), nullable=False),
        sa.Column("subjectId", sa.String(32), nullable=True),
        sa.Column("predicate", sa.String(120), nullable=True),
        sa.Column("objectJson", JSON_TYPE, nullable=True),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("importance", sa.Integer(), nullable=False),
        sa.Column("sensitivity", sa.String(20), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("contentHash", sa.String(64), nullable=False),
        sa.Column("normalizedKey", sa.String(255), nullable=True),
        sa.Column("validFrom", sa.DateTime(timezone=True), nullable=True),
        sa.Column("validTo", sa.DateTime(timezone=True), nullable=True),
        sa.Column("occurredAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lastConfirmedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lastAccessedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("accessCount", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "supersedesId",
            sa.String(32),
            sa.ForeignKey("MemoryRecord.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("extractorVersion", sa.String(80), nullable=False),
        sa.Column("createdByKind", sa.String(20), nullable=False),
        sa.CheckConstraint(
            "visibility IN ('user_private', 'couple_shared', 'companion_relationship')",
            name="MemoryRecord_visibility_check",
        ),
        sa.CheckConstraint(
            "\"memoryType\" IN ('fact', 'preference', 'commitment', 'episode', "
            "'interaction_preference', 'relationship')",
            name="MemoryRecord_type_check",
        ),
        sa.CheckConstraint(
            "sensitivity IN ('normal', 'sensitive', 'restricted')",
            name="MemoryRecord_sensitivity_check",
        ),
        sa.CheckConstraint(
            "status IN ('active', 'superseded', 'retracted', 'contested', 'pending_review')",
            name="MemoryRecord_status_check",
        ),
        sa.CheckConstraint(
            "confidence >= 0 AND confidence <= 1",
            name="MemoryRecord_confidence_check",
        ),
        sa.CheckConstraint(
            "importance >= 0 AND importance <= 100",
            name="MemoryRecord_importance_check",
        ),
        sa.CheckConstraint(
            "(visibility != 'user_private') OR (\"ownerId\" IS NOT NULL)",
            name="MemoryRecord_private_owner_check",
        ),
        sa.CheckConstraint(
            "(visibility != 'couple_shared') OR (\"ownerId\" IS NULL)",
            name="MemoryRecord_shared_owner_check",
        ),
        sa.CheckConstraint(
            "(visibility != 'companion_relationship') OR "
            '("ownerId" IS NOT NULL AND "companionId" IS NOT NULL)',
            name="MemoryRecord_companion_owner_check",
        ),
    )
    op.create_index(
        "MemoryRecord_scope_status_idx",
        "MemoryRecord",
        ["spaceId", "visibility", "status"],
    )
    op.create_index(
        "MemoryRecord_subject_idx",
        "MemoryRecord",
        ["spaceId", "subjectType", "subjectId", "predicate"],
    )
    if op.get_bind().dialect.name == "postgresql":
        op.create_index(
            "MemoryRecord_content_trgm_idx",
            "MemoryRecord",
            ["content"],
            postgresql_using="gin",
            postgresql_ops={"content": "gin_trgm_ops"},
        )

    op.create_table(
        "MemoryEvidence",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "memoryId",
            sa.String(32),
            sa.ForeignKey("MemoryRecord.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("sourceType", sa.String(40), nullable=False),
        sa.Column("sourceId", sa.String(64), nullable=False),
        sa.Column(
            "actorUserId",
            sa.String(32),
            sa.ForeignKey("User.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("excerpt", sa.Text(), nullable=True),
        sa.Column("excerptHash", sa.String(64), nullable=False),
        sa.Column("observedAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("extractorVersion", sa.String(80), nullable=False),
        sa.UniqueConstraint("memoryId", "sourceType", "sourceId"),
    )
    op.create_index("MemoryEvidence_source_idx", "MemoryEvidence", ["sourceType", "sourceId"])
    op.create_table(
        "MemoryRevision",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "memoryId",
            sa.String(32),
            sa.ForeignKey("MemoryRecord.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("operation", sa.String(24), nullable=False),
        sa.Column("beforeJson", JSON_TYPE, nullable=True),
        sa.Column("afterJson", JSON_TYPE, nullable=True),
        sa.Column("actorType", sa.String(20), nullable=False),
        sa.Column("actorId", sa.String(32), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False, server_default=""),
    )
    op.create_table(
        "MemoryRecordEmbedding",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "memoryId",
            sa.String(32),
            sa.ForeignKey("MemoryRecord.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "profileId",
            sa.String(32),
            sa.ForeignKey("EmbeddingProfile.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("embedding", sa.JSON().with_variant(Vector(1024), "postgresql"), nullable=False),
        sa.UniqueConstraint("memoryId", "profileId"),
    )
    if op.get_bind().dialect.name == "postgresql":
        op.create_index(
            "MemoryRecordEmbedding_embedding_hnsw_idx",
            "MemoryRecordEmbedding",
            ["embedding"],
            postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
        )


def _create_foundation_tables() -> None:
    op.create_table(
        "ActionReceipt",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updatedAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "spaceId",
            sa.String(32),
            sa.ForeignKey("CoupleSpace.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "userId", sa.String(32), sa.ForeignKey("User.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "conversationId",
            sa.String(32),
            sa.ForeignKey("Conversation.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("sourceMessageId", sa.String(32), nullable=True),
        sa.Column("actionType", sa.String(80), nullable=False),
        sa.Column("resourceType", sa.String(80), nullable=False),
        sa.Column("resourceId", sa.String(32), nullable=True),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("safeSummary", sa.Text(), nullable=False),
        sa.Column("errorCode", sa.String(80), nullable=True),
        sa.Column(
            "toolRunId",
            sa.String(32),
            sa.ForeignKey("ToolRun.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("committedAt", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('proposed', 'confirmation_required', 'committed', 'failed', 'cancelled')",
            name="ActionReceipt_status_check",
        ),
    )
    op.create_index("ActionReceipt_user_createdAt_idx", "ActionReceipt", ["userId", "createdAt"])

    op.create_table(
        "PerceptionSession",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "spaceId",
            sa.String(32),
            sa.ForeignKey("CoupleSpace.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "userId", sa.String(32), sa.ForeignKey("User.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("surface", sa.String(24), nullable=False),
        sa.Column("deviceSessionId", sa.String(120), nullable=False),
        sa.Column(
            "activeConversationId",
            sa.String(32),
            sa.ForeignKey("Conversation.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("route", sa.String(255), nullable=False),
        sa.Column("pageKind", sa.String(40), nullable=False),
        sa.Column("pageContext", JSON_TYPE, nullable=False),
        sa.Column("foreground", sa.Boolean(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("lastSeenAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expiresAt", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("userId", "deviceSessionId", "surface"),
        sa.CheckConstraint(
            "surface IN ('web', 'tauri_main', 'tauri_pet')", name="PerceptionSession_surface_check"
        ),
    )
    op.create_index(
        "PerceptionSession_user_foreground_idx",
        "PerceptionSession",
        ["userId", "foreground", "lastSeenAt"],
    )

    op.create_table(
        "PerceptionEvent",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("specVersion", sa.String(10), nullable=False),
        sa.Column("schemaVersion", sa.Integer(), nullable=False),
        sa.Column(
            "spaceId",
            sa.String(32),
            sa.ForeignKey("CoupleSpace.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "actorUserId",
            sa.String(32),
            sa.ForeignKey("User.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "companionId",
            sa.String(32),
            sa.ForeignKey("Companion.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("source", sa.String(120), nullable=False),
        sa.Column("type", sa.String(120), nullable=False),
        sa.Column("subjectType", sa.String(80), nullable=True),
        sa.Column("subjectId", sa.String(64), nullable=True),
        sa.Column("occurredAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("observedAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("data", JSON_TYPE, nullable=False),
        sa.Column("sensitivity", sa.String(20), nullable=False),
        sa.Column("retention", sa.String(20), nullable=False),
        sa.Column("correlationId", sa.String(64), nullable=True),
        sa.Column("causationId", sa.String(64), nullable=True),
        sa.Column("dedupeKey", sa.String(255), nullable=False, unique=True),
        sa.Column("processedAt", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "sensitivity IN ('normal', 'sensitive', 'restricted')",
            name="PerceptionEvent_sensitivity_check",
        ),
        sa.CheckConstraint(
            "retention IN ('ephemeral', 'working', 'episodic', 'audit')",
            name="PerceptionEvent_retention_check",
        ),
    )
    op.create_index(
        "PerceptionEvent_space_occurredAt_idx", "PerceptionEvent", ["spaceId", "occurredAt"]
    )
    op.create_index(
        "PerceptionEvent_type_processedAt_idx", "PerceptionEvent", ["type", "processedAt"]
    )

    op.create_table(
        "MemoryIngestionCursor",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "spaceId",
            sa.String(32),
            sa.ForeignKey("CoupleSpace.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("sourceType", sa.String(32), nullable=False),
        sa.Column("sourceId", sa.String(64), nullable=False),
        sa.Column("lastMessageId", sa.String(32), nullable=True),
        sa.Column("lastProcessedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("extractorVersion", sa.String(80), nullable=False),
        sa.UniqueConstraint("sourceType", "sourceId"),
    )
    op.create_table(
        "MemoryExclusion",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "spaceId",
            sa.String(32),
            sa.ForeignKey("CoupleSpace.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "actorUserId",
            sa.String(32),
            sa.ForeignKey("User.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("sourceType", sa.String(32), nullable=False),
        sa.Column("sourceId", sa.String(64), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.UniqueConstraint("sourceType", "sourceId"),
    )
    op.create_table(
        "MemoryPreference",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updatedAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "userId",
            sa.String(32),
            sa.ForeignKey("User.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("paused", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "conversationEnabled", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
        sa.Column(
            "directMessageEnabled", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
        sa.Column("moodEnabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "dailyQuestionEnabled", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
        sa.Column(
            "futureLetterEnabled", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
    )


def _migrate_clean_memories(
    connection: sa.Connection,
    user_spaces: dict[str, str],
    shared_space_id: str | None,
) -> None:
    companions = dict(connection.execute(sa.text('SELECT id, "ownerId" FROM "Companion"')).all())
    chat_message_ids = set(
        connection.execute(sa.text('SELECT id FROM "ChatMessage"')).scalars().all()
    )
    rows = (
        connection.execute(
            sa.text(
                'SELECT id, "createdAt", "ownerId", "companionId", scope, kind, content, '
                'importance, "contentHash", "occurredAt", "sourceMessageIds" '
                'FROM "MemoryItem" ORDER BY "createdAt", id'
            )
        )
        .mappings()
        .all()
    )
    now = datetime.now(UTC)
    for row in rows:
        kind = str(row["kind"] or "").lower()
        content = str(row["content"] or "").strip()
        memory_type = KIND_MAP.get(kind)
        if not memory_type or not content or _unsafe(kind, content):
            continue

        scope = row["scope"]
        owner_id = row["ownerId"]
        companion_id = row["companionId"]
        if scope == "owner":
            visibility = "user_private"
            space_id = user_spaces.get(owner_id)
            companion_id = None
        elif scope == "companion":
            visibility = "companion_relationship"
            owner_id = owner_id or companions.get(companion_id)
            space_id = user_spaces.get(owner_id)
        elif scope == "shared" and shared_space_id:
            visibility = "couple_shared"
            owner_id = None
            companion_id = None
            space_id = shared_space_id
        else:
            continue
        if not space_id:
            continue

        subject_type = (
            "couple"
            if visibility == "couple_shared"
            else "companion"
            if visibility == "companion_relationship"
            else "user"
        )
        subject_id = companion_id if subject_type == "companion" else owner_id
        created_at = row["createdAt"] or now
        payload = {
            "id": row["id"],
            "created_at": created_at,
            "updated_at": created_at,
            "space_id": space_id,
            "visibility": visibility,
            "owner_id": owner_id,
            "companion_id": companion_id,
            "memory_type": memory_type,
            "content": content,
            "subject_type": subject_type,
            "subject_id": subject_id,
            "confidence": 0.8,
            "importance": max(0, min(100, int(row["importance"] or 50))),
            "content_hash": hashlib.sha256(content.encode()).hexdigest(),
            "normalized_key": hashlib.sha256(
                f"{memory_type}|{' '.join(content.lower().split())}".encode()
            ).hexdigest(),
            "occurred_at": row["occurredAt"],
        }
        connection.execute(
            sa.text(
                'INSERT INTO "MemoryRecord" '
                '(id, "createdAt", "updatedAt", "spaceId", visibility, "ownerId", '
                '"companionId", "memoryType", content, "subjectType", "subjectId", '
                'predicate, "objectJson", confidence, importance, sensitivity, status, '
                '"contentHash", "normalizedKey", "validFrom", "validTo", "occurredAt", '
                '"lastConfirmedAt", "lastAccessedAt", "accessCount", "supersedesId", '
                '"extractorVersion", "createdByKind") '
                "VALUES (:id, :created_at, :updated_at, :space_id, :visibility, :owner_id, "
                ":companion_id, :memory_type, :content, :subject_type, :subject_id, NULL, NULL, "
                ":confidence, :importance, 'normal', 'active', :content_hash, "
                ":normalized_key, NULL, NULL, :occurred_at, :created_at, NULL, 0, NULL, "
                "'legacy-migration-v1', 'system')"
            ),
            payload,
        )
        after_json = {
            "visibility": visibility,
            "memoryType": memory_type,
            "content": content,
            "status": "active",
        }
        connection.execute(
            sa.text(
                'INSERT INTO "MemoryRevision" '
                '(id, "createdAt", "memoryId", operation, "beforeJson", "afterJson", '
                '"actorType", "actorId", reason) '
                "VALUES (:id, :created_at, :memory_id, 'create', NULL, :after_json, "
                "'system', NULL, 'legacy_clean_migration')"
            ),
            {
                "id": _id("legacy-revision", row["id"]),
                "created_at": created_at,
                "memory_id": row["id"],
                "after_json": json.dumps(after_json, ensure_ascii=False),
            },
        )
        source_ids = [
            str(source_id)
            for source_id in _json(row["sourceMessageIds"])
            if str(source_id) in chat_message_ids
        ] or [row["id"]]
        for source_id in source_ids:
            source_type = "chat_message" if source_id in chat_message_ids else "migration"
            connection.execute(
                sa.text(
                    'INSERT INTO "MemoryEvidence" '
                    '(id, "createdAt", "memoryId", "sourceType", "sourceId", '
                    '"actorUserId", excerpt, "excerptHash", "observedAt", "extractorVersion") '
                    "VALUES (:id, :created_at, :memory_id, :source_type, :source_id, "
                    ":actor_user_id, NULL, :excerpt_hash, :observed_at, 'legacy-migration-v1')"
                ),
                {
                    "id": _id("legacy-evidence", row["id"], source_type, source_id),
                    "created_at": created_at,
                    "memory_id": row["id"],
                    "source_type": source_type,
                    "source_id": source_id,
                    "actor_user_id": owner_id,
                    "excerpt_hash": hashlib.sha256(content.encode()).hexdigest(),
                    "observed_at": row["occurredAt"] or created_at,
                },
            )


def upgrade() -> None:
    connection = op.get_bind()
    _create_space_tables()
    user_spaces, shared_space_id = _seed_spaces(connection)

    op.add_column("Conversation", sa.Column("spaceId", sa.String(32), nullable=True))
    op.create_foreign_key(
        "Conversation_spaceId_fkey",
        "Conversation",
        "CoupleSpace",
        ["spaceId"],
        ["id"],
        ondelete="CASCADE",
    )
    op.add_column(
        "ChatMessage",
        sa.Column("memoryExcluded", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column("DirectMessage", sa.Column("spaceId", sa.String(32), nullable=True))
    op.create_foreign_key(
        "DirectMessage_spaceId_fkey",
        "DirectMessage",
        "CoupleSpace",
        ["spaceId"],
        ["id"],
        ondelete="CASCADE",
    )
    op.add_column(
        "DirectMessage",
        sa.Column("memoryExcluded", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    for user_id, space_id in user_spaces.items():
        connection.execute(
            sa.text('UPDATE "Conversation" SET "spaceId"=:space_id WHERE "userId"=:user_id'),
            {"space_id": space_id, "user_id": user_id},
        )
        connection.execute(
            sa.text('UPDATE "DirectMessage" SET "spaceId"=:space_id WHERE "senderId"=:user_id'),
            {"space_id": space_id, "user_id": user_id},
        )
    op.alter_column("Conversation", "spaceId", nullable=False)
    op.alter_column("DirectMessage", "spaceId", nullable=False)

    _create_memory_tables()
    _create_foundation_tables()
    _migrate_clean_memories(connection, user_spaces, shared_space_id)

    # 旧向量与旧扁平记忆不保留：安全内容已迁入新表，污染内容刻意被丢弃。
    op.drop_table("MemoryEmbedding")
    op.drop_table("MemoryItem")


def downgrade() -> None:
    op.create_table(
        "MemoryItem",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "ownerId", sa.String(32), sa.ForeignKey("User.id", ondelete="CASCADE"), nullable=True
        ),
        sa.Column(
            "companionId",
            sa.String(32),
            sa.ForeignKey("Companion.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("scope", sa.String(20), nullable=False),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("importance", sa.Integer(), nullable=False),
        sa.Column("contentHash", sa.String(64), nullable=False),
        sa.Column("occurredAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sourceMessageIds", JSON_TYPE, nullable=False),
    )
    op.create_table(
        "MemoryEmbedding",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "memoryItemId",
            sa.String(32),
            sa.ForeignKey("MemoryItem.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "profileId",
            sa.String(32),
            sa.ForeignKey("EmbeddingProfile.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("embedding", sa.JSON().with_variant(Vector(1024), "postgresql"), nullable=False),
        sa.UniqueConstraint("memoryItemId", "profileId"),
    )

    for table in (
        "MemoryPreference",
        "MemoryExclusion",
        "MemoryIngestionCursor",
        "PerceptionEvent",
        "PerceptionSession",
        "ActionReceipt",
        "MemoryRecordEmbedding",
        "MemoryRevision",
        "MemoryEvidence",
        "MemoryRecord",
    ):
        op.drop_table(table)
    op.drop_column("DirectMessage", "memoryExcluded")
    op.drop_constraint("DirectMessage_spaceId_fkey", "DirectMessage", type_="foreignkey")
    op.drop_column("DirectMessage", "spaceId")
    op.drop_column("ChatMessage", "memoryExcluded")
    op.drop_constraint("Conversation_spaceId_fkey", "Conversation", type_="foreignkey")
    op.drop_column("Conversation", "spaceId")
    op.drop_index("CoupleSpaceMember_spaceId_idx", table_name="CoupleSpaceMember")
    op.drop_table("CoupleSpaceMember")
    op.drop_table("CoupleSpace")
