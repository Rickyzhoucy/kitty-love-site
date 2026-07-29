"""Companion service core tables.

Revision ID: 20260728_0002
Revises: 20260728_0001
Create Date: 2026-07-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "20260728_0002"
down_revision: str | Sequence[str] | None = "20260728_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSON_TYPE = sa.JSON().with_variant(JSONB(), "postgresql")
VECTOR_TYPE = Vector(1024).with_variant(sa.JSON(), "sqlite")
TABLE_NAMES = (
    "User",
    "UserSession",
    "Companion",
    "CompanionPersona",
    "UserProfile",
    "Conversation",
    "ChatMessage",
    "ConversationSummary",
    "MemoryItem",
    "EmbeddingProfile",
    "MemoryEmbedding",
    "Attachment",
    "Skill",
    "SkillVersion",
    "ToolRun",
    "OutboxEvent",
)


def id_column() -> sa.Column:
    return sa.Column("id", sa.String(32), primary_key=True)


def created_at_column() -> sa.Column:
    return sa.Column(
        "createdAt",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    )


def foreign_key(
    name: str,
    target: str,
    *,
    nullable: bool = False,
    ondelete: str = "CASCADE",
) -> sa.Column:
    return sa.Column(
        name,
        sa.String(32),
        sa.ForeignKey(target, ondelete=ondelete),
        nullable=nullable,
    )


def entity_table(
    name: str,
    *columns: sa.Column | sa.Constraint,
) -> None:
    op.create_table(name, *columns, id_column(), created_at_column())


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("CREATE EXTENSION IF NOT EXISTS vector")
        op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    entity_table(
        "User",
        sa.Column("username", sa.String(80), nullable=False),
        sa.Column("displayName", sa.String(120), nullable=False),
        sa.Column("passwordHash", sa.String(255), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.UniqueConstraint("username"),
    )
    entity_table(
        "UserSession",
        foreign_key("userId", "User.id"),
        sa.Column("tokenHash", sa.LargeBinary(), nullable=False),
        sa.Column("expiresAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("lastSeenAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revokedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deviceName", sa.String(120), nullable=True),
        sa.UniqueConstraint("tokenHash"),
    )
    op.create_index(
        "UserSession_userId_expiresAt_idx",
        "UserSession",
        ["userId", "expiresAt"],
    )
    entity_table(
        "Companion",
        foreign_key("ownerId", "User.id"),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("activePersonaId", sa.String(32), nullable=True),
    )
    entity_table(
        "CompanionPersona",
        foreign_key("companionId", "Companion.id"),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
    )
    entity_table(
        "UserProfile",
        foreign_key("userId", "User.id"),
        sa.Column("profile", JSON_TYPE, nullable=False),
        sa.Column("updatedAt", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("userId"),
    )
    entity_table(
        "Conversation",
        foreign_key("userId", "User.id"),
        foreign_key("companionId", "Companion.id"),
        sa.Column("title", sa.String(200), nullable=True),
        sa.Column("updatedAt", sa.DateTime(timezone=True), nullable=False),
    )
    entity_table(
        "ChatMessage",
        foreign_key("conversationId", "Conversation.id"),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("metadata", JSON_TYPE, nullable=False),
    )
    entity_table(
        "ConversationSummary",
        foreign_key("conversationId", "Conversation.id"),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("throughMessageId", sa.String(32), nullable=True),
    )
    entity_table(
        "MemoryItem",
        foreign_key("ownerId", "User.id", nullable=True),
        foreign_key("companionId", "Companion.id", nullable=True),
        sa.Column("scope", sa.String(20), nullable=False),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("importance", sa.Integer(), nullable=False),
        sa.Column("contentHash", sa.String(64), nullable=False),
        sa.Column("occurredAt", sa.DateTime(timezone=True), nullable=True),
    )
    entity_table(
        "EmbeddingProfile",
        sa.Column("provider", sa.String(80), nullable=False),
        sa.Column("model", sa.String(120), nullable=False),
        sa.Column("dimensions", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.UniqueConstraint("provider", "model", "version"),
    )
    entity_table(
        "MemoryEmbedding",
        foreign_key("memoryItemId", "MemoryItem.id"),
        foreign_key("profileId", "EmbeddingProfile.id"),
        sa.Column("embedding", VECTOR_TYPE, nullable=False),
        sa.UniqueConstraint("memoryItemId", "profileId"),
    )
    entity_table(
        "Attachment",
        foreign_key("ownerId", "User.id"),
        sa.Column("bucket", sa.String(80), nullable=False),
        sa.Column("objectKey", sa.Text(), nullable=False),
        sa.Column("versionId", sa.String(255), nullable=True),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("contentType", sa.String(200), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.UniqueConstraint("bucket", "objectKey"),
    )
    entity_table(
        "Skill",
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("activeVersionId", sa.String(32), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.UniqueConstraint("name"),
    )
    entity_table(
        "SkillVersion",
        foreign_key("skillId", "Skill.id"),
        sa.Column("revision", sa.String(80), nullable=False),
        sa.Column("bucket", sa.String(80), nullable=False),
        sa.Column("objectKey", sa.Text(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("metadata", JSON_TYPE, nullable=False),
        sa.UniqueConstraint("skillId", "revision"),
    )
    entity_table(
        "ToolRun",
        foreign_key("userId", "User.id"),
        foreign_key(
            "conversationId",
            "Conversation.id",
            nullable=True,
            ondelete="SET NULL",
        ),
        sa.Column("toolName", sa.String(120), nullable=False),
        sa.Column("arguments", JSON_TYPE, nullable=False),
        sa.Column("result", JSON_TYPE, nullable=True),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("completedAt", sa.DateTime(timezone=True), nullable=True),
    )
    entity_table(
        "OutboxEvent",
        sa.Column("topic", sa.String(100), nullable=False),
        sa.Column("aggregateType", sa.String(80), nullable=False),
        sa.Column("aggregateId", sa.String(32), nullable=False),
        sa.Column("payload", JSON_TYPE, nullable=False),
        sa.Column("publishedAt", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "OutboxEvent_createdAt_idx",
        "OutboxEvent",
        ["createdAt"],
    )


def downgrade() -> None:
    for table in reversed(TABLE_NAMES):
        op.drop_table(table)
