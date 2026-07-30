from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class ApiModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


class Entity(ApiModel):
    id: str
    created_at: datetime
    created_by: str | None = None
    created_by_companion: str | None = None


# Memo / Reminder 已拆成 Plan / Wish，见 docs/couple-site-feature-plan.md §0.1。


class PlanCreate(ApiModel):
    """要做的事。`dueAt` 为空就是没期限的那种，只在计划页出现。"""

    title: str = Field(min_length=1, max_length=10_000)
    note: str | None = Field(default=None, max_length=10_000)
    due_at: datetime | None = None
    completed_at: datetime | None = None


class PlanUpdate(ApiModel):
    title: str | None = Field(default=None, min_length=1, max_length=10_000)
    note: str | None = Field(default=None, max_length=10_000)
    due_at: datetime | None = None
    completed_at: datetime | None = None


class PlanRead(Entity, PlanCreate):
    pass


WishCategory = Literal["to-eat", "to-go", "to-buy"]


class WishCreate(ApiModel):
    title: str = Field(min_length=1, max_length=10_000)
    note: str | None = Field(default=None, max_length=10_000)
    category: WishCategory
    completed_at: datetime | None = None
    completion_photo_id: str | None = Field(default=None, max_length=32)


class WishUpdate(ApiModel):
    title: str | None = Field(default=None, min_length=1, max_length=10_000)
    note: str | None = Field(default=None, max_length=10_000)
    category: WishCategory | None = None
    completed_at: datetime | None = None
    completion_photo_id: str | None = Field(default=None, max_length=32)


class WishRead(Entity, WishCreate):
    pass


class PhotoCreate(ApiModel):
    attachment_id: str
    caption: str = Field(max_length=10_000)
    date: str | None = Field(default=None, max_length=80)


class PhotoUpdate(ApiModel):
    caption: str | None = Field(default=None, max_length=10_000)
    date: str | None = Field(default=None, max_length=80)


class PhotoRead(Entity, PhotoCreate):
    url: str


class MilestoneCreate(ApiModel):
    date: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=255)
    description: str = Field(max_length=20_000)


class MilestoneUpdate(ApiModel):
    date: str | None = Field(default=None, min_length=1, max_length=80)
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=20_000)


class MilestoneRead(Entity, MilestoneCreate):
    pass


class MessageCreate(ApiModel):
    nickname: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=20_000)


class MessageUpdate(ApiModel):
    nickname: str | None = Field(default=None, min_length=1, max_length=120)
    content: str | None = Field(default=None, min_length=1, max_length=20_000)


class MessageRead(Entity, MessageCreate):
    pass


Recurrence = Literal["none", "yearly", "monthly"]


class TimerCreate(ApiModel):
    title: str = Field(min_length=1, max_length=255)
    date: str = Field(min_length=1, max_length=80)
    type: Literal["countdown", "countup"]
    description: str | None = Field(default=None, max_length=10_000)
    recurrence: Recurrence = "none"
    #: 提前几天提醒。空数组表示不提醒；同一天重复的值会被去重。
    remind_days_before: list[int] = Field(default_factory=list, max_length=8)


class TimerUpdate(ApiModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    date: str | None = Field(default=None, min_length=1, max_length=80)
    type: Literal["countdown", "countup"] | None = None
    description: str | None = Field(default=None, max_length=10_000)
    recurrence: Recurrence | None = None
    remind_days_before: list[int] | None = Field(default=None, max_length=8)


class TimerRead(Entity, TimerCreate):
    pass


class LoginRequest(ApiModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=256)
    device_name: str | None = Field(default=None, max_length=120)
    client: Literal["browser", "device", "desktop"] = "browser"


class SessionUser(ApiModel):
    id: str
    username: str
    display_name: str


class LoginResponse(ApiModel):
    user: SessionUser
    token: str | None = None
    expires_at: datetime


class SessionRead(ApiModel):
    id: str
    device_name: str | None
    created_at: datetime
    last_seen_at: datetime
    expires_at: datetime
    current: bool


class PresignUploadRequest(ApiModel):
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(min_length=1, max_length=200)
    size: Annotated[int, Field(gt=0)]
    sha256: str = Field(pattern=r"^[a-fA-F0-9]{64}$")


class PresignUploadResponse(ApiModel):
    bucket: str
    object_key: str
    upload_url: str
    expires_in: int


class CompleteUploadRequest(ApiModel):
    bucket: str
    object_key: str
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(min_length=1, max_length=200)
    size: Annotated[int, Field(gt=0)]
    sha256: str = Field(pattern=r"^[a-fA-F0-9]{64}$")
    version_id: str | None = None


class AttachmentRead(Entity):
    owner_id: str
    bucket: str
    object_key: str
    version_id: str | None
    filename: str
    content_type: str
    size: int
    sha256: str
    status: str
    parse_status: str
    parse_error: str | None
    download_url: str
    thumbnail_url: str | None


class ConversationCreate(ApiModel):
    companion_id: str | None = None
    title: str | None = Field(default=None, max_length=200)


class ConversationRead(Entity):
    user_id: str
    companion_id: str
    title: str | None
    updated_at: datetime
    #: 首条用户发言的截断预览。没有它的话，对话列表就只是一串日期，
    #: 用户没法在里面找到「上次聊蛋糕的那次」。
    preview: str | None = None
    message_count: int = 0


class ChatMessageRead(Entity):
    conversation_id: str
    role: str
    content: str
    metadata: dict[str, Any] = Field(validation_alias="metadata_")


class ChatStreamRequest(ApiModel):
    conversation_id: str | None = None
    message: str = Field(min_length=1, max_length=50_000)
    attachment_ids: list[str] = Field(default_factory=list, max_length=8)


class ProfileUpdate(ApiModel):
    profile: dict[str, Any]


class ProfileRead(Entity):
    user_id: str
    profile: dict[str, Any]
    updated_at: datetime


class PersonaUpdate(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    prompt: str | None = Field(default=None, min_length=1, max_length=50_000)


class PersonaRead(Entity):
    companion_id: str
    name: str
    prompt: str
    version: int


class MemoryCreate(ApiModel):
    scope: Literal["owner", "companion", "shared"]
    kind: str = Field(min_length=1, max_length=40)
    content: str = Field(min_length=1, max_length=50_000)
    importance: int = Field(default=50, ge=0, le=100)
    companion_id: str | None = None
    occurred_at: datetime | None = None
    source_message_ids: list[str] = Field(default_factory=list, max_length=50)


class MemoryRead(Entity, MemoryCreate):
    owner_id: str | None
    content_hash: str


class PetUpdate(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    asset_id: Literal[
        "kitty",
        "momo",
        "hello-kitty",
        "snoopy",
        "shiba",
        "bichon",
    ] | None = None


class PetRead(Entity):
    name: str
    asset_id: str | None
    updated_at: datetime


class PetStateWrite(ApiModel):
    """客户端行为脑的快照。服务端不解释内容，只负责存和算离线时长。"""

    needs: dict[str, float] = Field(default_factory=dict)
    mood: dict[str, Any] = Field(default_factory=dict)
    relationship: dict[str, Any] = Field(default_factory=dict)
    active_goal: str = Field(default="idle", max_length=40)
    traits: dict[str, float] = Field(default_factory=dict)


class PetStateRead(ApiModel):
    companion_id: str
    traits: dict[str, Any]
    needs: dict[str, Any] | None
    mood: dict[str, Any] | None
    relationship: dict[str, Any] | None
    active_goal: str
    #: 距上次结算的秒数，**已夹到 cappedAt**。客户端拿它推进衰减。
    elapsed_seconds: float
    capped_at: int


class PetCognitionRequest(ApiModel):
    """客户端请求宠物「想一件事」。

    `trigger` 是这次请求的来源。它会被对照 `FORBIDDEN_TRIGGERS` 检查——
    鼠标移动、目光跟随、走路眨眼这些一律不得触发模型（架构文档 §5.1）。
    """

    type: Literal[
        "user_message",
        "ambiguous_intent",
        "important_event",
        "proactive_thought",
        "relationship_reflection",
        "task_planning",
    ] = "proactive_thought"
    trigger: str | None = None
    needs: dict[str, float] = Field(default_factory=dict)
    mood: dict[str, Any] = Field(default_factory=dict)
    relationship: dict[str, Any] = Field(default_factory=dict)
    page: str = Field(default="", max_length=200)
    local_time: str = Field(default="", max_length=40)
    recent_interactions: list[str] = Field(default_factory=list)
    active_task: str | None = Field(default=None, max_length=120)
    #: 与前端 PetInitiative 对齐。用户可以关闭主动交流或降低频率（§10）。
    initiative: Literal["normal", "quiet", "off"] = "normal"


class PetCognitionRead(ApiModel):
    goal: str
    emotion: str
    reason: str
    utterance: str | None
    capability_request: str | None
    memory_proposal: str | None
    expires_in: int


class PetEventWrite(ApiModel):
    """客户端上报一条值得记住的事件（架构文档 §9）。

    类型不在 Reflection 白名单里也照收——过滤在读取端，写下来的痕迹将来
    调门槛时还能回溯。
    """

    type: str = Field(min_length=1, max_length=60)
    payload: dict[str, Any] = Field(default_factory=dict)
    importance: int = Field(default=50, ge=0, le=100)


class DirectMessageCreate(ApiModel):
    body: str = Field(default="", max_length=20_000)
    attachment_ids: list[str] = Field(default_factory=list, max_length=8)


class DirectMessageRead(ApiModel):
    id: str
    created_at: datetime
    sender_id: str
    recipient_id: str
    body: str
    attachment_ids: list[str]
    read_at: datetime | None


class PetInterjectionRead(ApiModel):
    id: str
    created_at: datetime
    kind: str
    body: str
    message_id: str | None


class PartnerRead(ApiModel):
    id: str
    username: str
    display_name: str


class ChatThreadRead(ApiModel):
    """聊天页一次拉全：对方是谁、消息、宠物的插话、我的未读数。"""

    partner: PartnerRead
    messages: list[DirectMessageRead]
    #: 宠物在这条流里说过的话。单独一组，前端要把它和真人消息**明确区分**——
    #: 宠物永远以自己的身份说话（计划文档 §3.2）。
    interjections: list[PetInterjectionRead]
    unread_count: int


class PetActionRead(ApiModel):
    action: str
    animation: str
    asset_id: str | None
    message: str | None
    duration: int
