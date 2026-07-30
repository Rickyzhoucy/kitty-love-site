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
    due_at: Mapped[datetime | None] = mapped_column(
        "dueAt", DateTime(timezone=True), nullable=True
    )
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
    birthday: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )
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
    task_id: Mapped[str] = mapped_column(
        "taskId", ForeignKey("AgentTask.id", ondelete="CASCADE")
    )
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
    sender_id: Mapped[str] = mapped_column(
        "senderId", ForeignKey("User.id", ondelete="CASCADE")
    )
    recipient_id: Mapped[str] = mapped_column(
        "recipientId", ForeignKey("User.id", ondelete="CASCADE")
    )
    body: Mapped[str] = mapped_column(Text, default="")
    attachment_ids: Mapped[list[str]] = mapped_column(
        "attachmentIds", JsonType, default=list
    )
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
    #: unread_nudge（催你看）/ standin（替你答）/ company（转移陪伴）
    kind: Mapped[str] = mapped_column(String(30))
    body: Mapped[str] = mapped_column(Text)
    __table_args__ = (
        Index("PetInterjection_audience_createdAt_idx", "audienceId", "createdAt"),
    )
