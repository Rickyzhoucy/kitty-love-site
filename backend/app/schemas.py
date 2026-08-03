from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.pet_state import PetAssetId


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
    thumbnail_url: str | None = None


class MilestoneCreate(ApiModel):
    """故事线上的一件事。地点可选——不是每件值得记的事都发生在某个地方。"""

    date: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=255)
    description: str = Field(max_length=20_000)
    #: GCJ-02（高德原生）。前后端都不做坐标转换。
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    photo_ids: list[str] = Field(default_factory=list, max_length=20)


class MilestoneUpdate(ApiModel):
    date: str | None = Field(default=None, min_length=1, max_length=80)
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=20_000)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    photo_ids: list[str] | None = Field(default=None, max_length=20)


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


MemoryVisibility = Literal[
    "user_private",
    "couple_shared",
    "companion_relationship",
]
MemoryType = Literal[
    "fact",
    "preference",
    "commitment",
    "episode",
    "interaction_preference",
    "relationship",
]
MemorySensitivity = Literal["normal", "sensitive", "restricted"]
MemoryStatus = Literal[
    "active",
    "superseded",
    "retracted",
    "contested",
    "pending_review",
]


class MemoryCreate(ApiModel):
    visibility: MemoryVisibility
    memory_type: MemoryType
    content: str = Field(min_length=1, max_length=50_000)
    importance: int = Field(default=50, ge=0, le=100)
    confidence: float = Field(default=1.0, ge=0, le=1)
    sensitivity: MemorySensitivity = "normal"
    companion_id: str | None = None
    subject_type: str = Field(default="other", min_length=1, max_length=32)
    subject_id: str | None = Field(default=None, max_length=32)
    predicate: str | None = Field(default=None, max_length=120)
    object_json: dict[str, Any] | None = None
    valid_from: datetime | None = None
    valid_to: datetime | None = None
    occurred_at: datetime | None = None
    source_type: Literal[
        "chat_message",
        "direct_message",
        "resource_event",
        "pet_event",
        "explicit_user",
        "admin",
    ] = "explicit_user"
    source_ids: list[str] = Field(default_factory=list, max_length=50)
    source_excerpt: str | None = Field(default=None, max_length=240)
    extractor_version: str = Field(default="explicit-v1", max_length=80)


class MemoryRead(ApiModel):
    id: str
    created_at: datetime
    updated_at: datetime
    space_id: str
    owner_id: str | None
    companion_id: str | None
    visibility: MemoryVisibility
    memory_type: MemoryType
    content: str
    subject_type: str
    subject_id: str | None
    predicate: str | None
    object_json: dict[str, Any] | None
    confidence: float
    importance: int
    sensitivity: MemorySensitivity
    status: MemoryStatus
    content_hash: str
    normalized_key: str | None
    valid_from: datetime | None
    valid_to: datetime | None
    occurred_at: datetime | None
    last_confirmed_at: datetime | None
    last_accessed_at: datetime | None
    access_count: int
    supersedes_id: str | None
    extractor_version: str
    created_by_kind: str


class MemoryCorrect(ApiModel):
    content: str = Field(min_length=1, max_length=50_000)
    importance: int | None = Field(default=None, ge=0, le=100)
    sensitivity: MemorySensitivity | None = None
    valid_from: datetime | None = None
    reason: str = Field(default="用户纠正", max_length=500)


class MemoryVisibilityUpdate(ApiModel):
    visibility: MemoryVisibility
    companion_id: str | None = None


class MemoryEvidenceRead(ApiModel):
    id: str
    created_at: datetime
    memory_id: str
    source_type: str
    source_id: str
    actor_user_id: str | None
    excerpt: str | None
    excerpt_hash: str
    observed_at: datetime
    extractor_version: str


class MemoryRevisionRead(ApiModel):
    id: str
    created_at: datetime
    memory_id: str
    operation: str
    before_json: dict[str, Any] | None
    after_json: dict[str, Any] | None
    actor_type: str
    actor_id: str | None
    reason: str


class ActionReceiptRead(ApiModel):
    id: str
    created_at: datetime
    updated_at: datetime
    action_type: str
    resource_type: str
    resource_id: str | None
    status: Literal[
        "proposed",
        "confirmation_required",
        "committed",
        "failed",
        "cancelled",
    ]
    safe_summary: str
    error_code: str | None
    committed_at: datetime | None


class MemoryMutationRead(ApiModel):
    memory: MemoryRead
    receipt: ActionReceiptRead


class MemoryPreferenceRead(ApiModel):
    paused: bool
    reference_enabled: bool
    conversation_enabled: bool
    direct_message_enabled: bool
    mood_enabled: bool
    daily_question_enabled: bool
    future_letter_enabled: bool
    reference_available: bool
    private_extraction_available: bool
    shared_extraction_available: bool


class MemoryPreferenceUpdate(ApiModel):
    paused: bool | None = None
    reference_enabled: bool | None = None
    conversation_enabled: bool | None = None
    direct_message_enabled: bool | None = None
    mood_enabled: bool | None = None
    daily_question_enabled: bool | None = None
    future_letter_enabled: bool | None = None


class PerceptionSessionWrite(ApiModel):
    device_session_id: str = Field(min_length=8, max_length=120)
    surface: Literal["web", "tauri_main", "tauri_pet"] = "web"
    route: str = Field(default="/", max_length=255)
    page_kind: str = Field(default="home", max_length=40)
    page_context: dict[str, Any] = Field(default_factory=dict)
    active_conversation_id: str | None = None
    foreground: bool = True
    revision: int = Field(default=1, ge=1)


class PerceptionSessionRead(ApiModel):
    id: str
    created_at: datetime
    space_id: str
    user_id: str
    device_session_id: str
    surface: Literal["web", "tauri_main", "tauri_pet"]
    route: str
    page_kind: str
    page_context: dict[str, Any]
    active_conversation_id: str | None
    foreground: bool
    revision: int
    last_seen_at: datetime
    expires_at: datetime


class PerceptionEventWrite(ApiModel):
    source: str = Field(default="kitty-love.web", max_length=120)
    type: str = Field(min_length=1, max_length=120)
    subject_type: str | None = Field(default=None, max_length=80)
    subject_id: str | None = Field(default=None, max_length=64)
    data: dict[str, Any] = Field(default_factory=dict)
    sensitivity: Literal["normal", "sensitive", "restricted"] = "normal"
    retention: Literal["ephemeral", "working", "episodic", "audit"] = "working"
    correlation_id: str | None = Field(default=None, max_length=64)
    causation_id: str | None = Field(default=None, max_length=64)
    dedupe_key: str = Field(min_length=8, max_length=255)
    occurred_at: datetime | None = None


class PerceptionEventRead(ApiModel):
    id: str
    spec_version: str
    schema_version: int
    space_id: str
    actor_user_id: str | None
    companion_id: str | None
    source: str
    type: str
    subject_type: str | None
    subject_id: str | None
    occurred_at: datetime
    observed_at: datetime
    data: dict[str, Any]
    sensitivity: Literal["normal", "sensitive", "restricted"]
    retention: Literal["ephemeral", "working", "episodic", "audit"]
    correlation_id: str | None
    causation_id: str | None
    dedupe_key: str


class PetUpdate(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    # 名单只有一份，在 app.pet_state 里。以前这里手抄了一遍，结果加了两只
    # 插画版的狗之后两边对不上：前端能选，接口 422。
    asset_id: PetAssetId | None = None


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
    #: 说这句话的那只宠物，以及它当时的名字和外观。
    #:
    #: **必须由服务端给，不能让前端拿本地那只顶上。** 两个人各有一只宠物，
    #: 前端只知道自己那只；靠本地猜的结果是同一条插话在两边挂着不同名字。
    #: 旧数据没有归属，这里就是 None，前端回退到中性称呼。
    speaker_name: str | None = None
    speaker_asset_id: str | None = None


class PartnerRead(ApiModel):
    id: str
    username: str
    display_name: str
    #: 对方那只宠物叫什么。前端要用它判断「这条消息是不是在叫对方的宠物」
    #: ——只知道自己那只的话，对方 @ 自己宠物时这边不会显示「正在想」。
    pet_name: str | None = None


class ChatThreadRead(ApiModel):
    """聊天页一次拉全：对方是谁、消息、宠物的插话、我的未读数。"""

    partner: PartnerRead
    messages: list[DirectMessageRead]
    #: 宠物在这条流里说过的话。单独一组，前端要把它和真人消息**明确区分**——
    #: 宠物永远以自己的身份说话（计划文档 §3.2）。
    interjections: list[PetInterjectionRead]
    unread_count: int


class DailyQuestionRead(ApiModel):
    id: str
    date: str
    prompt: str
    category: str


class DailyAnswerRead(ApiModel):
    id: str
    created_at: datetime
    user_id: str
    body: str


class DailyAnswerCreate(ApiModel):
    body: str = Field(min_length=1, max_length=10_000)


class DailyQuestionStateRead(ApiModel):
    """今天的题 + 揭晓状态。`partner_answer` 在两人都答完之前恒为 null。"""

    question: DailyQuestionRead
    partner: PartnerRead
    my_answer: DailyAnswerRead | None
    partner_answered: bool
    partner_answer: DailyAnswerRead | None


class MoodEntryRead(ApiModel):
    id: str
    created_at: datetime
    user_id: str
    date: str
    mood: int
    note: str | None


class MoodWrite(ApiModel):
    """打卡。`date` 留空就是今天——由服务端按 UTC 取，客户端要补昨天就明确传。"""

    mood: int = Field(ge=1, le=5)
    note: str | None = Field(default=None, max_length=2_000)
    date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")


class MoodBoardRead(ApiModel):
    """两个人的曲线画在一起，所以一次把两边都返回。"""

    partner: PartnerRead
    mine: list[MoodEntryRead]
    theirs: list[MoodEntryRead]


class FutureLetterCreate(ApiModel):
    body: str = Field(min_length=1, max_length=50_000)
    attachment_ids: list[str] = Field(default_factory=list, max_length=8)
    unlock_at: datetime


class FutureLetterRead(ApiModel):
    """未解锁的信 `body` 恒为 null、`attachment_ids` 恒为空。

    正文用 `str | None` 而不是 `str`：类型本身就说明「可能没有」，调用方不会
    以为拿到空字符串是内容为空。服务端在锁着的时候**根本不把正文放进响应**，
    不是发出去再让前端藏（计划文档 §2.6）。
    """

    id: str
    created_at: datetime
    author_id: str
    unlock_at: datetime
    opened_at: datetime | None
    unlocked: bool
    body: str | None
    attachment_ids: list[str]


class PetActionRead(ApiModel):
    action: str
    animation: str
    asset_id: str | None
    message: str | None
    duration: int
