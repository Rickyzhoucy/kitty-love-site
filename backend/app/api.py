import hashlib
import logging
from datetime import timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import RedirectResponse, StreamingResponse
from pydantic import Field as PydanticField
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app import local_executor, passkeys, runtime_config
from app.agents.cognition import CognitionInput
from app.agents.conversation import AgentRuntime
from app.agents.reflection import (
    REFLECTION_BATCH_TRIGGER,
    pending_count,
    record_event,
)
from app.anniversaries import upcoming as upcoming_anniversaries
from app.auth import (
    DUMMY_PASSWORD_HASH,
    SESSION_COOKIE_NAME,
    CurrentSession,
    CurrentUser,
    create_session,
    set_session_cookie,
    verify_password,
)
from app.chat_assist import mentions_pet
from app.cognition_queue import CognitionType, daily_proactive_budget
from app.config import Settings, get_settings
from app.conversations import ConversationService
from app.daily_questions import both_answered, ensure_today, get_answer, submit_answer
from app.db import get_session, session_factory
from app.direct_messages import (
    PartnerUnavailable,
    list_interjections,
    list_thread,
    mark_read,
    oldest_unread,
    resolve_partner,
    send_message,
    unread_count,
    verify_attachments,
)
from app.embeddings import (
    OpenAICompatibleEmbeddingProvider,
    UnavailableEmbeddingProvider,
)
from app.events import SSE_HEADERS, stream_outbox
from app.future_letters import (
    create as create_letter,
)
from app.future_letters import (
    list_letters,
    open_letter,
    redact,
)
from app.localtime import local_today
from app.memory import MemoryService
from app.models import (
    ActionReceipt,
    Attachment,
    AuthAttempt,
    ChatMessage,
    Companion,
    CompanionPersona,
    CompanionPetProfile,
    DesktopExecutor,
    EventTimer,
    Message,
    Milestone,
    OutboxEvent,
    Photo,
    Plan,
    SiteConfig,
    SiteConfigHistory,
    User,
    UserSession,
    Wish,
    utcnow,
)
from app.moods import (
    history as mood_history,
)
from app.moods import (
    partner_today as mood_of_partner,
)
from app.moods import (
    upsert as upsert_mood,
)
from app.perception import current_session, upsert_session
from app.perception import record_event as record_perception_event
from app.pet_cognition import PetCognitionService
from app.pet_mediation import run_mediation
from app.pet_state import (
    DEFAULT_ASSET,
    MAX_OFFLINE_SECONDS,
    elapsed_seconds,
    load_state,
    resolve_pet,
    save_state,
    species_of,
)
from app.photo_service import (
    ALLOWED_PHOTO_TYPES,
    PhotoService,
    legacy_photo_thumbnail_key,
)
from app.schemas import (
    ApiModel,
    AttachmentRead,
    ChatMessageRead,
    ChatStreamRequest,
    ChatThreadRead,
    CompleteUploadRequest,
    ConversationCreate,
    ConversationRead,
    DailyAnswerCreate,
    DailyQuestionStateRead,
    DirectMessageCreate,
    DirectMessageRead,
    FutureLetterCreate,
    FutureLetterRead,
    LoginRequest,
    LoginResponse,
    MemoryCorrect,
    MemoryCreate,
    MemoryEvidenceRead,
    MemoryMutationRead,
    MemoryPreferenceRead,
    MemoryPreferenceUpdate,
    MemoryRead,
    MemoryRevisionRead,
    MessageCreate,
    MessageRead,
    MessageUpdate,
    MilestoneCreate,
    MilestoneRead,
    MilestoneUpdate,
    MoodBoardRead,
    MoodWrite,
    PerceptionEventRead,
    PerceptionEventWrite,
    PerceptionSessionRead,
    PerceptionSessionWrite,
    PersonaRead,
    PersonaUpdate,
    PetActionRead,
    PetCognitionRead,
    PetCognitionRequest,
    PetEventWrite,
    PetInterjectionRead,
    PetRead,
    PetStateRead,
    PetStateWrite,
    PetUpdate,
    PhotoCreate,
    PhotoRead,
    PhotoUpdate,
    PlanCreate,
    PlanRead,
    PlanUpdate,
    PresignUploadRequest,
    PresignUploadResponse,
    ProfileRead,
    ProfileUpdate,
    SessionRead,
    SessionUser,
    TimerCreate,
    TimerRead,
    TimerUpdate,
    WishCreate,
    WishRead,
    WishUpdate,
)
from app.services import CrudService
from app.site_config import EDITABLE_KEYS as EDITABLE_SITE_CONFIG_KEYS
from app.site_config import load as load_site_config
from app.storage import ObjectStorage, get_storage

logger = logging.getLogger(__name__)
router = APIRouter()
Db = Annotated[AsyncSession, Depends(get_session)]
Storage = Annotated[ObjectStorage, Depends(get_storage)]


def get_agent_runtime(request: Request) -> AgentRuntime:
    runtime = getattr(request.app.state, "agent_runtime", None)
    if runtime is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Agent 模型尚未配置")
    return runtime


Runtime = Annotated[AgentRuntime, Depends(get_agent_runtime)]
conversation_service = ConversationService()
INLINE_ATTACHMENT_TYPES = ALLOWED_PHOTO_TYPES


def attachment_response_headers(attachment: Attachment) -> dict[str, str]:
    safe_filename = attachment.filename.replace("\r", "").replace("\n", "").replace('"', "'")
    inline = attachment.content_type.lower() in INLINE_ATTACHMENT_TYPES
    disposition = "inline" if inline else "attachment"
    return {
        "response-content-disposition": (f'{disposition}; filename="{safe_filename}"'),
        "response-content-type": (
            attachment.content_type if inline else "application/octet-stream"
        ),
        # 对象键不可变；private 禁止共享代理缓存两个人的私密附件。即使预签名 URL
        # 过期，已经通过鉴权下载到这台设备的副本仍可从浏览器缓存读取。
        "response-cache-control": "private, max-age=86400, immutable",
    }


async def attachment_response(
    attachment: Attachment,
) -> AttachmentRead:
    return AttachmentRead(
        id=attachment.id,
        created_at=attachment.created_at,
        owner_id=attachment.owner_id,
        bucket=attachment.bucket,
        object_key=attachment.object_key,
        version_id=attachment.version_id,
        filename=attachment.filename,
        content_type=attachment.content_type,
        size=attachment.size,
        sha256=attachment.sha256,
        status=attachment.status,
        parse_status=attachment.parse_status,
        parse_error=attachment.parse_error,
        parser=attachment.parser,
        artifact_kind=attachment.artifact_kind,
        artifact_version=attachment.artifact_version,
        parent_id=attachment.parent_id,
        download_url=f"/api/v1/attachments/{attachment.id}/content",
        thumbnail_url=(
            f"/api/v1/attachments/{attachment.id}/thumbnail" if attachment.thumbnail_key else None
        ),
        preview_url=(
            f"/api/v1/attachments/{attachment.id}/preview"
            if attachment.preview_key or attachment.content_type == "application/pdf"
            else None
        ),
    )


def crud_router(
    path: str,
    model: type,
    resource: str,
    create_schema: type,
    update_schema: type,
    read_schema: type,
) -> APIRouter:
    resource_router = APIRouter(prefix=f"/{path}", tags=[resource])
    service = CrudService(model, resource)

    @resource_router.get("", response_model=list[read_schema])
    async def list_entities(db: Db, _: CurrentUser):
        return await service.list(db, limit=500)

    @resource_router.post("", response_model=read_schema, status_code=status.HTTP_201_CREATED)
    async def create_entity(data: create_schema, db: Db, user: CurrentUser):
        return await service.create(db, data, created_by=user.id)

    @resource_router.get("/{entity_id}", response_model=read_schema)
    async def get_entity(entity_id: str, db: Db, _: CurrentUser):
        return await service.get(db, entity_id)

    @resource_router.patch("/{entity_id}", response_model=read_schema)
    async def update_entity(entity_id: str, data: update_schema, db: Db, _: CurrentUser):
        return await service.update(db, entity_id, data)

    @resource_router.delete("/{entity_id}", status_code=status.HTTP_204_NO_CONTENT)
    async def delete_entity(entity_id: str, db: Db, _: CurrentUser) -> Response:
        await service.delete(db, entity_id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    return resource_router


for args in [
    ("plans", Plan, "plan", PlanCreate, PlanUpdate, PlanRead),
    ("wishes", Wish, "wish", WishCreate, WishUpdate, WishRead),
    (
        "milestones",
        Milestone,
        "milestone",
        MilestoneCreate,
        MilestoneUpdate,
        MilestoneRead,
    ),
    ("messages", Message, "message", MessageCreate, MessageUpdate, MessageRead),
    ("timers", EventTimer, "timer", TimerCreate, TimerUpdate, TimerRead),
]:
    router.include_router(crud_router(*args))


@router.get("/photos", response_model=list[PhotoRead])
async def list_photos(db: Db, _: CurrentUser):
    return await PhotoService().list(db, limit=500)


@router.post("/photos", response_model=PhotoRead, status_code=status.HTTP_201_CREATED)
async def create_photo(data: PhotoCreate, db: Db, user: CurrentUser):
    return await PhotoService().create(db, user.id, data)


@router.patch("/photos/{photo_id}", response_model=PhotoRead)
async def update_photo(
    photo_id: str,
    data: PhotoUpdate,
    db: Db,
    _: CurrentUser,
):
    return await PhotoService().update(db, photo_id, data)


@router.delete("/photos/{photo_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_photo(photo_id: str, db: Db, _: CurrentUser):
    await PhotoService().delete(db, photo_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


PHOTO_THUMBNAIL_CACHE = "private, max-age=86400, immutable"


@router.get("/photos/{photo_id}/thumbnail")
async def photo_thumbnail(
    photo_id: str,
    request: Request,
    db: Db,
    storage: Storage,
    settings: Annotated[Settings, Depends(get_settings)],
    _: CurrentUser,
) -> Response:
    """返回稳定、可浏览器缓存的相册缩略图。

    只有几十 KB 的缩略图经 API 返回，换来稳定 URL、会话鉴权和真正可复用的
    私有缓存；点开后的 MB 级原图仍走预签名重定向，不占 API 带宽。
    """
    photo = await db.get(Photo, photo_id)
    if photo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "照片不存在")

    if photo.attachment_id:
        attachment = await db.get(Attachment, photo.attachment_id)
        if (
            attachment is None
            or attachment.derived_bucket is None
            or attachment.thumbnail_key is None
        ):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "缩略图不存在")
        bucket = attachment.derived_bucket
        object_key = attachment.thumbnail_key
    else:
        if not photo.legacy_url:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "缩略图不存在")
        bucket = settings.minio_derived_bucket
        object_key = legacy_photo_thumbnail_key(photo.id)

    try:
        payload = await storage.get_bytes(bucket, object_key)
    except Exception as error:
        logger.warning(
            "photo thumbnail unavailable photo_id=%s bucket=%s key=%s: %s",
            photo.id,
            bucket,
            object_key,
            error,
        )
        raise HTTPException(status.HTTP_404_NOT_FOUND, "缩略图不存在") from error

    etag = f'"{hashlib.sha256(payload).hexdigest()}"'
    headers = {"Cache-Control": PHOTO_THUMBNAIL_CACHE, "ETag": etag}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    return Response(content=payload, media_type="image/webp", headers=headers)


@router.post("/auth/login", response_model=LoginResponse)
async def login(
    data: LoginRequest,
    request: Request,
    response: Response,
    db: Db,
    settings: Annotated[Settings, Depends(get_settings)],
) -> LoginResponse:
    client_ip = request.client.host if request.client else "unknown"
    cutoff = utcnow() - timedelta(minutes=15)
    failures = (
        await db.scalar(
            select(func.count(AuthAttempt.id)).where(
                AuthAttempt.success.is_(False),
                AuthAttempt.created_at >= cutoff,
                or_(
                    AuthAttempt.ip == client_ip,
                    AuthAttempt.username == data.username,
                ),
            )
        )
    ) or 0
    if failures >= 10:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "登录尝试过多，请稍后再试")
    user = await db.scalar(select(User).where(User.username == data.username))
    password_valid = verify_password(
        data.password,
        user.password_hash if user is not None else DUMMY_PASSWORD_HASH,
    )
    valid = user is not None and user.enabled and password_valid
    db.add(
        AuthAttempt(
            ip=client_ip,
            username=data.username,
            success=valid,
        )
    )
    if not valid:
        await db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "用户名或密码错误")
    record, token = await create_session(db, user, data.device_name, settings)
    await db.commit()
    if data.client in {"browser", "desktop"}:
        set_session_cookie(response, token, settings)
    return LoginResponse(
        user=SessionUser.model_validate(user),
        token=token if data.client in {"device", "desktop"} else None,
        expires_at=record.expires_at,
    )


@router.get("/auth/me", response_model=SessionUser)
async def me(user: CurrentUser) -> User:
    return user


@router.get("/auth/sessions", response_model=list[SessionRead])
async def list_sessions(
    current_session: CurrentSession,
    db: Db,
) -> list[SessionRead]:
    sessions = list(
        await db.scalars(
            select(UserSession)
            .where(
                UserSession.user_id == current_session.user_id,
                UserSession.revoked_at.is_(None),
                UserSession.expires_at > utcnow(),
            )
            .order_by(UserSession.last_seen_at.desc())
            .limit(50)
        )
    )
    return [
        SessionRead(
            id=item.id,
            device_name=item.device_name,
            created_at=item.created_at,
            last_seen_at=item.last_seen_at,
            expires_at=item.expires_at,
            current=item.id == current_session.id,
        )
        for item in sessions
    ]


@router.delete("/auth/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_session(
    session_id: str,
    current_session: CurrentSession,
    db: Db,
    response: Response,
) -> Response:
    target = await db.get(UserSession, session_id)
    if target is None or target.user_id != current_session.user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "会话不存在")
    target.revoked_at = utcnow()
    await db.commit()
    if target.id == current_session.id:
        response.delete_cookie(SESSION_COOKIE_NAME, path="/")
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    current_session: CurrentSession,
    response: Response,
    db: Db,
    settings: Annotated[Settings, Depends(get_settings)],
) -> Response:
    current_session.revoked_at = utcnow()
    await db.commit()
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get("/config", response_model=dict[str, str])
async def read_config(db: Db, _: CurrentUser) -> dict[str, str]:
    """完整配置——**默认值也在里面**，前端不需要自己兜底。

    以前这里只返回存过的行，于是「在一起的起始日」这种从没被改过的项返回空，
    前端只好各自写一个 `|| '2025-11-30'`。同一个默认值散在两个前端文件里，
    服务端一无所知，宠物也就答不出「我们在一起多久了」。见 site_config 模块。
    """
    return await load_site_config(db)


EDITABLE_CONFIG_KEYS = EDITABLE_SITE_CONFIG_KEYS


@router.put("/config", response_model=dict[str, str])
async def update_config(
    values: dict[str, str],
    db: Db,
    _: CurrentUser,
) -> dict[str, str]:
    unknown = set(values) - EDITABLE_CONFIG_KEYS
    if unknown:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"不支持的配置项：{', '.join(sorted(unknown))}",
        )
    for key, value in values.items():
        if not isinstance(value, str) or len(value) > 100_000:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"配置项 {key} 无效")
        current = await db.get(SiteConfig, key)
        if current is None:
            db.add(SiteConfig(key=key, value=value))
        else:
            current.value = value
        db.add(SiteConfigHistory(key=key, value=value))
    await db.commit()
    return values


@router.post("/config/reset", status_code=status.HTTP_204_NO_CONTENT)
async def reset_config(
    keys: list[str],
    db: Db,
    _: CurrentUser,
) -> Response:
    if not keys or set(keys) - EDITABLE_CONFIG_KEYS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "配置项无效")
    await db.execute(delete(SiteConfig).where(SiteConfig.key.in_(keys)))
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/config/history")
async def read_config_history(db: Db, _: CurrentUser) -> list[dict[str, str]]:
    rows = list(
        await db.scalars(
            select(SiteConfigHistory)
            .where(SiteConfigHistory.key.in_(EDITABLE_CONFIG_KEYS))
            .order_by(SiteConfigHistory.created_at.desc())
            .limit(100)
        )
    )
    return [
        {
            "id": row.id,
            "key": row.key,
            "value": row.value,
            "createdAt": row.created_at.isoformat(),
        }
        for row in rows
    ]


@router.post("/config/history/{history_id}/rollback", response_model=dict[str, str])
async def rollback_config(
    history_id: str,
    db: Db,
    _: CurrentUser,
) -> dict[str, str]:
    history = await db.get(SiteConfigHistory, history_id)
    if history is None or history.key not in EDITABLE_CONFIG_KEYS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "配置历史不存在")
    current = await db.get(SiteConfig, history.key)
    if current is None:
        db.add(SiteConfig(key=history.key, value=history.value))
    else:
        current.value = history.value
    db.add(SiteConfigHistory(key=history.key, value=history.value))
    await db.commit()
    return {history.key: history.value}


@router.get("/conversations", response_model=list[ConversationRead])
async def list_conversations(db: Db, user: CurrentUser):
    """对话列表，带首条用户发言的预览。

    预览用一条聚合查询取回，不是逐个对话再查一次——列表页最多 200 条，
    N+1 会让打开对话本变成几百次往返。
    """
    conversations = await conversation_service.list(db, user.id, limit=200)
    if not conversations:
        return []
    ids = [item.id for item in conversations]

    # 每个对话里 createdAt 最早的那条用户发言。
    first_user = (
        select(
            ChatMessage.conversation_id.label("cid"),
            func.min(ChatMessage.created_at).label("first_at"),
        )
        .where(
            ChatMessage.conversation_id.in_(ids),
            ChatMessage.role == "user",
        )
        .group_by(ChatMessage.conversation_id)
        .subquery()
    )
    previews = {
        row.cid: row.content
        for row in await db.execute(
            select(ChatMessage.conversation_id.label("cid"), ChatMessage.content)
            .join(
                first_user,
                (ChatMessage.conversation_id == first_user.c.cid)
                & (ChatMessage.created_at == first_user.c.first_at),
            )
            .where(ChatMessage.role == "user")
        )
    }
    counts = {
        row.cid: row.total
        for row in await db.execute(
            select(
                ChatMessage.conversation_id.label("cid"),
                func.count(ChatMessage.id).label("total"),
            )
            .where(ChatMessage.conversation_id.in_(ids))
            .group_by(ChatMessage.conversation_id)
        )
    }
    return [
        ConversationRead.model_validate(item).model_copy(
            update={
                "preview": (previews.get(item.id) or "").strip()[:80] or None,
                "message_count": counts.get(item.id, 0),
            }
        )
        for item in conversations
    ]


@router.post(
    "/conversations",
    response_model=ConversationRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_conversation(data: ConversationCreate, db: Db, user: CurrentUser):
    try:
        return await conversation_service.create(
            db,
            user.id,
            data.companion_id,
            data.title,
        )
    except ValueError as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(error)) from error


@router.get(
    "/conversations/{conversation_id}/messages",
    response_model=list[ChatMessageRead],
)
async def conversation_messages(conversation_id: str, db: Db, user: CurrentUser):
    try:
        return await conversation_service.messages(
            db,
            user.id,
            conversation_id,
            limit=500,
        )
    except LookupError as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(error)) from error


@router.post("/chat/stream")
async def chat_stream(
    data: ChatStreamRequest,
    db: Db,
    user: CurrentUser,
    runtime: Runtime,
) -> StreamingResponse:
    if data.conversation_id:
        try:
            await conversation_service.get(db, user.id, data.conversation_id)
        except LookupError as error:
            raise HTTPException(status.HTTP_404_NOT_FOUND, str(error)) from error
    if data.attachment_ids:
        attachment_ids = set(data.attachment_ids)
        found = set(
            await db.scalars(
                select(Attachment.id).where(
                    Attachment.id.in_(attachment_ids),
                    Attachment.owner_id == user.id,
                    Attachment.status == "ready",
                )
            )
        )
        if found != attachment_ids:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "附件不存在或不属于当前用户")
    # Streaming must not pin the authentication transaction/connection.
    await db.commit()
    await db.close()
    return StreamingResponse(
        runtime.stream(
            user.id,
            data.message,
            data.conversation_id,
            data.attachment_ids,
        ),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


@router.get("/profile", response_model=ProfileRead)
async def get_profile(db: Db, user: CurrentUser):
    return await conversation_service.get_or_create_profile(db, user.id)


@router.patch("/profile", response_model=ProfileRead)
async def update_profile(data: ProfileUpdate, db: Db, user: CurrentUser):
    profile = await conversation_service.get_or_create_profile(db, user.id)
    profile.profile = data.profile
    await db.commit()
    await db.refresh(profile)
    return profile


@router.get("/persona", response_model=PersonaRead)
async def get_persona(db: Db, user: CurrentUser):
    _, persona = await conversation_service.ensure_companion(db, user.id)
    return persona


@router.patch("/persona", response_model=PersonaRead)
async def update_persona(data: PersonaUpdate, db: Db, user: CurrentUser):
    companion, current = await conversation_service.ensure_companion(db, user.id)
    persona = CompanionPersona(
        companion_id=companion.id,
        name=data.name or current.name,
        prompt=data.prompt or current.prompt,
        version=current.version + 1,
    )
    db.add(persona)
    await db.flush()
    companion.active_persona_id = persona.id
    await db.commit()
    await db.refresh(persona)
    return persona


def get_memory_service() -> MemoryService:
    settings = get_settings()
    provider = (
        OpenAICompatibleEmbeddingProvider(settings)
        if settings.embedding_api_key
        else UnavailableEmbeddingProvider(settings.embedding_dimensions)
    )
    return MemoryService(provider)


MemoryRuntime = Annotated[MemoryService, Depends(get_memory_service)]


@router.get("/memories", response_model=list[MemoryRead])
async def list_memories(
    db: Db,
    user: CurrentUser,
    memory: MemoryRuntime,
    companion_id: str | None = None,
    visibility: str | None = None,
    memory_type: str | None = None,
    status_filter: str = Query(default="active", alias="status"),
    q: str = "",
):
    items = await memory.list(
        db,
        user.id,
        companion_id,
        visibility=visibility,
        status=status_filter,
    )
    if memory_type:
        items = [item for item in items if item.memory_type == memory_type]
    if q:
        normalized = q.casefold()
        items = [item for item in items if normalized in item.content.casefold()]
    return items


@router.post(
    "/memories/explicit",
    response_model=MemoryMutationRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_explicit_memory(
    data: MemoryCreate,
    db: Db,
    user: CurrentUser,
    memory: MemoryRuntime,
):
    try:
        item, receipt = await memory.create_with_receipt(db, user.id, data)
        return {"memory": item, "receipt": receipt}
    except ValueError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(error)) from error


@router.post("/memories/{memory_id}/correct", response_model=MemoryMutationRead)
async def correct_memory(
    memory_id: str,
    data: MemoryCorrect,
    db: Db,
    user: CurrentUser,
    memory: MemoryRuntime,
):
    try:
        item, receipt = await memory.correct(db, user.id, memory_id, data)
        return {"memory": item, "receipt": receipt}
    except LookupError as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(error)) from error
    except ValueError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(error)) from error


@router.post("/memories/{memory_id}/retract", response_model=MemoryMutationRead)
async def retract_memory(
    memory_id: str,
    db: Db,
    user: CurrentUser,
    memory: MemoryRuntime,
):
    try:
        item, receipt = await memory.retract(db, user.id, memory_id)
        return {"memory": item, "receipt": receipt}
    except LookupError as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(error)) from error


@router.post("/memories/{memory_id}/restore", response_model=MemoryMutationRead)
async def restore_memory(
    memory_id: str,
    db: Db,
    user: CurrentUser,
    memory: MemoryRuntime,
):
    try:
        item, receipt = await memory.restore(db, user.id, memory_id)
        return {"memory": item, "receipt": receipt}
    except LookupError as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(error)) from error
    except ValueError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(error)) from error


@router.post("/memories/{memory_id}/approve", response_model=MemoryMutationRead)
async def approve_memory(
    memory_id: str,
    db: Db,
    user: CurrentUser,
    memory: MemoryRuntime,
):
    try:
        item, receipt = await memory.approve(db, user.id, memory_id)
        return {"memory": item, "receipt": receipt}
    except LookupError as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(error)) from error
    except ValueError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(error)) from error


@router.get("/memories/{memory_id}/evidence", response_model=list[MemoryEvidenceRead])
async def memory_evidence(
    memory_id: str,
    db: Db,
    user: CurrentUser,
    memory: MemoryRuntime,
):
    try:
        return await memory.evidence(db, user.id, memory_id)
    except LookupError as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(error)) from error


@router.get("/memories/{memory_id}/history", response_model=list[MemoryRevisionRead])
async def memory_history(
    memory_id: str,
    db: Db,
    user: CurrentUser,
    memory: MemoryRuntime,
):
    try:
        return await memory.history(db, user.id, memory_id)
    except LookupError as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(error)) from error


@router.post(
    "/memories/{memory_id}/evidence/{evidence_id}/exclude",
    response_model=MemoryMutationRead,
)
async def exclude_memory_evidence(
    memory_id: str,
    evidence_id: str,
    db: Db,
    user: CurrentUser,
    memory: MemoryRuntime,
):
    try:
        item, receipt = await memory.exclude_evidence(db, user.id, memory_id, evidence_id)
        return {"memory": item, "receipt": receipt}
    except LookupError as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(error)) from error


@router.get("/memory-preferences", response_model=MemoryPreferenceRead)
async def get_memory_preferences(
    db: Db,
    user: CurrentUser,
    memory: MemoryRuntime,
):
    item = await memory.preference(db, user.id)
    policy = await runtime_config.load_all(db)
    return {
        **MemoryPreferenceRead.model_validate(
            {
                "paused": item.paused,
                "reference_enabled": item.reference_enabled,
                "conversation_enabled": item.conversation_enabled,
                "direct_message_enabled": item.direct_message_enabled,
                "mood_enabled": item.mood_enabled,
                "daily_question_enabled": item.daily_question_enabled,
                "future_letter_enabled": item.future_letter_enabled,
                "reference_available": policy["memory.reference_enabled"],
                "private_extraction_available": policy["memory.private_extraction_enabled"],
                "shared_extraction_available": policy["memory.shared_extraction_enabled"],
            }
        ).model_dump(),
    }


@router.patch("/memory-preferences", response_model=MemoryPreferenceRead)
async def update_memory_preferences(
    data: MemoryPreferenceUpdate,
    db: Db,
    user: CurrentUser,
    memory: MemoryRuntime,
):
    item = await memory.preference(db, user.id)
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    await db.commit()
    await db.refresh(item)
    policy = await runtime_config.load_all(db)
    return {
        "paused": item.paused,
        "reference_enabled": item.reference_enabled,
        "conversation_enabled": item.conversation_enabled,
        "direct_message_enabled": item.direct_message_enabled,
        "mood_enabled": item.mood_enabled,
        "daily_question_enabled": item.daily_question_enabled,
        "future_letter_enabled": item.future_letter_enabled,
        "reference_available": policy["memory.reference_enabled"],
        "private_extraction_available": policy["memory.private_extraction_enabled"],
        "shared_extraction_available": policy["memory.shared_extraction_enabled"],
    }


@router.get("/actions/{receipt_id}")
async def get_action_receipt(receipt_id: str, db: Db, user: CurrentUser):
    receipt = await db.get(ActionReceipt, receipt_id)
    if receipt is None or receipt.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "操作回执不存在")
    return receipt


@router.put("/perception/session", response_model=PerceptionSessionRead)
async def write_perception_session(
    data: PerceptionSessionWrite,
    db: Db,
    user: CurrentUser,
):
    return await upsert_session(db, user.id, data)


@router.get("/perception/session/current", response_model=PerceptionSessionRead | None)
async def read_current_perception_session(db: Db, user: CurrentUser):
    return await current_session(db, user.id)


@router.post(
    "/perception/events",
    response_model=PerceptionEventRead,
    status_code=status.HTTP_201_CREATED,
)
async def write_perception_event(
    data: PerceptionEventWrite,
    db: Db,
    user: CurrentUser,
):
    try:
        return await record_perception_event(db, user.id, data)
    except ValueError as error:
        raise HTTPException(status.HTTP_409_CONFLICT, str(error)) from error


def pet_view(companion: Companion, profile: CompanionPetProfile) -> dict[str, Any]:
    """把 Companion + Profile 投影成前端既有的 `/pet` 形状。

    对外契约没变，变的是背后的真相来源：名字来自 Companion，外观来自
    Profile，不再有全站单例。`id` 用 companionId——行为脑拿它当性格种子，
    换成每用户之后两个人的宠物才会有不同的脾气。
    """
    return {
        "id": companion.id,
        "createdAt": companion.created_at,
        "name": companion.name,
        "assetId": profile.body_asset_id,
        "updatedAt": profile.updated_at,
    }


@router.get("/pet", response_model=PetRead)
async def read_pet(db: Db, user: CurrentUser):
    companion, profile = await resolve_pet(db, user.id)
    await db.commit()
    return pet_view(companion, profile)


@router.patch("/pet", response_model=PetRead)
async def update_pet(data: PetUpdate, db: Db, user: CurrentUser):
    companion, profile = await resolve_pet(db, user.id)
    changes = data.model_dump(exclude_unset=True)
    if "name" in changes and changes["name"]:
        companion.name = changes["name"]
    if "asset_id" in changes and changes["asset_id"]:
        profile.body_asset_id = changes["asset_id"]
        profile.species = species_of(changes["asset_id"])
    profile.updated_at = utcnow()

    # **改完要广播。** 同一个人可能同时开着网页、Tauri 主窗口和桌宠窗口，
    # 每个表面各有一份 usePet 的本地状态和一份模块级缓存；不发这条事件的话，
    # 只有动手改的那个窗口会变，其余的要重启才更新——用户看到的就是
    # 「我明明改了名字，桌宠还叫原来那个」。
    #
    # 不带正文，只带 id：SSE 是广播给所有连接的，收到的人自己去拉。
    db.add(
        OutboxEvent(
            topic="resource.changed",
            aggregate_type="pet",
            aggregate_id=companion.id,
            payload={"resource": "pet", "action": "updated", "id": companion.id},
        )
    )
    await db.commit()
    return pet_view(companion, profile)


@router.get("/pet/state", response_model=PetStateRead)
async def read_pet_state(db: Db, user: CurrentUser):
    """返回上次落盘的快照，外加**已夹到上限**的离线时长。

    衰减本身由客户端 `settleElapsed` 用这个时长推进——见 pet_state 模块开头
    对分工的说明。没有快照时 elapsedSeconds 为 0，客户端按初始值起步。
    """
    companion, profile = await resolve_pet(db, user.id)
    state = await load_state(db, companion)
    await db.commit()
    if state is None:
        return {
            "companionId": companion.id,
            "traits": profile.traits,
            "needs": None,
            "mood": None,
            "relationship": None,
            "activeGoal": "idle",
            "elapsedSeconds": 0.0,
            "cappedAt": MAX_OFFLINE_SECONDS,
        }
    return {
        "companionId": companion.id,
        "traits": profile.traits,
        "needs": state.needs,
        "mood": state.mood,
        "relationship": state.relationship,
        "activeGoal": state.active_goal,
        "elapsedSeconds": elapsed_seconds(state.evaluated_at),
        "cappedAt": MAX_OFFLINE_SECONDS,
    }


@router.put("/pet/state", response_model=PetStateRead)
async def write_pet_state(data: PetStateWrite, db: Db, user: CurrentUser):
    companion, profile = await resolve_pet(db, user.id)
    await save_state(
        db,
        companion,
        needs=data.needs,
        mood=data.mood,
        relationship=data.relationship,
        active_goal=data.active_goal,
    )
    # 性格由客户端从 petId 确定性派生，落库只是为了让 P4 的 Cognition Agent
    # 不必重算一遍 FNV-1a。它不参与判断，因此不做校验。
    if data.traits:
        profile.traits = data.traits
    await db.commit()
    return {
        "companionId": companion.id,
        "traits": profile.traits,
        "needs": data.needs,
        "mood": data.mood,
        "relationship": data.relationship,
        "activeGoal": data.active_goal,
        "elapsedSeconds": 0.0,
        "cappedAt": MAX_OFFLINE_SECONDS,
    }


def get_cognition_service(request: Request) -> PetCognitionService:
    service = getattr(request.app.state, "cognition_service", None)
    if service is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Agent 模型尚未配置")
    return service


@router.post("/pet/cognition", response_model=PetCognitionRead | None)
async def run_pet_cognition(
    data: PetCognitionRequest,
    db: Db,
    user: CurrentUser,
    runtime: Runtime,
    service: Annotated[PetCognitionService, Depends(get_cognition_service)],
    response: Response,
):
    """让宠物想一件事。

    绝大多数情况下这里返回 204——被禁用触发源、预算、防抖或去重挡下来了。
    这是设计意图，不是故障：连续移动鼠标五分钟，模型调用次数必须是 0
    （架构文档 §16）。校验不过的模型输出同样返回 204，宠物继续按本地行为脑生活。
    """
    companion, _ = await resolve_pet(db, user.id)
    # 对方今天的心情。拿不到「对方」时不算错误——单人环境下宠物照常思考，
    # 只是少一项输入，不该因为没配第二个账号就让整条认知链路失败。
    try:
        partner = await resolve_partner(db, user.id)
        partner_mood = await mood_of_partner(db, partner.id)
    except PartnerUnavailable:
        partner_mood = None
    try:
        assembled = await runtime.context_assembler.assemble(
            db,
            user.id,
            companion.id,
            query="\n".join(
                part
                for part in (
                    data.page,
                    data.active_task or "",
                    " ".join(data.recent_interactions[-5:]),
                )
                if part
            )
            or "当前状态",
            role="cognition",
            limit=6,
        )
        await db.commit()
    except Exception:
        logger.info("Cognition 上下文组装失败，降级为空记忆", exc_info=True)
        assembled = None
    proposal, rejection = await service.think(
        db,
        companion,
        CognitionType(data.type),
        CognitionInput(
            needs=data.needs,
            mood=data.mood,
            relationship=data.relationship,
            page=(assembled.page if assembled and assembled.page else data.page),
            local_time=data.local_time,
            recent_interactions=(
                list(
                    dict.fromkeys(
                        [
                            *data.recent_interactions,
                            *(assembled.recent_interactions if assembled else []),
                        ]
                    )
                )[-8:]
            ),
            memories=([item.content for item in assembled.memories] if assembled else []),
            active_task=(assembled.active_task if assembled else None) or data.active_task,
            proactive_budget_left=daily_proactive_budget(),
            partner_mood=partner_mood,
            # 近期纪念日。查一次表就有，宠物却因此能在纪念日前一周说人话，
            # 而不是只会「你很久没理我了」。
            upcoming_anniversaries=[
                f"还有 {item['daysLeft']} 天：{item['title']}"
                if item["daysLeft"] > 0
                else f"今天：{item['title']}"
                for item in upcoming_anniversaries(
                    list(await db.scalars(select(EventTimer))),
                    local_today(),
                )
            ],
        ),
        trigger=data.trigger,
        quiet_mode=data.initiative == "quiet",
        initiative_off=data.initiative == "off",
    )
    if proposal is None:
        response.status_code = status.HTTP_204_NO_CONTENT
        if rejection is not None:
            response.headers["X-Cognition-Rejected"] = rejection.value
        return None
    return proposal


@router.post(
    "/pet/events",
    response_model=None,
    status_code=status.HTTP_204_NO_CONTENT,
)
async def record_pet_event(
    data: PetEventWrite,
    db: Db,
    user: CurrentUser,
    request: Request,
) -> Response:
    companion, _ = await resolve_pet(db, user.id)
    await record_event(
        db,
        companion.id,
        data.type,
        data.payload,
        importance=data.importance,
    )
    await db.commit()

    # 按量触发反思：攒够一批才想，孤立的一两件事提炼不出关系层面的东西。
    # 队列锁按 companionId，已经排着的不会重复排；另有每日兜底扫描兜住
    # 那些永远攒不满一批的不活跃用户。
    queue = getattr(request.app.state, "job_queue", None)
    if queue is not None and await pending_count(db, companion.id) >= (REFLECTION_BATCH_TRIGGER):
        try:
            await queue.enqueue(
                "pet.reflect",
                {"companion_id": companion.id},
                idempotency_key=companion.id,
            )
        except Exception:
            # 上报事件不能因为队列不可用而失败——事件已经落库，兜底扫描会捡起来。
            pass
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/chat/thread", response_model=ChatThreadRead)
async def read_chat_thread(db: Db, user: CurrentUser):
    """聊天页一次拉全。

    刻意不做分页：这个站只有两个人，几百条消息一次拉回来比维护游标划算得多。
    """
    try:
        partner = await resolve_partner(db, user.id)
    except PartnerUnavailable as error:
        raise HTTPException(status.HTTP_409_CONFLICT, str(error)) from error
    messages = await list_thread(db, user.id, partner.id)
    interjections = await list_interjections(db, user.id)

    # 把每条插话的说话者补成名字和外观。
    #
    # **不能让前端拿自己那只顶上。** 两个人各有一只宠物，前端只知道自己那只；
    # 靠本地猜的结果就是同一条插话在两边挂着不同的名字——@ 饼干得到的回答，
    # 在对方屏幕上署着对方宠物的名。
    speaker_ids = {item.companion_id for item in interjections if item.companion_id}
    speakers: dict[str, tuple[str, str]] = {}
    if speaker_ids:
        rows = await db.execute(
            select(Companion.id, Companion.name, CompanionPetProfile.body_asset_id)
            .join(
                CompanionPetProfile,
                CompanionPetProfile.companion_id == Companion.id,
                isouter=True,
            )
            .where(Companion.id.in_(speaker_ids))
        )
        speakers = {row[0]: (row[1], row[2] or DEFAULT_ASSET) for row in rows}

    payload = []
    for item in interjections:
        speaker = speakers.get(item.companion_id) if item.companion_id else None
        payload.append(
            {
                "id": item.id,
                "createdAt": item.created_at,
                "kind": item.kind,
                "body": item.body,
                "messageId": item.message_id,
                "speakerName": speaker[0] if speaker else None,
                "speakerAssetId": speaker[1] if speaker else None,
            }
        )

    # 对方那只宠物的名字：前端要用它判断「这条消息是不是在叫对方的宠物」。
    partner_companion, _ = await resolve_pet(db, partner.id)
    return {
        "partner": {
            "id": partner.id,
            "username": partner.username,
            "displayName": partner.display_name,
            "petName": partner_companion.name,
        },
        "messages": messages,
        "interjections": payload,
        "unreadCount": await unread_count(db, user.id),
    }


@router.post(
    "/chat/messages",
    response_model=DirectMessageRead,
    status_code=status.HTTP_201_CREATED,
)
async def send_direct_message(
    data: DirectMessageCreate,
    db: Db,
    user: CurrentUser,
    request: Request,
):
    if not data.body.strip() and not data.attachment_ids:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "说点什么或者带个附件")
    try:
        partner = await resolve_partner(db, user.id)
        attachments = await verify_attachments(db, user.id, data.attachment_ids)
    except PartnerUnavailable as error:
        raise HTTPException(status.HTTP_409_CONFLICT, str(error)) from error

    message = await send_message(db, user.id, partner.id, data.body, attachments)

    # @ 了宠物就让它就着最近的对话答一句。**只排队，不在这里等**：模型要十几秒，
    # 而这段时间是卡在发消息这个请求里的——用户敲完回车，自己的话要等宠物想完
    # 才出现在屏幕上。答案回来后由 chat.assist 任务写成插话并发 SSE 通知两边。
    #
    # 整段包在 try 里：叫一次没答上来是小事，它导致消息发不出去是大事。
    try:
        companion, _ = await resolve_pet(db, user.id)
        queue = getattr(request.app.state, "job_queue", None)
        if queue is not None and mentions_pet(data.body, companion.name):
            await queue.enqueue(
                "chat.assist",
                {
                    "user_id": user.id,
                    "partner_id": partner.id,
                    "message_id": message.id,
                    "pet_name": companion.name,
                    "body": data.body,
                },
                # 按消息去重：同一条消息重复投递（重试、双击）只答一次。
                idempotency_key=message.id,
            )
    except Exception:
        logger.exception("宠物应答没能排上队，消息照常发出")

    # 走既有的 SSE 通道通知对方。人不在站上时收不到——那是已知边界，
    # 真正的推送需要 Web Push，不在本次范围（计划文档 §3.6）。
    db.add(
        OutboxEvent(
            topic="chat.message",
            aggregate_type="directMessage",
            aggregate_id=message.id,
            payload={
                "messageId": message.id,
                "senderId": user.id,
                "recipientId": partner.id,
                # 不带正文：SSE 是广播给所有连接的，正文只该由收件人自己去拉
                "hasAttachments": bool(attachments),
            },
        )
    )
    await db.commit()
    await db.refresh(message)
    try:
        queue = getattr(request.app.state, "job_queue", None)
        if queue is not None:
            await queue.enqueue(
                "memory.extract.direct",
                {"message_id": message.id},
                idempotency_key=message.id,
            )
    except Exception:
        logger.exception("私聊记忆提取没能排上队，消息照常发出")
    return message


@router.post("/chat/read", response_model=None, status_code=status.HTTP_204_NO_CONTENT)
async def mark_chat_read(db: Db, user: CurrentUser) -> Response:
    """把发给我的未读全标为已读。

    宠物的唠叨与代答全都以 `readAt` 为唯一依据，所以这个接口一被调用，
    唠叨就该立刻停——这是「打开了就安静」那条行为的实现点。
    """
    marked = await mark_read(db, user.id)
    if marked:
        await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/chat/mediate", response_model=list[PetInterjectionRead])
async def run_chat_mediation(
    db: Db,
    user: CurrentUser,
    initiative: str = "normal",
):
    """跑一轮宠物中介：未读够久就催，对方还在等就代答。

    由前端在聊天页与浮窗里定时调用。**这不是一个新的通知渠道**——所有输出都
    落 `PetInterjection`，并受深夜静默与 initiative 三档约束（计划文档 §3.4）。
    """
    try:
        partner = await resolve_partner(db, user.id)
    except PartnerUnavailable as error:
        raise HTTPException(status.HTTP_409_CONFLICT, str(error)) from error
    unread = await oldest_unread(db, user.id)
    return await run_mediation(
        db,
        user.id,
        partner.id,
        unread,
        initiative=initiative if initiative in {"normal", "quiet", "off"} else "normal",
    )


@router.get("/daily-question/today", response_model=DailyQuestionStateRead)
async def read_daily_question(db: Db, user: CurrentUser):
    """今天的题 + 我和对方的作答状态。

    `partnerAnswer` 在两人都答完之前恒为 null——揭晓逻辑在服务层做，不能只在
    前端藏，那等于没锁（计划文档 §2.1 / §2.6 同一原则）。
    """
    try:
        partner = await resolve_partner(db, user.id)
    except PartnerUnavailable as error:
        raise HTTPException(status.HTTP_409_CONFLICT, str(error)) from error

    question = await ensure_today(db)
    await db.commit()
    await db.refresh(question)

    mine = await get_answer(db, question.id, user.id)
    theirs = await get_answer(db, question.id, partner.id)
    both = await both_answered(db, question.id)
    return {
        "question": question,
        "partner": partner,
        "myAnswer": mine,
        "partnerAnswered": theirs is not None,
        "partnerAnswer": theirs if both else None,
    }


@router.post("/daily-question/answer", response_model=DailyQuestionStateRead)
async def answer_daily_question(
    data: DailyAnswerCreate, db: Db, user: CurrentUser, request: Request
):
    try:
        partner = await resolve_partner(db, user.id)
    except PartnerUnavailable as error:
        raise HTTPException(status.HTTP_409_CONFLICT, str(error)) from error

    question = await ensure_today(db)
    _, just_completed = await submit_answer(db, question.id, user.id, data.body.strip())

    if just_completed:
        # 两人都答完：给两边各自的宠物都写一条，各自的 Reflection Agent
        # 才都能消费到——这是每日一问和宠物咬合的地方（计划文档 §2.1）。
        me_companion, _ = await resolve_pet(db, user.id)
        partner_companion, _ = await resolve_pet(db, partner.id)
        payload = {"questionId": question.id, "prompt": question.prompt}
        await record_event(db, me_companion.id, "dailyQuestion.completed", payload, importance=65)
        await record_event(
            db, partner_companion.id, "dailyQuestion.completed", payload, importance=65
        )
        await db.commit()

        # 按量触发反思，与 /pet/events 同一条规则（攒够一批才想）。
        queue = getattr(request.app.state, "job_queue", None)
        if queue is not None:
            for companion_id in {me_companion.id, partner_companion.id}:
                if await pending_count(db, companion_id) >= REFLECTION_BATCH_TRIGGER:
                    try:
                        await queue.enqueue(
                            "pet.reflect",
                            {"companion_id": companion_id},
                            idempotency_key=companion_id,
                        )
                    except Exception:
                        pass
    await db.commit()
    await db.refresh(question)

    mine = await get_answer(db, question.id, user.id)
    theirs = await get_answer(db, question.id, partner.id)
    both = await both_answered(db, question.id)
    return {
        "question": question,
        "partner": partner,
        "myAnswer": mine,
        "partnerAnswered": theirs is not None,
        "partnerAnswer": theirs if both else None,
    }


@router.get("/moods", response_model=MoodBoardRead)
async def read_mood_board(db: Db, user: CurrentUser):
    """两个人的心情曲线。画在一起才有意义，所以一次把两边都返回。"""
    try:
        partner = await resolve_partner(db, user.id)
    except PartnerUnavailable as error:
        raise HTTPException(status.HTTP_409_CONFLICT, str(error)) from error
    return {
        "partner": partner,
        "mine": await mood_history(db, user.id),
        "theirs": await mood_history(db, partner.id),
    }


@router.put("/moods", response_model=MoodBoardRead)
async def write_mood(data: MoodWrite, db: Db, user: CurrentUser):
    """打卡。一人一天一条，同一天再打是更新——心情会变，下午改一次很正常。"""
    try:
        partner = await resolve_partner(db, user.id)
    except PartnerUnavailable as error:
        raise HTTPException(status.HTTP_409_CONFLICT, str(error)) from error
    await upsert_mood(db, user.id, data.mood, data.note, data.date)
    await db.commit()
    return {
        "partner": partner,
        "mine": await mood_history(db, user.id),
        "theirs": await mood_history(db, partner.id),
    }


@router.get("/letters", response_model=list[FutureLetterRead])
async def read_letters(db: Db, _: CurrentUser):
    """信箱。**锁着的信不带正文**——`redact` 在服务端就把它摘掉了。

    列表不按作者过滤：这是两个人共同的信箱，知道「有一封在等着」正是这个功能
    好玩的地方；至于里面写了什么，到点才看得到（计划文档 §2.6）。
    """
    return [redact(letter) for letter in await list_letters(db)]


@router.post(
    "/letters",
    response_model=FutureLetterRead,
    status_code=status.HTTP_201_CREATED,
)
async def write_letter(data: FutureLetterCreate, db: Db, user: CurrentUser):
    if data.unlock_at <= utcnow():
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "解锁时间要在将来——写给未来的信才有意义。",
        )
    try:
        attachments = await verify_attachments(db, user.id, data.attachment_ids)
    except PartnerUnavailable as error:
        raise HTTPException(status.HTTP_409_CONFLICT, str(error)) from error
    letter = await create_letter(db, user.id, data.body.strip(), attachments, data.unlock_at)
    await db.commit()
    await db.refresh(letter)
    # 刚写完必然是锁着的，所以这里返回的也没有正文——接口行为保持一致。
    return redact(letter)


@router.get("/letters/{letter_id}", response_model=FutureLetterRead)
async def read_letter(letter_id: str, db: Db, _: CurrentUser):
    letter = await open_letter(db, letter_id)
    if letter is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "没有这封信")
    await db.commit()
    await db.refresh(letter)
    return redact(letter)


@router.post("/pet/actions/{action}", response_model=PetActionRead)
async def run_pet_action(
    action: str,
    db: Db,
    user: CurrentUser,
    animation: str | None = None,
    message: str | None = None,
    duration: int = 1800,
):
    companion, profile = await resolve_pet(db, user.id)
    payload = {
        "action": action,
        "animation": animation or action,
        "assetId": profile.body_asset_id,
        "message": message,
        "duration": max(100, min(duration, 60_000)),
    }
    db.add(
        OutboxEvent(
            topic="pet.action",
            aggregate_type="pet",
            aggregate_id=companion.id,
            payload=payload,
        )
    )
    await db.commit()
    return payload


@router.post("/attachments/presign", response_model=PresignUploadResponse)
async def presign_upload(
    data: PresignUploadRequest,
    user: CurrentUser,
    storage: Storage,
    settings: Annotated[Settings, Depends(get_settings)],
) -> PresignUploadResponse:
    if data.size > settings.max_upload_bytes:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "文件超过上传大小限制")
    object_key = storage.build_object_key(user.id, data.filename)
    upload_url = await storage.presign_put(settings.minio_user_bucket, object_key)
    return PresignUploadResponse(
        bucket=settings.minio_user_bucket,
        object_key=object_key,
        upload_url=upload_url,
        expires_in=settings.minio_presign_seconds,
    )


@router.post(
    "/attachments/complete",
    response_model=AttachmentRead,
    status_code=status.HTTP_201_CREATED,
)
async def complete_upload(
    data: CompleteUploadRequest,
    request: Request,
    user: CurrentUser,
    db: Db,
    storage: Storage,
    settings: Annotated[Settings, Depends(get_settings)],
) -> AttachmentRead:
    expected_prefix = f"{user.id}/"
    if data.bucket != settings.minio_user_bucket or not data.object_key.startswith(expected_prefix):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "对象不属于当前用户")
    stat = await storage.stat(data.bucket, data.object_key)
    if stat.size > settings.max_upload_bytes or data.size > settings.max_upload_bytes:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "文件超过上传大小限制")
    if stat.size != data.size:
        raise HTTPException(status.HTTP_409_CONFLICT, "对象大小与申报不一致")
    actual_sha256 = await storage.sha256(data.bucket, data.object_key)
    if actual_sha256.lower() != data.sha256.lower():
        raise HTTPException(status.HTTP_409_CONFLICT, "对象摘要与申报不一致")

    def metadata_matches(candidate: Attachment) -> bool:
        return (
            candidate.owner_id == user.id
            and candidate.filename == data.filename
            and candidate.content_type == data.content_type
            and candidate.size == data.size
            and candidate.sha256.lower() == data.sha256.lower()
        )

    attachment = await db.scalar(
        select(Attachment).where(
            Attachment.bucket == data.bucket,
            Attachment.object_key == data.object_key,
        )
    )
    if attachment is not None:
        if not metadata_matches(attachment):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "该对象已经用不同的附件元数据完成登记",
            )
        if attachment.parse_status not in {"pending", "failed"}:
            return await attachment_response(attachment)
        attachment.parse_status = "pending"
        attachment.parse_error = None
    else:
        attachment = Attachment(owner_id=user.id, **data.model_dump())
        db.add(attachment)
    try:
        await db.commit()
    except IntegrityError as error:
        await db.rollback()
        attachment = await db.scalar(
            select(Attachment).where(
                Attachment.bucket == data.bucket,
                Attachment.object_key == data.object_key,
            )
        )
        if attachment is None:
            raise
        if not metadata_matches(attachment):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "该对象已经用不同的附件元数据完成登记",
            ) from error
    await db.refresh(attachment)
    job_queue = getattr(request.app.state, "job_queue", None)
    if job_queue is None:
        attachment.parse_status = "failed"
        attachment.parse_error = "后台附件处理队列不可用"
        await db.commit()
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "后台附件处理队列不可用，请稍后重试",
        )
    try:
        await job_queue.enqueue(
            "attachment.process",
            {"attachment_id": attachment.id},
            idempotency_key=attachment.id,
        )
    except Exception as error:
        attachment.parse_status = "failed"
        attachment.parse_error = "后台附件处理任务入队失败"
        await db.commit()
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "附件处理任务入队失败，请稍后重试",
        ) from error
    return await attachment_response(attachment)


@router.get("/attachments/{attachment_id}", response_model=AttachmentRead)
async def get_attachment(
    attachment_id: str,
    user: CurrentUser,
    db: Db,
    storage: Storage,
) -> AttachmentRead:
    attachment = await db.get(Attachment, attachment_id)
    if attachment is None or attachment.owner_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "附件不存在")
    return await attachment_response(attachment)


@router.get(
    "/attachments/{attachment_id}/content",
    name="attachment_content",
)
async def attachment_content(
    attachment_id: str,
    user: CurrentUser,
    db: Db,
    storage: Storage,
) -> RedirectResponse:
    attachment = await db.get(Attachment, attachment_id)
    if attachment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "附件不存在")
    linked_photo = await db.scalar(select(Photo.id).where(Photo.attachment_id == attachment_id))
    if attachment.owner_id != user.id and linked_photo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "附件不存在")
    return RedirectResponse(
        await storage.presign_get(
            attachment.bucket,
            attachment.object_key,
            attachment_response_headers(attachment),
        ),
        status_code=status.HTTP_307_TEMPORARY_REDIRECT,
        # 不能超过 900 秒的默认签名有效期；最终图片响应另有一天的 private 缓存。
        headers={"Cache-Control": "private, max-age=600"},
    )


@router.get("/attachments/{attachment_id}/thumbnail")
async def attachment_thumbnail(
    attachment_id: str,
    user: CurrentUser,
    db: Db,
    storage: Storage,
) -> RedirectResponse:
    attachment = await db.get(Attachment, attachment_id)
    if attachment is None or attachment.derived_bucket is None or attachment.thumbnail_key is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "缩略图不存在")
    linked_photo = await db.scalar(select(Photo.id).where(Photo.attachment_id == attachment_id))
    if attachment.owner_id != user.id and linked_photo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "缩略图不存在")
    return RedirectResponse(
        await storage.presign_get(
            attachment.derived_bucket,
            attachment.thumbnail_key,
            {
                "response-content-disposition": "inline",
                "response-content-type": "image/webp",
            },
        ),
        status_code=status.HTTP_307_TEMPORARY_REDIRECT,
    )


@router.get("/attachments/{attachment_id}/preview")
async def attachment_preview(
    attachment_id: str,
    user: CurrentUser,
    db: Db,
    storage: Storage,
) -> RedirectResponse:
    attachment = await db.get(Attachment, attachment_id)
    if attachment is None or attachment.owner_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "文档预览不存在")
    if attachment.preview_key and attachment.derived_bucket:
        bucket, object_key = attachment.derived_bucket, attachment.preview_key
    elif attachment.content_type == "application/pdf":
        bucket, object_key = attachment.bucket, attachment.object_key
    else:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "文档预览不存在")
    return RedirectResponse(
        await storage.presign_get(
            bucket,
            object_key,
            {
                "response-content-disposition": "inline",
                "response-content-type": "application/pdf",
                "response-cache-control": "private, max-age=86400, immutable",
            },
        ),
        status_code=status.HTTP_307_TEMPORARY_REDIRECT,
    )


@router.get("/attachments/{attachment_id}/document-ir")
async def attachment_document_ir(
    attachment_id: str,
    user: CurrentUser,
    db: Db,
    storage: Storage,
) -> RedirectResponse:
    attachment = await db.get(Attachment, attachment_id)
    if (
        attachment is None
        or attachment.owner_id != user.id
        or attachment.derived_bucket is None
        or attachment.document_ir_key is None
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document IR 不存在")
    return RedirectResponse(
        await storage.presign_get(
            attachment.derived_bucket,
            attachment.document_ir_key,
            {
                "response-content-disposition": "attachment",
                "response-content-type": "application/json",
                "response-cache-control": "private, max-age=600",
            },
        ),
        status_code=status.HTTP_307_TEMPORARY_REDIRECT,
    )


@router.get("/events")
async def events(
    request: Request,
    db: Db,
    _: CurrentUser,
    settings: Annotated[Settings, Depends(get_settings)],
) -> StreamingResponse:
    # 身份校验已完成；长连接不能继续占用认证事务和连接池槽位。
    await db.commit()
    await db.close()
    return StreamingResponse(
        stream_outbox(
            session_factory,
            settings.outbox_poll_seconds,
            request.headers.get("last-event-id"),
            settings.outbox_retention_days,
        ),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


# ── 首页素材 ──────────────────────────────────────────────────────────────
#
# 素材本来是 `public/hero/*` 里的静态文件，烤在镜像里，换一张要重新部署。
# 后台上传之后存进对象存储，这两个接口负责把它交给浏览器。

HERO_SLOTS = ("video", "poster")


@router.get("/site/hero")
async def read_hero(db: Db, _: CurrentUser) -> dict[str, str | None]:
    """首页该用哪份素材。没配过就返回 null，前端回落到镜像自带的那份。"""
    values = await runtime_config.load_all(db)
    return {
        slot: (
            f"/api/v1/site/hero/{slot}/content" if values[f"site.hero_{slot}_attachment"] else None
        )
        for slot in HERO_SLOTS
    }


@router.get("/site/hero/{slot}/content")
async def read_hero_content(
    slot: str,
    db: Db,
    storage: Storage,
    settings: Annotated[Settings, Depends(get_settings)],
    _: CurrentUser,
) -> Response:
    """把素材本体发出去。

    **不用预签名重定向。** 预签名 URL 的 host 必须是浏览器能直接访问到的
    MinIO 地址，而生产上 MinIO 只绑回环、外面只有 Caddy 的 443。走后端转发一次
    虽然多花点带宽，但不需要把对象存储暴露到公网，也不需要额外的域名和证书。
    素材本身只有几百 KB，两个人用，代价可以忽略。
    """
    if slot not in HERO_SLOTS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "没有这个槽位")
    key = (await runtime_config.load_all(db, settings))[f"site.hero_{slot}_attachment"]
    if not key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "没有自定义素材")
    payload = await storage.get_bytes(settings.minio_derived_bucket, str(key))
    media_type = "video/mp4" if slot == "video" else "image/webp"
    return Response(
        content=payload,
        media_type=media_type,
        headers={"Cache-Control": "private, max-age=300"},
    )


# ── Passkey（主站）──────────────────────────────────────────────────────
#
# 密码登录保留，这是加法。理由和大陆各平台的实际情况见 app/passkeys.py。


class PasskeyFinish(ApiModel):
    challenge_id: str
    credential: dict[str, Any]
    label: str = ""


@router.post("/auth/passkey/register/begin")
async def passkey_register_begin(
    db: Db, user: CurrentUser, settings: Annotated[Settings, Depends(get_settings)]
) -> dict[str, Any]:
    payload = await passkeys.begin_registration(
        db, settings, "user", user.id, user.username, user.display_name
    )
    await db.commit()
    return payload


@router.post("/auth/passkey/register/finish")
async def passkey_register_finish(
    data: PasskeyFinish,
    db: Db,
    user: CurrentUser,
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    try:
        item = await passkeys.finish_registration(
            db, settings, "user", user.id, data.challenge_id, data.credential, data.label
        )
    except passkeys.PasskeyError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    await db.commit()
    return {"id": item.id, "label": item.label}


@router.post("/auth/passkey/login/begin")
async def passkey_login_begin(
    db: Db, settings: Annotated[Settings, Depends(get_settings)]
) -> dict[str, Any]:
    payload = await passkeys.begin_authentication(db, settings, "user")
    await db.commit()
    return payload


@router.post("/auth/passkey/login/finish", response_model=LoginResponse)
async def passkey_login_finish(
    data: PasskeyFinish,
    request: Request,
    response: Response,
    db: Db,
    settings: Annotated[Settings, Depends(get_settings)],
) -> LoginResponse:
    try:
        stored = await passkeys.finish_authentication(
            db, settings, "user", data.challenge_id, data.credential
        )
    except passkeys.PasskeyError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc)) from exc

    user = await db.get(User, stored.user_id)
    if user is None or not user.enabled:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "账号不可用")
    record, token = await create_session(
        db, user, request.headers.get("user-agent", "")[:120] or None, settings
    )
    await db.commit()
    set_session_cookie(response, token, settings)
    # 与密码登录同一个返回体：前端只有一条处理登录成功的路径。
    return LoginResponse(user=user, expires_at=record.expires_at)


@router.get("/auth/passkey")
async def passkey_list(db: Db, user: CurrentUser) -> list[dict[str, Any]]:
    return [
        {
            "id": item.id,
            "label": item.label,
            "createdAt": item.created_at,
            "lastUsedAt": item.last_used_at,
        }
        for item in await passkeys.list_credentials(db, "user", user.id)
    ]


@router.delete("/auth/passkey/{credential_pk}", status_code=status.HTTP_204_NO_CONTENT)
async def passkey_delete(credential_pk: str, db: Db, user: CurrentUser) -> None:
    if not await passkeys.delete_credential(db, "user", user.id, credential_pk):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "没有这把钥匙")
    await db.commit()


# ── 桌面本地执行器（二期）──────────────────────────────────────────────
#
# 这三个接口是桌面端和云端之间那条通路的服务端一侧。
# 派发与租约的设计见 app/local_executor.py 顶部。


class ExecutorRegister(ApiModel):
    name: str = PydanticField(min_length=1, max_length=120)
    #: 这台机器上用户授权了哪些目录。**服务端只存来展示**——真正的校验在本地做，
    #: 把闸门放在可能被提示注入影响的一侧就不叫闸门了。
    allowed_roots: list[str] = PydanticField(default_factory=list, max_length=32)


class ExecutorResult(ApiModel):
    call_id: str
    result: dict[str, Any] | None = None
    error: str | None = None


@router.post("/desktop/executors")
async def register_executor(data: ExecutorRegister, db: Db, user: CurrentUser) -> dict[str, Any]:
    """注册这台电脑，或者续一次心跳。

    按 (用户, 机器名) 认同一台机器。用名字而不是随机 id，是为了让重装、
    重新登录之后还是同一条记录——否则设置页里会越攒越多台「Ricky 的 MacBook」。
    """
    existing = await db.scalar(
        select(DesktopExecutor).where(
            DesktopExecutor.user_id == user.id, DesktopExecutor.name == data.name
        )
    )
    if existing is None:
        existing = DesktopExecutor(user_id=user.id, name=data.name)
        db.add(existing)
    existing.allowed_roots = data.allowed_roots
    existing.last_seen_at = utcnow()
    await db.commit()
    return {"executorId": existing.id, "enabled": existing.enabled}


@router.post("/desktop/executors/{executor_id}/claim")
async def claim_local_call(executor_id: str, db: Db, user: CurrentUser) -> dict[str, Any] | None:
    """认领一条待办，**同时拿到参数**。

    参数只在这里给，不走 SSE：那条流是全局广播，没有按用户过滤，
    路径放进去等于对方的浏览器也会收到「正在读 ~/Documents/xxx」。
    """
    executor = await db.get(DesktopExecutor, executor_id)
    if executor is None or executor.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "没有这台机器")
    call = await local_executor.claim_next(db, executor_id)
    if call is None:
        return None
    return {"callId": call.id, "tool": call.tool, "arguments": call.arguments}


@router.post(
    "/desktop/executors/{executor_id}/result",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def submit_local_result(
    executor_id: str, data: ExecutorResult, db: Db, user: CurrentUser
) -> None:
    """回填执行结果。只有认领它的那台机器能回填。"""
    executor = await db.get(DesktopExecutor, executor_id)
    if executor is None or executor.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "没有这台机器")
    if not await local_executor.resolve(db, executor_id, data.call_id, data.result, data.error):
        # 多半是已经超时被判失败了。不当成错误——桌面端晚回来一步很正常，
        # 它没有做错什么，只是这条已经不需要了。
        raise HTTPException(status.HTTP_409_CONFLICT, "这次调用已经结束了")
