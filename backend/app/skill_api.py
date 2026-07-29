from __future__ import annotations

from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import CurrentUser
from app.config import Settings, get_settings
from app.db import get_session
from app.models import Skill, SkillVersion
from app.skill_runtime import SkillRegistry
from app.storage import ObjectStorage, get_storage

router = APIRouter(prefix="/skills", tags=["skills"])
Db = Annotated[AsyncSession, Depends(get_session)]
Storage = Annotated[ObjectStorage, Depends(get_storage)]


class SkillVersionResponse(BaseModel):
    id: str
    revision: str
    sha256: str
    active: bool


class SkillResponse(BaseModel):
    id: str
    name: str
    description: str
    enabled: bool
    active_version_id: str | None = Field(alias="activeVersionId")
    versions: list[SkillVersionResponse] = Field(default_factory=list)


class SkillContentResponse(BaseModel):
    name: str
    version_id: str = Field(alias="versionId")
    content: str


class RunScriptRequest(BaseModel):
    script: str
    arguments: list[str] = Field(default_factory=list, max_length=32)


class SkillEnabledRequest(BaseModel):
    enabled: bool


async def active_skill(db: AsyncSession, name: str) -> tuple[Skill, SkillVersion]:
    row = (
        await db.execute(
            select(Skill, SkillVersion)
            .join(SkillVersion, Skill.active_version_id == SkillVersion.id)
            .where(Skill.name == name, Skill.enabled.is_(True))
        )
    ).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Skill 不存在或未启用")
    return row


@router.get("", response_model=list[SkillResponse])
async def list_skills(db: Db, _: CurrentUser) -> list[SkillResponse]:
    skills = list(await db.scalars(select(Skill).order_by(Skill.name).limit(100)))
    versions = list(
        await db.scalars(
            select(SkillVersion)
            .order_by(SkillVersion.created_at.desc())
            .limit(1000)
        )
    )
    grouped: dict[str, list[SkillVersion]] = {}
    for version in versions:
        grouped.setdefault(version.skill_id, []).append(version)
    return [
        SkillResponse(
            id=skill.id,
            name=skill.name,
            description=skill.description,
            enabled=skill.enabled,
            activeVersionId=skill.active_version_id,
            versions=[
                SkillVersionResponse(
                    id=version.id,
                    revision=version.revision,
                    sha256=version.sha256,
                    active=version.id == skill.active_version_id,
                )
                for version in grouped.get(skill.id, [])
            ],
        )
        for skill in skills
    ]


@router.post("/upload", response_model=SkillResponse, status_code=status.HTTP_201_CREATED)
async def upload_skill(
    db: Db,
    _: CurrentUser,
    storage: Storage,
    archive: Annotated[UploadFile, File()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> SkillResponse:
    data = await archive.read(settings.skill_max_archive_bytes + 1)
    if len(data) > settings.skill_max_archive_bytes:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Skill ZIP 超过大小限制")
    try:
        skill, version = await SkillRegistry(storage, settings).install(db, data)
    except (ValueError, OSError) as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(error)) from error
    return SkillResponse(
        id=skill.id,
        name=skill.name,
        description=skill.description,
        enabled=skill.enabled,
        activeVersionId=version.id,
        versions=[
            SkillVersionResponse(
                id=version.id,
                revision=version.revision,
                sha256=version.sha256,
                active=True,
            )
        ],
    )


@router.post(
    "/{skill_id}/versions/{version_id}/activate",
    response_model=SkillResponse,
)
async def activate_skill(
    skill_id: str,
    version_id: str,
    db: Db,
    _: CurrentUser,
    storage: Storage,
) -> SkillResponse:
    skill, version = await SkillRegistry(storage).activate(db, skill_id, version_id)
    return SkillResponse(
        id=skill.id,
        name=skill.name,
        description=skill.description,
        enabled=skill.enabled,
        activeVersionId=version.id,
        versions=[
            SkillVersionResponse(
                id=version.id,
                revision=version.revision,
                sha256=version.sha256,
                active=True,
            )
        ],
    )


@router.patch("/{skill_id}/enabled", response_model=SkillResponse)
async def set_skill_enabled(
    skill_id: str,
    data: SkillEnabledRequest,
    db: Db,
    _: CurrentUser,
) -> SkillResponse:
    skill = await db.get(Skill, skill_id)
    if skill is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Skill 不存在")
    if data.enabled and skill.active_version_id is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Skill 没有可启用版本")
    skill.enabled = data.enabled
    await db.commit()
    await db.refresh(skill)
    versions = list(
        await db.scalars(
            select(SkillVersion)
            .where(SkillVersion.skill_id == skill.id)
            .order_by(SkillVersion.created_at.desc())
        )
    )
    return SkillResponse(
        id=skill.id,
        name=skill.name,
        description=skill.description,
        enabled=skill.enabled,
        activeVersionId=skill.active_version_id,
        versions=[
            SkillVersionResponse(
                id=version.id,
                revision=version.revision,
                sha256=version.sha256,
                active=version.id == skill.active_version_id,
            )
            for version in versions
        ],
    )


@router.get("/{name}/content", response_model=SkillContentResponse)
async def load_skill(
    name: str,
    db: Db,
    _: CurrentUser,
    storage: Storage,
) -> SkillContentResponse:
    skill, version = await active_skill(db, name)
    content = await SkillRegistry(storage).load_instructions(version)
    return SkillContentResponse(name=skill.name, versionId=version.id, content=content)


@router.get("/{name}/resources/{resource_path:path}")
async def read_skill_resource(
    name: str,
    resource_path: str,
    db: Db,
    _: CurrentUser,
    storage: Storage,
) -> dict[str, str]:
    _, version = await active_skill(db, name)
    try:
        content = await SkillRegistry(storage).read_resource(version, resource_path)
    except (ValueError, UnicodeDecodeError) as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(error)) from error
    return {"content": content}


@router.post("/{name}/scripts/run")
async def run_skill_script(
    name: str,
    data: RunScriptRequest,
    db: Db,
    _: CurrentUser,
    storage: Storage,
) -> dict[str, Any]:
    _, version = await active_skill(db, name)
    try:
        return await SkillRegistry(storage).run_script(
            version,
            data.script,
            data.arguments,
        )
    except httpx.HTTPError as error:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Skill Worker 调用失败") from error
