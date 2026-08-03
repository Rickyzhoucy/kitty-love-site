from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
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
    """故事线上的一件事。**地点是可选的**。

    原本「故事」和「地图」是两张表两个页面，但它们本来就是同一件事的两种看法
    ——发生过的事，有时间，有时候还有地点。分成两处的代价是：同一次旅行要记
    两遍，而且两边都不完整。合并之后，有坐标的条目在地图视图里出现，没有的
    只在时间轴上，两个视图看的是同一批数据。
    """

    __tablename__ = "Milestone"
    date: Mapped[str] = mapped_column(String)
    title: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(Text)
    #: GCJ-02（高德原生）。两个都为空表示这件事没有地点。
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    #: 与相册复用同一批 Attachment
    photo_ids: Mapped[list[str]] = mapped_column("photoIds", JsonType, default=list)


class Admin(StringIdMixin, CreatedAtMixin, Base):
    """后台管理员。**与主站的 `User` 是两套账号。**

    这张表是 Prisma 时代留下的，一直空着、也没有任何代码引用。现在把它启用为
    后台的独立账号——形状正合适，而且新建一张只会让「有两张都像管理员的表」
    这件事更糊涂。`password` 列里存的是 argon2 摘要，与主站同一套原语。

    隔离的理由和做法见 `app/admin_auth.py` 的模块文档。
    """

    __tablename__ = "Admin"
    username: Mapped[str] = mapped_column(String, unique=True)
    password: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="pending")


class AdminSession(StringIdMixin, CreatedAtMixin, Base):
    """后台会话。结构与 `UserSession` 一致，但**刻意是另一张表**。

    共用一张表就得靠一个 `kind` 字段区分，而那种设计里一次写错的查询就能让
    主站会话被当成后台会话使用。分开之后，「后台权限」在类型层面就拿不到。
    """

    __tablename__ = "AdminSession"
    admin_id: Mapped[str] = mapped_column("adminId", ForeignKey("Admin.id", ondelete="CASCADE"))
    token_hash: Mapped[bytes] = mapped_column("tokenHash", LargeBinary(32), unique=True)
    expires_at: Mapped[datetime] = mapped_column("expiresAt", DateTime(timezone=True))
    last_seen_at: Mapped[datetime] = mapped_column("lastSeenAt", DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(
        "revokedAt", DateTime(timezone=True), nullable=True
    )
    device_name: Mapped[str | None] = mapped_column("deviceName", String(120), nullable=True)
    __table_args__ = (Index("AdminSession_adminId_expiresAt_idx", "adminId", "expiresAt"),)


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
    #: none / yearly / monthly。没有它的话，加了提醒也只灵一次——
    #: 生日和在一起纪念日过完当年就永远「已过期」了。
    recurrence: Mapped[str] = mapped_column(String(16), default="none")
    #: 提前几天提醒，例如 [7, 1, 0]。空数组表示不提醒。
    remind_days_before: Mapped[list[int]] = mapped_column(
        "remindDaysBefore", JsonType, default=list
    )


class SiteConfigHistory(StringIdMixin, CreatedAtMixin, Base):
    __tablename__ = "SiteConfigHistory"
    key: Mapped[str] = mapped_column(String)
    value: Mapped[str] = mapped_column(Text)


# 旧的全站单例 `Pet` 表已在迁移 20260729_0013 中并入
# Companion + CompanionPetProfile（见本文件末尾）。宠物的身份、名字与外观
# 现在只有一份真相。


# 旧的 `Memo` 与 `Reminder` 已在迁移 20260730_0014 中拆成 Plan / Wish。
#
# 那两张表的差别只有一个 dueDate——不是两类东西，是同一类东西的有无期限两种
# 状态。而 Memo 的另外三个分类（想去吃 / 想去玩 / 想买的）全是「想一起做但
# 没期限」的事，本来就是心愿清单。详见
# docs/couple-site-feature-plan.md §0.1。


class Plan(StringIdMixin, CreatedAtMixin, AttributionMixin, Base):
    """要做的事。期限可选——有期限的会出现在首页，没期限的只在计划页。"""

    __tablename__ = "Plan"
    title: Mapped[str] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    due_at: Mapped[datetime | None] = mapped_column("dueAt", DateTime(timezone=True), nullable=True)
    # 用时间而不是布尔：心愿页要显示「我们在去年 3 月做到了这件事」，
    # 布尔值给不出这个信息。Plan 保持同一形状，两者才好统一处理。
    completed_at: Mapped[datetime | None] = mapped_column(
        "completedAt", DateTime(timezone=True), nullable=True
    )
    __table_args__ = (Index("Plan_dueAt_idx", "dueAt"),)


class Wish(StringIdMixin, CreatedAtMixin, AttributionMixin, Base):
    """想一起做的事。没有期限，重点在「谁提的」和「什么时候做到的」。"""

    __tablename__ = "Wish"
    title: Mapped[str] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: to-eat / to-go / to-buy，沿用旧 Memo 的分类，前端文案不变
    category: Mapped[str] = mapped_column(String(40))
    completed_at: Mapped[datetime | None] = mapped_column(
        "completedAt", DateTime(timezone=True), nullable=True
    )
    #: 完成时可以挂一张照片。回头看「这是那天拍的」本身就是内容。
    completion_photo_id: Mapped[str | None] = mapped_column(
        "completionPhotoId",
        ForeignKey("Attachment.id", ondelete="SET NULL"),
        nullable=True,
    )


# Python companion service models.
class User(StringIdMixin, CreatedAtMixin, Base):
    __tablename__ = "User"
    username: Mapped[str] = mapped_column(String(80), unique=True)
    display_name: Mapped[str] = mapped_column("displayName", String(120))
    password_hash: Mapped[str] = mapped_column("passwordHash", String(255))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class CoupleSpace(StringIdMixin, CreatedAtMixin, Base):
    """两个人与双方宠物共享内容的唯一租户边界。"""

    __tablename__ = "CoupleSpace"
    name: Mapped[str] = mapped_column(String(120), default="我们的小世界")


class CoupleSpaceMember(StringIdMixin, CreatedAtMixin, Base):
    __tablename__ = "CoupleSpaceMember"
    space_id: Mapped[str] = mapped_column(
        "spaceId", ForeignKey("CoupleSpace.id", ondelete="CASCADE")
    )
    user_id: Mapped[str] = mapped_column(
        "userId", ForeignKey("User.id", ondelete="CASCADE"), unique=True
    )
    role: Mapped[str] = mapped_column(String(20), default="member")
    __table_args__ = (
        UniqueConstraint("spaceId", "userId"),
        Index("CoupleSpaceMember_spaceId_idx", "spaceId"),
    )


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


class WebAuthnCredential(StringIdMixin, CreatedAtMixin, Base):
    """一把 passkey。**同一张表同时服务主站用户和后台管理员。**

    两个可空外键 + 一条「恰好有一个非空」的约束，而不是一个 `subjectType` 字段：
    这样外键完整性还在（删账号会连带删掉它的 passkey），而且「把主站的凭据当成
    后台凭据用」这种错在数据库层面就写不进去。

    `signCount` 是防克隆用的——同步型 passkey（iCloud 钥匙串那种）多数恒为 0，
    所以**不能因为它没增长就拒绝登录**，只在它倒退时告警。
    """

    __tablename__ = "WebAuthnCredential"
    user_id: Mapped[str | None] = mapped_column(
        "userId", ForeignKey("User.id", ondelete="CASCADE"), nullable=True
    )
    admin_id: Mapped[str | None] = mapped_column(
        "adminId", ForeignKey("Admin.id", ondelete="CASCADE"), nullable=True
    )
    credential_id: Mapped[bytes] = mapped_column("credentialId", LargeBinary(256), unique=True)
    public_key: Mapped[bytes] = mapped_column("publicKey", LargeBinary(512))
    sign_count: Mapped[int] = mapped_column("signCount", Integer, default=0)
    transports: Mapped[list[str]] = mapped_column(JsonType, default=list)
    #: 给人看的名字，比如「Ricky 的 iPhone」。设备本身不告诉我们它叫什么，
    #: 所以这是注册时由前端根据 UA 猜一个、用户可改。
    label: Mapped[str] = mapped_column(String(80), default="")
    last_used_at: Mapped[datetime | None] = mapped_column(
        "lastUsedAt", DateTime(timezone=True), nullable=True
    )
    __table_args__ = (
        CheckConstraint(
            '("userId" IS NULL) <> ("adminId" IS NULL)',
            name="WebAuthnCredential_exactly_one_owner",
        ),
        Index("WebAuthnCredential_userId_idx", "userId"),
        Index("WebAuthnCredential_adminId_idx", "adminId"),
    )


class WebAuthnChallenge(StringIdMixin, CreatedAtMixin, Base):
    """一次性的挑战值。

    **必须服务端保存。** challenge 的作用是防重放，如果让客户端自己回传一个它
    自己生成的值，那就等于没有。存表而不是存 Cookie：登录时用户还没有会话，
    而且 Cookie 在跨站场景下的行为比一张表复杂得多。

    用完即删，另有过期时间兜住「开了对话框又不做」的情况。
    """

    __tablename__ = "WebAuthnChallenge"
    challenge: Mapped[bytes] = mapped_column(LargeBinary(64))
    #: "register" 或 "login"——注册用的挑战不能拿去登录，反之亦然。
    purpose: Mapped[str] = mapped_column(String(20))
    #: "user" 或 "admin"。**两套账号体系的挑战不能混用。**
    audience: Mapped[str] = mapped_column(String(20))
    #: 注册时是「给谁注册」，登录时为空（用可发现凭据，登录前不知道是谁）。
    subject_id: Mapped[str | None] = mapped_column("subjectId", String(32), nullable=True)
    expires_at: Mapped[datetime] = mapped_column("expiresAt", DateTime(timezone=True))


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
    space_id: Mapped[str] = mapped_column(
        "spaceId", ForeignKey("CoupleSpace.id", ondelete="CASCADE")
    )
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
    memory_excluded: Mapped[bool] = mapped_column("memoryExcluded", Boolean, default=False)


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


class MemoryRecord(StringIdMixin, CreatedAtMixin, Base):
    """有来源、时间、权限和修订状态的长期记忆。"""

    __tablename__ = "MemoryRecord"
    space_id: Mapped[str] = mapped_column(
        "spaceId", ForeignKey("CoupleSpace.id", ondelete="CASCADE")
    )
    visibility: Mapped[str] = mapped_column(String(32))
    owner_id: Mapped[str | None] = mapped_column(
        "ownerId", ForeignKey("User.id", ondelete="CASCADE"), nullable=True
    )
    companion_id: Mapped[str | None] = mapped_column(
        "companionId", ForeignKey("Companion.id", ondelete="CASCADE"), nullable=True
    )
    memory_type: Mapped[str] = mapped_column("memoryType", String(40))
    content: Mapped[str] = mapped_column(Text)
    subject_type: Mapped[str] = mapped_column("subjectType", String(32), default="other")
    subject_id: Mapped[str | None] = mapped_column("subjectId", String(32), nullable=True)
    predicate: Mapped[str | None] = mapped_column(String(120), nullable=True)
    object_json: Mapped[dict[str, Any] | None] = mapped_column(
        "objectJson", JsonType, nullable=True
    )
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    importance: Mapped[int] = mapped_column(Integer, default=50)
    sensitivity: Mapped[str] = mapped_column(String(20), default="normal")
    status: Mapped[str] = mapped_column(String(24), default="active")
    content_hash: Mapped[str] = mapped_column("contentHash", String(64))
    normalized_key: Mapped[str | None] = mapped_column("normalizedKey", String(255), nullable=True)
    valid_from: Mapped[datetime | None] = mapped_column(
        "validFrom", DateTime(timezone=True), nullable=True
    )
    valid_to: Mapped[datetime | None] = mapped_column(
        "validTo", DateTime(timezone=True), nullable=True
    )
    occurred_at: Mapped[datetime | None] = mapped_column(
        "occurredAt", DateTime(timezone=True), nullable=True
    )
    last_confirmed_at: Mapped[datetime | None] = mapped_column(
        "lastConfirmedAt", DateTime(timezone=True), nullable=True
    )
    last_accessed_at: Mapped[datetime | None] = mapped_column(
        "lastAccessedAt", DateTime(timezone=True), nullable=True
    )
    access_count: Mapped[int] = mapped_column("accessCount", Integer, default=0)
    supersedes_id: Mapped[str | None] = mapped_column(
        "supersedesId",
        ForeignKey("MemoryRecord.id", ondelete="SET NULL"),
        nullable=True,
    )
    extractor_version: Mapped[str] = mapped_column(
        "extractorVersion", String(80), default="explicit-v1"
    )
    created_by_kind: Mapped[str] = mapped_column("createdByKind", String(20), default="user")
    updated_at: Mapped[datetime] = mapped_column(
        "updatedAt", DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
    __table_args__ = (
        CheckConstraint(
            "visibility IN ('user_private', 'couple_shared', 'companion_relationship')",
            name="MemoryRecord_visibility_check",
        ),
        CheckConstraint(
            "\"memoryType\" IN ('fact', 'preference', 'commitment', 'episode', "
            "'interaction_preference', 'relationship')",
            name="MemoryRecord_type_check",
        ),
        CheckConstraint(
            "sensitivity IN ('normal', 'sensitive', 'restricted')",
            name="MemoryRecord_sensitivity_check",
        ),
        CheckConstraint(
            "status IN ('active', 'superseded', 'retracted', 'contested', 'pending_review')",
            name="MemoryRecord_status_check",
        ),
        CheckConstraint(
            "confidence >= 0 AND confidence <= 1",
            name="MemoryRecord_confidence_check",
        ),
        CheckConstraint(
            "importance >= 0 AND importance <= 100",
            name="MemoryRecord_importance_check",
        ),
        CheckConstraint(
            "(visibility != 'user_private') OR (\"ownerId\" IS NOT NULL)",
            name="MemoryRecord_private_owner_check",
        ),
        CheckConstraint(
            "(visibility != 'couple_shared') OR (\"ownerId\" IS NULL)",
            name="MemoryRecord_shared_owner_check",
        ),
        CheckConstraint(
            "(visibility != 'companion_relationship') OR "
            '("ownerId" IS NOT NULL AND "companionId" IS NOT NULL)',
            name="MemoryRecord_companion_owner_check",
        ),
        Index(
            "MemoryRecord_content_trgm_idx",
            "content",
            postgresql_using="gin",
            postgresql_ops={"content": "gin_trgm_ops"},
        ),
        Index(
            "MemoryRecord_scope_status_idx",
            "spaceId",
            "visibility",
            "status",
        ),
        Index(
            "MemoryRecord_subject_idx",
            "spaceId",
            "subjectType",
            "subjectId",
            "predicate",
        ),
    )


class MemoryEvidence(StringIdMixin, CreatedAtMixin, Base):
    __tablename__ = "MemoryEvidence"
    memory_id: Mapped[str] = mapped_column(
        "memoryId", ForeignKey("MemoryRecord.id", ondelete="CASCADE")
    )
    source_type: Mapped[str] = mapped_column("sourceType", String(40))
    source_id: Mapped[str] = mapped_column("sourceId", String(64))
    actor_user_id: Mapped[str | None] = mapped_column(
        "actorUserId", ForeignKey("User.id", ondelete="SET NULL"), nullable=True
    )
    excerpt: Mapped[str | None] = mapped_column(Text, nullable=True)
    excerpt_hash: Mapped[str] = mapped_column("excerptHash", String(64))
    observed_at: Mapped[datetime] = mapped_column(
        "observedAt", DateTime(timezone=True), default=utcnow
    )
    extractor_version: Mapped[str] = mapped_column(
        "extractorVersion", String(80), default="explicit-v1"
    )
    __table_args__ = (
        UniqueConstraint("memoryId", "sourceType", "sourceId"),
        Index("MemoryEvidence_source_idx", "sourceType", "sourceId"),
    )


class MemoryRevision(StringIdMixin, CreatedAtMixin, Base):
    __tablename__ = "MemoryRevision"
    memory_id: Mapped[str] = mapped_column(
        "memoryId", ForeignKey("MemoryRecord.id", ondelete="CASCADE")
    )
    operation: Mapped[str] = mapped_column(String(24))
    before_json: Mapped[dict[str, Any] | None] = mapped_column(
        "beforeJson", JsonType, nullable=True
    )
    after_json: Mapped[dict[str, Any] | None] = mapped_column("afterJson", JsonType, nullable=True)
    actor_type: Mapped[str] = mapped_column("actorType", String(20))
    actor_id: Mapped[str | None] = mapped_column("actorId", String(32), nullable=True)
    reason: Mapped[str] = mapped_column(Text, default="")


class EmbeddingProfile(StringIdMixin, CreatedAtMixin, Base):
    __tablename__ = "EmbeddingProfile"
    provider: Mapped[str] = mapped_column(String(80))
    model: Mapped[str] = mapped_column(String(120))
    dimensions: Mapped[int] = mapped_column(Integer, default=1024)
    version: Mapped[int] = mapped_column(Integer)
    active: Mapped[bool] = mapped_column(Boolean, default=False)
    __table_args__ = (UniqueConstraint("provider", "model", "version"),)


class MemoryRecordEmbedding(StringIdMixin, CreatedAtMixin, Base):
    __tablename__ = "MemoryRecordEmbedding"
    memory_id: Mapped[str] = mapped_column(
        "memoryId", ForeignKey("MemoryRecord.id", ondelete="CASCADE")
    )
    profile_id: Mapped[str] = mapped_column(
        "profileId", ForeignKey("EmbeddingProfile.id", ondelete="CASCADE")
    )
    embedding: Mapped[list[float]] = mapped_column(VectorType)
    __table_args__ = (
        UniqueConstraint("memoryId", "profileId"),
        Index(
            "MemoryRecordEmbedding_embedding_hnsw_idx",
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
    parse_status: Mapped[str] = mapped_column("parseStatus", String(20), default="pending")
    extracted_text: Mapped[str | None] = mapped_column("extractedText", Text, nullable=True)
    parse_error: Mapped[str | None] = mapped_column("parseError", Text, nullable=True)
    derived_bucket: Mapped[str | None] = mapped_column("derivedBucket", String(80), nullable=True)
    thumbnail_key: Mapped[str | None] = mapped_column("thumbnailKey", Text, nullable=True)
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


class ActionReceipt(StringIdMixin, CreatedAtMixin, Base):
    """写操作提交证明；模型文本本身永远不算成功。"""

    __tablename__ = "ActionReceipt"
    space_id: Mapped[str] = mapped_column(
        "spaceId", ForeignKey("CoupleSpace.id", ondelete="CASCADE")
    )
    user_id: Mapped[str] = mapped_column("userId", ForeignKey("User.id", ondelete="CASCADE"))
    conversation_id: Mapped[str | None] = mapped_column(
        "conversationId", ForeignKey("Conversation.id", ondelete="SET NULL"), nullable=True
    )
    source_message_id: Mapped[str | None] = mapped_column(
        "sourceMessageId", String(32), nullable=True
    )
    action_type: Mapped[str] = mapped_column("actionType", String(80))
    resource_type: Mapped[str] = mapped_column("resourceType", String(80))
    resource_id: Mapped[str | None] = mapped_column("resourceId", String(32), nullable=True)
    status: Mapped[str] = mapped_column(String(32))
    safe_summary: Mapped[str] = mapped_column("safeSummary", Text, default="")
    error_code: Mapped[str | None] = mapped_column("errorCode", String(80), nullable=True)
    tool_run_id: Mapped[str | None] = mapped_column(
        "toolRunId", ForeignKey("ToolRun.id", ondelete="SET NULL"), nullable=True
    )
    committed_at: Mapped[datetime | None] = mapped_column(
        "committedAt", DateTime(timezone=True), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        "updatedAt", DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
    __table_args__ = (
        CheckConstraint(
            "status IN ('proposed', 'confirmation_required', 'committed', 'failed', 'cancelled')",
            name="ActionReceipt_status_check",
        ),
        Index("ActionReceipt_user_createdAt_idx", "userId", "createdAt"),
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


class PerceptionSession(StringIdMixin, CreatedAtMixin, Base):
    __tablename__ = "PerceptionSession"
    space_id: Mapped[str] = mapped_column(
        "spaceId", ForeignKey("CoupleSpace.id", ondelete="CASCADE")
    )
    user_id: Mapped[str] = mapped_column("userId", ForeignKey("User.id", ondelete="CASCADE"))
    surface: Mapped[str] = mapped_column(String(24))
    device_session_id: Mapped[str] = mapped_column("deviceSessionId", String(120))
    active_conversation_id: Mapped[str | None] = mapped_column(
        "activeConversationId",
        ForeignKey("Conversation.id", ondelete="SET NULL"),
        nullable=True,
    )
    route: Mapped[str] = mapped_column(String(255), default="/")
    page_kind: Mapped[str] = mapped_column("pageKind", String(40), default="home")
    page_context: Mapped[dict[str, Any]] = mapped_column("pageContext", JsonType, default=dict)
    foreground: Mapped[bool] = mapped_column(Boolean, default=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    last_seen_at: Mapped[datetime] = mapped_column(
        "lastSeenAt", DateTime(timezone=True), default=utcnow
    )
    expires_at: Mapped[datetime] = mapped_column("expiresAt", DateTime(timezone=True))
    __table_args__ = (
        UniqueConstraint("userId", "deviceSessionId", "surface"),
        CheckConstraint(
            "surface IN ('web', 'tauri_main', 'tauri_pet')",
            name="PerceptionSession_surface_check",
        ),
        Index(
            "PerceptionSession_user_foreground_idx",
            "userId",
            "foreground",
            "lastSeenAt",
        ),
    )


class PerceptionEvent(StringIdMixin, Base):
    __tablename__ = "PerceptionEvent"
    spec_version: Mapped[str] = mapped_column("specVersion", String(10), default="1.0")
    schema_version: Mapped[int] = mapped_column("schemaVersion", Integer, default=1)
    space_id: Mapped[str] = mapped_column(
        "spaceId", ForeignKey("CoupleSpace.id", ondelete="CASCADE")
    )
    actor_user_id: Mapped[str | None] = mapped_column(
        "actorUserId", ForeignKey("User.id", ondelete="SET NULL"), nullable=True
    )
    companion_id: Mapped[str | None] = mapped_column(
        "companionId", ForeignKey("Companion.id", ondelete="SET NULL"), nullable=True
    )
    source: Mapped[str] = mapped_column(String(120))
    type: Mapped[str] = mapped_column(String(120))
    subject_type: Mapped[str | None] = mapped_column("subjectType", String(80), nullable=True)
    subject_id: Mapped[str | None] = mapped_column("subjectId", String(64), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(
        "occurredAt", DateTime(timezone=True), default=utcnow
    )
    observed_at: Mapped[datetime] = mapped_column(
        "observedAt", DateTime(timezone=True), default=utcnow
    )
    data: Mapped[dict[str, Any]] = mapped_column(JsonType, default=dict)
    sensitivity: Mapped[str] = mapped_column(String(20), default="normal")
    retention: Mapped[str] = mapped_column(String(20), default="working")
    correlation_id: Mapped[str | None] = mapped_column("correlationId", String(64), nullable=True)
    causation_id: Mapped[str | None] = mapped_column("causationId", String(64), nullable=True)
    dedupe_key: Mapped[str] = mapped_column("dedupeKey", String(255), unique=True)
    processed_at: Mapped[datetime | None] = mapped_column(
        "processedAt", DateTime(timezone=True), nullable=True
    )
    __table_args__ = (
        CheckConstraint(
            "sensitivity IN ('normal', 'sensitive', 'restricted')",
            name="PerceptionEvent_sensitivity_check",
        ),
        CheckConstraint(
            "retention IN ('ephemeral', 'working', 'episodic', 'audit')",
            name="PerceptionEvent_retention_check",
        ),
        Index("PerceptionEvent_space_occurredAt_idx", "spaceId", "occurredAt"),
        Index("PerceptionEvent_type_processedAt_idx", "type", "processedAt"),
    )


class MemoryIngestionCursor(StringIdMixin, CreatedAtMixin, Base):
    __tablename__ = "MemoryIngestionCursor"
    space_id: Mapped[str] = mapped_column(
        "spaceId", ForeignKey("CoupleSpace.id", ondelete="CASCADE")
    )
    source_type: Mapped[str] = mapped_column("sourceType", String(32))
    source_id: Mapped[str] = mapped_column("sourceId", String(64))
    last_message_id: Mapped[str | None] = mapped_column("lastMessageId", String(32), nullable=True)
    last_processed_at: Mapped[datetime | None] = mapped_column(
        "lastProcessedAt", DateTime(timezone=True), nullable=True
    )
    extractor_version: Mapped[str] = mapped_column(
        "extractorVersion", String(80), default="memory-v1"
    )
    __table_args__ = (UniqueConstraint("sourceType", "sourceId"),)


class MemoryExclusion(StringIdMixin, CreatedAtMixin, Base):
    __tablename__ = "MemoryExclusion"
    space_id: Mapped[str] = mapped_column(
        "spaceId", ForeignKey("CoupleSpace.id", ondelete="CASCADE")
    )
    actor_user_id: Mapped[str] = mapped_column(
        "actorUserId", ForeignKey("User.id", ondelete="CASCADE")
    )
    source_type: Mapped[str] = mapped_column("sourceType", String(32))
    source_id: Mapped[str] = mapped_column("sourceId", String(64))
    reason: Mapped[str] = mapped_column(Text, default="user_excluded")
    __table_args__ = (UniqueConstraint("sourceType", "sourceId"),)


class MemoryPreference(StringIdMixin, CreatedAtMixin, Base):
    __tablename__ = "MemoryPreference"
    user_id: Mapped[str] = mapped_column(
        "userId", ForeignKey("User.id", ondelete="CASCADE"), unique=True
    )
    paused: Mapped[bool] = mapped_column(Boolean, default=False)
    reference_enabled: Mapped[bool] = mapped_column("referenceEnabled", Boolean, default=True)
    conversation_enabled: Mapped[bool] = mapped_column("conversationEnabled", Boolean, default=True)
    direct_message_enabled: Mapped[bool] = mapped_column(
        "directMessageEnabled", Boolean, default=True
    )
    mood_enabled: Mapped[bool] = mapped_column("moodEnabled", Boolean, default=False)
    daily_question_enabled: Mapped[bool] = mapped_column(
        "dailyQuestionEnabled", Boolean, default=True
    )
    future_letter_enabled: Mapped[bool] = mapped_column(
        "futureLetterEnabled", Boolean, default=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        "updatedAt", DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


# 宠物核心（架构文档 §11）。Companion 是宠物的统一身份，下面三张表分别承载
# 「出生就定下的」「随时间漂移的」「值得回头看的」三类状态。
class CompanionPetProfile(StringIdMixin, CreatedAtMixin, Base):
    """长期不变的部分：物种、身体资源、性格、生日。"""

    __tablename__ = "CompanionPetProfile"
    companion_id: Mapped[str] = mapped_column(
        "companionId", ForeignKey("Companion.id", ondelete="CASCADE"), unique=True
    )
    species: Mapped[str] = mapped_column(String(40), default="dog")
    body_asset_id: Mapped[str] = mapped_column("bodyAssetId", String(120), default="kitty")
    traits: Mapped[dict[str, Any]] = mapped_column(JsonType, default=dict)
    birthday: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    relationship_level: Mapped[int] = mapped_column("relationshipLevel", Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(
        "updatedAt", DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class CompanionPetState(StringIdMixin, CreatedAtMixin, Base):
    """随时间漂移的部分。evaluatedAt 是离线结算的起点，不能省。"""

    __tablename__ = "CompanionPetState"
    companion_id: Mapped[str] = mapped_column(
        "companionId", ForeignKey("Companion.id", ondelete="CASCADE"), unique=True
    )
    needs: Mapped[dict[str, Any]] = mapped_column(JsonType, default=dict)
    mood: Mapped[dict[str, Any]] = mapped_column(JsonType, default=dict)
    relationship: Mapped[dict[str, Any]] = mapped_column(JsonType, default=dict)
    active_goal: Mapped[str] = mapped_column("activeGoal", String(40), default="idle")
    evaluated_at: Mapped[datetime] = mapped_column(
        "evaluatedAt", DateTime(timezone=True), default=utcnow
    )


class CompanionPetEvent(StringIdMixin, Base):
    """值得回头看的经历。processedAt IS NULL 是 P4 Reflection Agent 的输入队列。"""

    __tablename__ = "CompanionPetEvent"
    companion_id: Mapped[str] = mapped_column(
        "companionId", ForeignKey("Companion.id", ondelete="CASCADE")
    )
    type: Mapped[str] = mapped_column(String(60))
    payload: Mapped[dict[str, Any]] = mapped_column(JsonType, default=dict)
    importance: Mapped[int] = mapped_column(Integer, default=50)
    occurred_at: Mapped[datetime] = mapped_column(
        "occurredAt", DateTime(timezone=True), default=utcnow
    )
    processed_at: Mapped[datetime | None] = mapped_column(
        "processedAt", DateTime(timezone=True), nullable=True
    )
    __table_args__ = (
        # 消费端只查「某伴侣尚未处理、重要度够高」的记录，索引按这个形状建。
        Index("CompanionPetEvent_pending_idx", "companionId", "processedAt", "importance"),
    )


class AgentTask(StringIdMixin, CreatedAtMixin, Base):
    """一轮对话产生的语义任务。与 agent.task.* 事件流一一对应。"""

    __tablename__ = "AgentTask"
    user_id: Mapped[str] = mapped_column("userId", ForeignKey("User.id", ondelete="CASCADE"))
    companion_id: Mapped[str | None] = mapped_column(
        "companionId", ForeignKey("Companion.id", ondelete="SET NULL"), nullable=True
    )
    conversation_id: Mapped[str | None] = mapped_column(
        "conversationId", ForeignKey("Conversation.id", ondelete="SET NULL"), nullable=True
    )
    capability: Mapped[str] = mapped_column(String(60))
    status: Mapped[str] = mapped_column(String(30))
    risk_level: Mapped[str] = mapped_column("riskLevel", String(10), default="none")
    safe_summary: Mapped[str] = mapped_column("safeSummary", Text, default="")
    result_summary: Mapped[str | None] = mapped_column("resultSummary", Text, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(
        "completedAt", DateTime(timezone=True), nullable=True
    )
    __table_args__ = (Index("AgentTask_userId_createdAt_idx", "userId", "createdAt"),)


class AgentTaskStep(StringIdMixin, CreatedAtMixin, Base):
    """任务里的一次工具调用。toolRunId 指向执行层审计记录。"""

    __tablename__ = "AgentTaskStep"
    task_id: Mapped[str] = mapped_column("taskId", ForeignKey("AgentTask.id", ondelete="CASCADE"))
    tool_run_id: Mapped[str | None] = mapped_column(
        "toolRunId", ForeignKey("ToolRun.id", ondelete="SET NULL"), nullable=True
    )
    sequence: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(30))
    capability: Mapped[str] = mapped_column(String(60), default="")
    safe_summary: Mapped[str] = mapped_column("safeSummary", Text, default="")
    __table_args__ = (UniqueConstraint("taskId", "sequence"),)


# 双人私聊（计划文档 §3.3）。
#
# 与 `Message`（留言板）刻意分开：那个是按昵称署名的公开留言，这个是两个人
# 之间的私信，有明确的收发双方和已读状态。


class DirectMessage(StringIdMixin, CreatedAtMixin, Base):
    """一条私信。`readAt` 是宠物中介的全部依据。"""

    __tablename__ = "DirectMessage"
    space_id: Mapped[str] = mapped_column(
        "spaceId", ForeignKey("CoupleSpace.id", ondelete="CASCADE")
    )
    sender_id: Mapped[str] = mapped_column("senderId", ForeignKey("User.id", ondelete="CASCADE"))
    recipient_id: Mapped[str] = mapped_column(
        "recipientId", ForeignKey("User.id", ondelete="CASCADE")
    )
    body: Mapped[str] = mapped_column(Text, default="")
    attachment_ids: Mapped[list[str]] = mapped_column("attachmentIds", JsonType, default=list)
    memory_excluded: Mapped[bool] = mapped_column("memoryExcluded", Boolean, default=False)
    #: NULL 表示还没被打开。宠物只知道这一个事实——它**不知道**你在不在忙，
    #: 所以永远不许编造原因（计划文档 §3.2）。
    read_at: Mapped[datetime | None] = mapped_column(
        "readAt", DateTime(timezone=True), nullable=True
    )
    __table_args__ = (
        # 未读查询是最热的路径：收件人 + 未读 + 时间
        Index("DirectMessage_recipient_readAt_idx", "recipientId", "readAt"),
        Index("DirectMessage_createdAt_idx", "createdAt"),
    )


class PetInterjection(StringIdMixin, CreatedAtMixin, Base):
    """宠物在聊天流里说的话。

    **单独一张表，不混进 DirectMessage**：混进去的话「谁发的」就会出现第三种
    取值，之后每一处查询都要处理它。分开还有个好处——清空宠物的插话不影响
    真实对话记录。
    """

    __tablename__ = "PetInterjection"
    #: 说给谁听。宠物代答时对方是收件人，催促时是消息的接收者本人。
    audience_id: Mapped[str] = mapped_column(
        "audienceId", ForeignKey("User.id", ondelete="CASCADE")
    )
    #: 关联的那条未读消息，可空（比如纯粹的陪伴发言）
    message_id: Mapped[str | None] = mapped_column(
        "messageId", ForeignKey("DirectMessage.id", ondelete="CASCADE"), nullable=True
    )
    #: **说这句话的是哪只宠物。**
    #:
    #: 少了这一列，「谁说的」在落库时就丢了，前端只能拿本地那只顶上去——于是
    #: 同一条插话在两个人屏幕上挂着不同的名字。@ 谁就该是谁在答，而这个归属
    #: 只有写入的那一刻知道。
    #:
    #: 可空是为了旧数据：迁移之前的行没有这个信息，猜一个不如老实留空，
    #: 前端对空值回退到「宠物」这个中性称呼。
    companion_id: Mapped[str | None] = mapped_column(
        "companionId", ForeignKey("Companion.id", ondelete="SET NULL"), nullable=True
    )
    #: unread_nudge（催你看）/ standin（替你答）/ company（转移陪伴）
    kind: Mapped[str] = mapped_column(String(30))
    body: Mapped[str] = mapped_column(Text)
    __table_args__ = (Index("PetInterjection_audience_createdAt_idx", "audienceId", "createdAt"),)


# 每日一问（计划文档 §2.1）。
#
# 「两个人都答完才能看到对方的答案」是核心机制——回答从表演变成交换。
# 一天一道题，两人共享同一条 DailyQuestion，各自的回答分开存。


class DailyQuestion(StringIdMixin, Base):
    """今天该答的题。`date` 唯一，两人共享同一道。"""

    __tablename__ = "DailyQuestion"
    #: YYYY-MM-DD，唯一约束防止同一天生出两道题（并发请求下靠它兜底）
    date: Mapped[str] = mapped_column(String(10), unique=True)
    prompt: Mapped[str] = mapped_column(Text)
    #: daily / memory / imagine / confess，对应「日常/回忆/想象/坦白」
    category: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(
        "createdAt", DateTime(timezone=True), default=utcnow
    )


class DailyAnswer(StringIdMixin, CreatedAtMixin, Base):
    """一个人对某天问题的回答。揭晓逻辑（两人都答完才互相可见）在服务层，不在这张表。"""

    __tablename__ = "DailyAnswer"
    question_id: Mapped[str] = mapped_column(
        "questionId", ForeignKey("DailyQuestion.id", ondelete="CASCADE")
    )
    user_id: Mapped[str] = mapped_column("userId", ForeignKey("User.id", ondelete="CASCADE"))
    body: Mapped[str] = mapped_column(Text)
    __table_args__ = (UniqueConstraint("questionId", "userId"),)


class MoodEntry(StringIdMixin, CreatedAtMixin, Base):
    """一天一个心情（计划文档 §2.4）。

    **真正的价值不在图表**，在于给 Cognition Agent 一个有依据的关心理由：
    从「你很久没互动了」变成「对方今天标了低落」。所以 `mood` 是个能比较的
    数值，不是自由文本——note 只是补充。
    """

    __tablename__ = "MoodEntry"
    user_id: Mapped[str] = mapped_column("userId", ForeignKey("User.id", ondelete="CASCADE"))
    #: YYYY-MM-DD。用字符串而不是 date：与 DailyQuestion 一致，也避免时区把
    #: 「今天」挪到前一天——打卡这件事的「今天」是用户本地的今天。
    date: Mapped[str] = mapped_column(String(10))
    #: 1(低落) – 5(很好)
    mood: Mapped[int] = mapped_column(Integer)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    __table_args__ = (
        # 一人一天一条，重复打卡是更新而不是插入
        UniqueConstraint("userId", "date"),
        Index("MoodEntry_date_idx", "date"),
    )


class FutureLetter(StringIdMixin, CreatedAtMixin, Base):
    """写给未来的信（计划文档 §2.6）。

    **`unlockAt` 之前服务端不返回正文。** 只在前端藏等于没锁——接口把正文发
    出去了，谁都能在网络面板里看到。这是这个功能唯一的技术要求，也是它唯一
    可能被做错的地方，所以 API 层有专门的测试守着。

    刻意没有 recipientId：这是封写给「我们」的信，解锁后两个人都能看。也刻意
    不让作者提前重读——封进去就是封进去了，能偷看的时间胶囊没有意义。
    """

    __tablename__ = "FutureLetter"
    author_id: Mapped[str] = mapped_column("authorId", ForeignKey("User.id", ondelete="CASCADE"))
    body: Mapped[str] = mapped_column(Text)
    attachment_ids: Mapped[list[str]] = mapped_column("attachmentIds", JsonType, default=list)
    unlock_at: Mapped[datetime] = mapped_column("unlockAt", DateTime(timezone=True))
    #: 第一次被读到的时刻。解锁当天宠物来送信，这个字段是「送过了」的依据。
    opened_at: Mapped[datetime | None] = mapped_column(
        "openedAt", DateTime(timezone=True), nullable=True
    )
    __table_args__ = (Index("FutureLetter_unlockAt_idx", "unlockAt"),)


class MapPin(StringIdMixin, CreatedAtMixin, AttributionMixin, Base):
    """去过的地方（计划文档 §2.5）。

    坐标是 **GCJ-02**（高德原生，2026-07-30 选型决定）。存进去什么样画出来
    就什么样，前后端都不做坐标转换——转换写在哪一侧都迟早会漏一处。
    """

    __tablename__ = "MapPin"
    title: Mapped[str] = mapped_column(Text)
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: 去的那天，自由格式字符串（与 Photo.date 一致）
    date: Mapped[str | None] = mapped_column(String(80), nullable=True)
    #: 与相册、时间线复用同一批 Attachment
    photo_ids: Mapped[list[str]] = mapped_column("photoIds", JsonType, default=list)


# ── 桌面本地执行器（二期）──────────────────────────────────────────────
#
# 宠物的大脑在云端，但「读这台电脑上的文件」只能发生在你自己的机器上。
# 这两张表就是那条通路：云端把工具调用挂在这里，桌面端认领、执行、回填。


class DesktopExecutor(StringIdMixin, CreatedAtMixin, Base):
    """一台注册过的电脑。

    **一个用户可以有多台**（家里的、公司的），所以派发时必须挑一台，
    不能广播——否则同一个调用会在几台机器上各跑一遍。
    """

    __tablename__ = "DesktopExecutor"
    user_id: Mapped[str] = mapped_column("userId", ForeignKey("User.id", ondelete="CASCADE"))
    #: 给人看的名字，比如「Ricky 的 MacBook」。
    name: Mapped[str] = mapped_column(String(120))
    #: 最后一次心跳。挑执行者时只看还活着的。
    last_seen_at: Mapped[datetime] = mapped_column(
        "lastSeenAt", DateTime(timezone=True), default=utcnow
    )
    #: 这台机器允许宠物读哪些目录。**服务端这份只用于展示**——真正的校验在
    #: 本地做（见 src-tauri）。放在服务端校验等于把闸门交给一个可能被
    #: 提示注入影响的系统，那不叫闸门。
    allowed_roots: Mapped[list[str]] = mapped_column("allowedRoots", JsonType, default=list)
    enabled: Mapped[bool] = mapped_column(default=True)
    __table_args__ = (Index("DesktopExecutor_userId_lastSeenAt_idx", "userId", "lastSeenAt"),)


class LocalToolCall(StringIdMixin, CreatedAtMixin, Base):
    """一次派发到某台电脑上的工具调用。

    ## 状态机就是租约

    `pending → claimed → done / failed`。认领走的是一条原子的
    `UPDATE ... WHERE state='pending'`：**抢到的那一行才返回**，所以哪怕两台
    机器同时看到通知，也只有一台能真正执行。把「挑执行者」放在派发端做是不够的
    ——那只是选了个收件人，拦不住另一台也去执行。

    ## 为什么参数不走 SSE

    `stream_outbox` 是**全局广播**，没有按用户过滤：每个连接都会收到每一条事件。
    把文件路径放进 payload，等于对方的浏览器也会收到「正在读 ~/Documents/xxx」。
    所以 SSE 只发一个「有活儿了，id=X」，参数由桌面端带着鉴权来取。
    """

    __tablename__ = "LocalToolCall"
    executor_id: Mapped[str] = mapped_column(
        "executorId", ForeignKey("DesktopExecutor.id", ondelete="CASCADE")
    )
    #: 工具名，比如 local_read。
    tool: Mapped[str] = mapped_column(String(80))
    arguments: Mapped[dict[str, Any]] = mapped_column(JsonType, default=dict)
    state: Mapped[str] = mapped_column(String(16), default="pending")
    #: 成功时是结果，失败时是 {"error": "人话"}。
    result: Mapped[dict[str, Any] | None] = mapped_column(JsonType, nullable=True)
    claimed_at: Mapped[datetime | None] = mapped_column(
        "claimedAt", DateTime(timezone=True), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        "resolvedAt", DateTime(timezone=True), nullable=True
    )
    __table_args__ = (
        CheckConstraint(
            "state IN ('pending', 'claimed', 'done', 'failed')",
            name="LocalToolCall_state_check",
        ),
        Index("LocalToolCall_executorId_state_idx", "executorId", "state"),
    )
