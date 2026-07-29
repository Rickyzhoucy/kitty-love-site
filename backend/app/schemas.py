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


class MemoCreate(ApiModel):
    category: str = Field(min_length=1, max_length=80)
    text: str = Field(min_length=1, max_length=10_000)
    completed: bool = False


class MemoUpdate(ApiModel):
    category: str | None = Field(default=None, min_length=1, max_length=80)
    text: str | None = Field(default=None, min_length=1, max_length=10_000)
    completed: bool | None = None


class MemoRead(Entity, MemoCreate):
    pass


class ReminderCreate(ApiModel):
    content: str = Field(min_length=1, max_length=10_000)
    due_date: str = Field(min_length=1, max_length=80)
    completed: bool = False


class ReminderUpdate(ApiModel):
    content: str | None = Field(default=None, min_length=1, max_length=10_000)
    due_date: str | None = Field(default=None, min_length=1, max_length=80)
    completed: bool | None = None


class ReminderRead(Entity, ReminderCreate):
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


class TimerCreate(ApiModel):
    title: str = Field(min_length=1, max_length=255)
    date: str = Field(min_length=1, max_length=80)
    type: Literal["countdown", "countup"]
    description: str | None = Field(default=None, max_length=10_000)


class TimerUpdate(ApiModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    date: str | None = Field(default=None, min_length=1, max_length=80)
    type: Literal["countdown", "countup"] | None = None
    description: str | None = Field(default=None, max_length=10_000)


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


class PetActionRead(ApiModel):
    action: str
    animation: str
    asset_id: str | None
    message: str | None
    duration: int
