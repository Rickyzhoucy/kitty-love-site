from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.ids import new_id

JsonType = JSON().with_variant(JSONB(), "postgresql")
VectorType = JSON().with_variant(Vector(1024), "postgresql")


def utcnow() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class StringIdMixin:
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)


class CreatedAtMixin:
    created_at: Mapped[datetime] = mapped_column(
        "createdAt", DateTime(timezone=True), default=utcnow
    )


class AttributionMixin:
    created_by: Mapped[str | None] = mapped_column(
        "createdBy", ForeignKey("User.id", ondelete="SET NULL"), nullable=True
    )
    created_by_companion: Mapped[str | None] = mapped_column(
        "createdByCompanion",
        ForeignKey("Companion.id", ondelete="SET NULL"),
        nullable=True,
    )


# Existing Prisma-owned shape. Table and column names intentionally preserve Prisma casing.
class Message(StringIdMixin, CreatedAtMixin, AttributionMixin, Base):
    __tablename__ = "Message"
    nickname: Mapped[str] = mapped_column(String)
    content: Mapped[str] = mapped_column(Text)


class Memo(StringIdMixin, CreatedAtMixin, AttributionMixin, Base):
    __tablename__ = "Memo"
    category: Mapped[str] = mapped_column(String)
    text: Mapped[str] = mapped_column(Text)
    completed: Mapped[bool] = mapped_column(Boolean, default=False)


class Photo(StringIdMixin, CreatedAtMixin, AttributionMixin, Base):
    __tablename__ = "Photo"
    # 仅用于读取旧数据；新 API 只保存 Attachment 外键，不保存临时签名 URL。
    legacy_url: Mapped[str | None] = mapped_column("url", Text, nullable=True)
    attachment_id: Mapped[str | None] = mapped_column(
        "attachmentId",
        ForeignKey("Attachment.id", ondelete="RESTRICT"),
        nullable=True,
        unique=True,
    )
    caption: Mapped[str] = mapped_column(Text)
    date: Mapped[str | None] = mapped_column(String, nullable=True)


class Milestone(StringIdMixin, CreatedAtMixin, AttributionMixin, Base):
    __tablename__ = "Milestone"
    date: Mapped[str] = mapped_column(String)
    title: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(Text)


class Admin(StringIdMixin, CreatedAtMixin, Base):
    __tablename__ = "Admin"
    username: Mapped[str] = mapped_column(String, unique=True)
    password: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="pending")


class SecurityQuestion(StringIdMixin, CreatedAtMixin, Base):
    __tablename__ = "SecurityQuestion"
    question: Mapped[str] = mapped_column(Text)
    answer: Mapped[str] = mapped_column(String)
    hint: Mapped[str | None] = mapped_column(Text, nullable=True)


class AuthAttempt(StringIdMixin, CreatedAtMixin, Base):
    __tablename__ = "AuthAttempt"
    ip: Mapped[str] = mapped_column(String)
    username: Mapped[str | None] = mapped_column(String(80), nullable=True)
    success: Mapped[bool] = mapped_column(Boolean)
    __table_args__ = (
        Index("AuthAttempt_ip_createdAt_idx", "ip", "createdAt"),
        Index("AuthAttempt_username_createdAt_idx", "username", "createdAt"),
    )


class SiteConfig(Base):
    __tablename__ = "SiteConfig"
    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(
        "updatedAt", DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class EventTimer(StringIdMixin, CreatedAtMixin, AttributionMixin, Base):
    __tablename__ = "EventTimer"
    title: Mapped[str] = mapped_column(String)
    date: Mapped[str] = mapped_column(String)
    type: Mapped[str] = mapped_column(String)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)


class SiteConfigHistory(StringIdMixin, CreatedAtMixin, Base):
    __tablename__ = "SiteConfigHistory"
    key: Mapped[str] = mapped_column(String)
    value: Mapped[str] = mapped_column(Text)


class Pet(StringIdMixin, CreatedAtMixin, Base):
    __tablename__ = "Pet"
    name: Mapped[str] = mapped_column(String, default="小猫咪")
    asset_id: Mapped[str | None] = mapped_column("assetId", String(120), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        "updatedAt", DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class Reminder(StringIdMixin, CreatedAtMixin, AttributionMixin, Base):
    __tablename__ = "Reminder"
    content: Mapped[str] = mapped_column(Text)
    due_date: Mapped[str] = mapped_column("dueDate", String)
    completed: Mapped[bool] = mapped_column(Boolean, default=False)


# Python companion service models.
class User(StringIdMixin, CreatedAtMixin, Base):
    __tablename__ = "User"
    username: Mapped[str] = mapped_column(String(80), unique=True)
    display_name: Mapped[str] = mapped_column("displayName", String(120))
    password_hash: Mapped[str] = mapped_column("passwordHash", String(255))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class UserSession(StringIdMixin, CreatedAtMixin, Base):
    __tablename__ = "UserSession"
    user_id: Mapped[str] = mapped_column("userId", ForeignKey("User.id", ondelete="CASCADE"))
    token_hash: Mapped[bytes] = mapped_column("tokenHash", LargeBinary(32), unique=True)
    expires_at: Mapped[datetime] = mapped_column("expiresAt", DateTime(timezone=True))
    last_seen_at: Mapped[datetime] = mapped_column("lastSeenAt", DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(
        "revokedAt", DateTime(timezone=True), nullable=True
    )
    device_name: Mapped[str | None] = mapped_column("deviceName", String(120), nullable=True)
    __table_args__ = (Index("UserSession_userId_expiresAt_idx", "userId", "expiresAt"),)


class Companion(StringIdMixin, CreatedAtMixin, Base):
    __tablename__ = "Companion"
    owner_id: Mapped[str] = mapped_column("ownerId", ForeignKey("User.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(120))
    active_persona_id: Mapped[str | None] = mapped_column(
        "activePersonaId", String(32), nullable=True
    )


class CompanionPersona(StringIdMixin, CreatedAtMixin, Base):
    __tablename__ = "CompanionPersona"
    companion_id: Mapped[str] = mapped_column(
        "companionId", ForeignKey("Companion.id", ondelete="CASCADE")
    )
    name: Mapped[str] = mapped_column(String(120))
    prompt: Mapped[str] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, default=1)


class UserProfile(StringIdMixin, CreatedAtMixin, Base):
    __tablename__ = "UserProfile"
    user_id: Mapped[str] = mapped_column(
        "userId", ForeignKey("User.id", ondelete="CASCADE"), unique=True
    )
    profile: Mapped[dict[str, Any]] = mapped_column(JsonType, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        "updatedAt", DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class Conversation(StringIdMixin, CreatedAtMixin, Base):
    __tablename__ = "Conversation"
    user_id: Mapped[str] = mapped_column("userId", ForeignKey("User.id", ondelete="CASCADE"))
    companion_id: Mapped[str] = mapped_column(
        "companionId", ForeignKey("Companion.id", ondelete="CASCADE")
    )
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        "updatedAt", DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class ChatMessage(StringIdMixin, CreatedAtMixin, Base):
    __tablename__ = "ChatMessage"
    conversation_id: Mapped[str] = mapped_column(
        "conversationId",
        ForeignKey("Conversation.id", ondelete="CASCADE"),
    )
    role: Mapped[str] = mapped_column(String(20))
    content: Mapped[str] = mapped_column(Text)
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JsonType, default=dict)


class ConversationSummary(StringIdMixin, CreatedAtMixin, Base):
    __tablename__ = "ConversationSummary"
    conversation_id: Mapped[str] = mapped_column(
        "conversationId",
        ForeignKey("Conversation.id", ondelete="CASCADE"),
    )
    summary: Mapped[str] = mapped_column(Text)
    through_message_id: Mapped[str | None] = mapped_column(
        "throughMessageId", String(32), nullable=True
    )
    __table_args__ = (
        UniqueConstraint(
            "conversationId",
            name="ConversationSummary_conversationId_key",
        ),
    )


class MemoryItem(StringIdMixin, CreatedAtMixin, Base):
    __tablename__ = "MemoryItem"
    owner_id: Mapped[str | None] = mapped_column(
        "ownerId", ForeignKey("User.id", ondelete="CASCADE"), nullable=True
    )
    companion_id: Mapped[str | None] = mapped_column(
        "companionId", ForeignKey("Companion.id", ondelete="CASCADE"), nullable=True
    )
    scope: Mapped[str] = mapped_column(String(20))
    kind: Mapped[str] = mapped_column(String(40))
    content: Mapped[str] = mapped_column(Text)
    importance: Mapped[int] = mapped_column(Integer, default=50)
    content_hash: Mapped[str] = mapped_column("contentHash", String(64))
    occurred_at: Mapped[datetime | None] = mapped_column(
        "occurredAt", DateTime(timezone=True), nullable=True
    )
    source_message_ids: Mapped[list[str]] = mapped_column(
        "sourceMessageIds", JsonType, default=list
    )
    __table_args__ = (
        Index(
            "MemoryItem_content_trgm_idx",
            "content",
            postgresql_using="gin",
            postgresql_ops={"content": "gin_trgm_ops"},
        ),
    )


class EmbeddingProfile(StringIdMixin, CreatedAtMixin, Base):
    __tablename__ = "EmbeddingProfile"
    provider: Mapped[str] = mapped_column(String(80))
    model: Mapped[str] = mapped_column(String(120))
    dimensions: Mapped[int] = mapped_column(Integer, default=1024)
    version: Mapped[int] = mapped_column(Integer)
    active: Mapped[bool] = mapped_column(Boolean, default=False)
    __table_args__ = (UniqueConstraint("provider", "model", "version"),)


class MemoryEmbedding(StringIdMixin, CreatedAtMixin, Base):
    __tablename__ = "MemoryEmbedding"
    memory_item_id: Mapped[str] = mapped_column(
        "memoryItemId", ForeignKey("MemoryItem.id", ondelete="CASCADE")
    )
    profile_id: Mapped[str] = mapped_column(
        "profileId", ForeignKey("EmbeddingProfile.id", ondelete="CASCADE")
    )
    embedding: Mapped[list[float]] = mapped_column(VectorType)
    __table_args__ = (
        UniqueConstraint("memoryItemId", "profileId"),
        Index(
            "MemoryEmbedding_embedding_hnsw_idx",
            "embedding",
            postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )


class Attachment(StringIdMixin, CreatedAtMixin, Base):
    __tablename__ = "Attachment"
    owner_id: Mapped[str] = mapped_column("ownerId", ForeignKey("User.id", ondelete="CASCADE"))
    bucket: Mapped[str] = mapped_column(String(80))
    object_key: Mapped[str] = mapped_column("objectKey", Text)
    version_id: Mapped[str | None] = mapped_column("versionId", String(255), nullable=True)
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column("contentType", String(200))
    size: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(20), default="ready")
    parse_status: Mapped[str] = mapped_column(
        "parseStatus", String(20), default="pending"
    )
    extracted_text: Mapped[str | None] = mapped_column(
        "extractedText", Text, nullable=True
    )
    parse_error: Mapped[str | None] = mapped_column(
        "parseError", Text, nullable=True
    )
    derived_bucket: Mapped[str | None] = mapped_column(
        "derivedBucket", String(80), nullable=True
    )
    thumbnail_key: Mapped[str | None] = mapped_column(
        "thumbnailKey", Text, nullable=True
    )
    __table_args__ = (UniqueConstraint("bucket", "objectKey"),)


class Skill(StringIdMixin, CreatedAtMixin, Base):
    __tablename__ = "Skill"
    name: Mapped[str] = mapped_column(String(120), unique=True)
    description: Mapped[str] = mapped_column(Text)
    active_version_id: Mapped[str | None] = mapped_column(
        "activeVersionId", String(32), nullable=True
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class SkillVersion(StringIdMixin, CreatedAtMixin, Base):
    __tablename__ = "SkillVersion"
    skill_id: Mapped[str] = mapped_column("skillId", ForeignKey("Skill.id", ondelete="CASCADE"))
    revision: Mapped[str] = mapped_column(String(80))
    bucket: Mapped[str] = mapped_column(String(80))
    object_key: Mapped[str] = mapped_column("objectKey", Text)
    sha256: Mapped[str] = mapped_column(String(64))
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JsonType, default=dict)
    __table_args__ = (UniqueConstraint("skillId", "revision"),)


class ToolRun(StringIdMixin, CreatedAtMixin, Base):
    __tablename__ = "ToolRun"
    user_id: Mapped[str] = mapped_column("userId", ForeignKey("User.id", ondelete="CASCADE"))
    conversation_id: Mapped[str | None] = mapped_column(
        "conversationId", ForeignKey("Conversation.id", ondelete="SET NULL"), nullable=True
    )
    tool_name: Mapped[str] = mapped_column("toolName", String(120))
    arguments: Mapped[dict[str, Any]] = mapped_column(JsonType, default=dict)
    result: Mapped[dict[str, Any] | None] = mapped_column(JsonType, nullable=True)
    status: Mapped[str] = mapped_column(String(20))
    completed_at: Mapped[datetime | None] = mapped_column(
        "completedAt", DateTime(timezone=True), nullable=True
    )


class OutboxEvent(StringIdMixin, CreatedAtMixin, Base):
    __tablename__ = "OutboxEvent"
    topic: Mapped[str] = mapped_column(String(100))
    aggregate_type: Mapped[str] = mapped_column("aggregateType", String(80))
    aggregate_id: Mapped[str] = mapped_column("aggregateId", String(32))
    payload: Mapped[dict[str, Any]] = mapped_column(JsonType)
    published_at: Mapped[datetime | None] = mapped_column(
        "publishedAt", DateTime(timezone=True), nullable=True
    )
    __table_args__ = (Index("OutboxEvent_createdAt_idx", "createdAt"),)
