from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse, StreamingResponse
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent_runtime import AgentRuntime
from app.auth import (
    DUMMY_PASSWORD_HASH,
    SESSION_COOKIE_NAME,
    CurrentSession,
    CurrentUser,
    create_session,
    verify_password,
)
from app.config import Settings, get_settings
from app.conversations import ConversationService
from app.db import get_session, session_factory
from app.events import stream_outbox
from app.models import (
    Attachment,
    AuthAttempt,
    CompanionPersona,
    EventTimer,
    Memo,
    Message,
    Milestone,
    OutboxEvent,
    Pet,
    Photo,
    Reminder,
    SiteConfig,
    SiteConfigHistory,
    User,
    UserSession,
    utcnow,
)
from app.photo_service import ALLOWED_PHOTO_TYPES, PhotoService
from app.schemas import (
    AttachmentRead,
    ChatMessageRead,
    ChatStreamRequest,
    CompleteUploadRequest,
    ConversationCreate,
    ConversationRead,
    LoginRequest,
    LoginResponse,
    MemoCreate,
    MemoRead,
    MemoryCreate,
    MemoryRead,
    MemoUpdate,
    MessageCreate,
    MessageRead,
    MessageUpdate,
    MilestoneCreate,
    MilestoneRead,
    MilestoneUpdate,
    PersonaRead,
    PersonaUpdate,
    PetActionRead,
    PetRead,
    PetUpdate,
    PhotoCreate,
    PhotoRead,
    PhotoUpdate,
    PresignUploadRequest,
    PresignUploadResponse,
    ProfileRead,
    ProfileUpdate,
    ReminderCreate,
    ReminderRead,
    ReminderUpdate,
    SessionRead,
    SessionUser,
    TimerCreate,
    TimerRead,
    TimerUpdate,
)
from app.services import CrudService
from app.storage import ObjectStorage, get_storage

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
    safe_filename = (
        attachment.filename.replace("\r", "")
        .replace("\n", "")
        .replace('"', "'")
    )
    inline = attachment.content_type.lower() in INLINE_ATTACHMENT_TYPES
    disposition = "inline" if inline else "attachment"
    return {
        "response-content-disposition": (
            f'{disposition}; filename="{safe_filename}"'
        ),
        "response-content-type": (
            attachment.content_type if inline else "application/octet-stream"
        ),
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
        download_url=f"/api/v1/attachments/{attachment.id}/content",
        thumbnail_url=(
            f"/api/v1/attachments/{attachment.id}/thumbnail"
            if attachment.thumbnail_key
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
    ("memos", Memo, "memo", MemoCreate, MemoUpdate, MemoRead),
    ("reminders", Reminder, "reminder", ReminderCreate, ReminderUpdate, ReminderRead),
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
        response.set_cookie(
            SESSION_COOKIE_NAME,
            token,
            httponly=True,
            secure=settings.session_cookie_secure,
            samesite="lax",
            max_age=settings.session_ttl_days * 86400,
            path="/",
        )
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
    rows = await db.execute(select(SiteConfig.key, SiteConfig.value))
    return dict(rows.all())


EDITABLE_CONFIG_KEYS = {"letter_title", "letter_content", "main_timer_date"}


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
    return await conversation_service.list(db, user.id, limit=200)


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
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
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


@router.get("/memories", response_model=list[MemoryRead])
async def list_memories(
    db: Db,
    user: CurrentUser,
    runtime: Runtime,
    companion_id: str | None = None,
):
    return await runtime.memory.list(db, user.id, companion_id)


@router.post("/memories", response_model=MemoryRead, status_code=status.HTTP_201_CREATED)
async def create_memory(
    data: MemoryCreate,
    db: Db,
    user: CurrentUser,
    runtime: Runtime,
):
    try:
        item = await runtime.memory.create(db, user.id, data, embed=False)
        if runtime.job_queue is not None and runtime.embedding_enabled:
            try:
                await runtime.job_queue.enqueue(
                    "memory.embed",
                    {"memory_id": item.id},
                    idempotency_key=item.id,
                )
            except Exception:
                pass
        return item
    except ValueError as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(error)) from error


async def get_or_create_pet(db: AsyncSession) -> Pet:
    pet = await db.scalar(select(Pet).order_by(Pet.created_at).limit(1))
    if pet is None:
        pet = Pet(asset_id="kitty")
        db.add(pet)
        await db.commit()
        await db.refresh(pet)
    elif pet.asset_id not in {
        "kitty",
        "momo",
        "hello-kitty",
        "snoopy",
        "shiba",
        "bichon",
    }:
        pet.asset_id = "kitty"
        await db.commit()
        await db.refresh(pet)
    return pet


@router.get("/pet", response_model=PetRead)
async def read_pet(db: Db, _: CurrentUser):
    return await get_or_create_pet(db)


@router.patch("/pet", response_model=PetRead)
async def update_pet(data: PetUpdate, db: Db, _: CurrentUser):
    pet = await get_or_create_pet(db)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(pet, field, value)
    await db.commit()
    await db.refresh(pet)
    return pet


@router.post("/pet/actions/{action}", response_model=PetActionRead)
async def run_pet_action(
    action: str,
    db: Db,
    _: CurrentUser,
    animation: str | None = None,
    message: str | None = None,
    duration: int = 1800,
):
    pet = await get_or_create_pet(db)
    payload = {
        "action": action,
        "animation": animation or action,
        "assetId": pet.asset_id,
        "message": message,
        "duration": max(100, min(duration, 60_000)),
    }
    db.add(
        OutboxEvent(
            topic="pet.action",
            aggregate_type="pet",
            aggregate_id=pet.id,
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
    linked_photo = await db.scalar(
        select(Photo.id).where(Photo.attachment_id == attachment_id)
    )
    if attachment.owner_id != user.id and linked_photo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "附件不存在")
    return RedirectResponse(
        await storage.presign_get(
            attachment.bucket,
            attachment.object_key,
            attachment_response_headers(attachment),
        ),
        status_code=status.HTTP_307_TEMPORARY_REDIRECT,
    )


@router.get("/attachments/{attachment_id}/thumbnail")
async def attachment_thumbnail(
    attachment_id: str,
    user: CurrentUser,
    db: Db,
    storage: Storage,
) -> RedirectResponse:
    attachment = await db.get(Attachment, attachment_id)
    if (
        attachment is None
        or attachment.derived_bucket is None
        or attachment.thumbnail_key is None
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "缩略图不存在")
    linked_photo = await db.scalar(
        select(Photo.id).where(Photo.attachment_id == attachment_id)
    )
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
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
