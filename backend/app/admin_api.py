"""后台的接口。全部挂在 `/api/v1/admin` 下，全部要后台会话。

## 边界：后台管系统，主站管内容

照片、里程碑、留言这些**在主站自己就能编辑**。后台不再重做一遍——两套 UI
维护同一批数据，改一处忘一处是迟早的事。后台只管主站碰不到的东西：

- 配置（模型、密钥、宠物的节奏与预算、记忆参数、安全）
- 记忆（主站只写不读不删）
- 技能与工具调用记录
- 宠物人格
- 账号与会话（含重置主站用户密码）
- 首页素材

## 鉴权

每个路由都依赖 `CurrentAdmin`，也就是 `kitty_admin` Cookie 对应的
`AdminSession`。**主站的 `kitty_session` 在这里一文不值**——拿主站会话调
后台接口会 401。理由见 `app/admin_auth.py`。
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Annotated, Any, Literal
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import passkeys, runtime_config
from app.admin_auth import (
    ATTEMPT_PREFIX,
    CurrentAdmin,
    clear_admin_cookie,
    create_admin_session,
    set_admin_cookie,
    set_admin_password,
    verify_admin_password,
)
from app.auth import hash_password
from app.capability_catalog import core_catalog
from app.config import Settings, get_settings
from app.db import get_session
from app.mcp_runtime import McpHost, encrypt_headers
from app.models import (
    Admin,
    AdminSession,
    AuthAttempt,
    Companion,
    CompanionPersona,
    McpServer,
    McpTool,
    MemoryRecord,
    MemoryRecordEmbedding,
    MemoryRevision,
    SiteConfig,
    Skill,
    SkillVersion,
    ToolRun,
    User,
    UserSession,
    utcnow,
)
from app.skill_runtime import SkillRegistry
from app.storage import ObjectStorage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])

Db = Annotated[AsyncSession, Depends(get_session)]
Config = Annotated[Settings, Depends(get_settings)]

#: 首页素材在对象存储里的固定键。**不带随机后缀**——同一个槽位永远覆盖同一个
#: 对象，这样旧文件不会越攒越多，也不需要额外的清理任务。
HERO_OBJECT_KEYS = {
    "video": "site/hero-video",
    "poster": "site/hero-poster",
}

HERO_CONTENT_TYPES = {
    "video": {"video/mp4", "video/webm"},
    "poster": {"image/webp", "image/png", "image/jpeg"},
}


# ── 登录 ──────────────────────────────────────────────────────────────────


class AdminLogin(BaseModel):
    username: str
    password: str


class AdminMe(BaseModel):
    id: str
    username: str
    status: str


@router.post("/auth/login", response_model=AdminMe)
async def admin_login(
    data: AdminLogin,
    request: Request,
    response: Response,
    db: Db,
    settings: Config,
) -> Admin:
    """后台登录。

    限流与主站**共用 `AuthAttempt` 表**（用户名加 `admin:` 前缀）：同一个 IP
    在两个入口反复试密码会被合并计数，换个入口不该重置计数器。
    """
    client_ip = request.client.host if request.client else "unknown"
    values = await runtime_config.load_all(db, settings)
    window = int(values["security.login_window_minutes"])
    limit = int(values["security.login_max_failures"])

    failures = (
        await db.scalar(
            select(func.count(AuthAttempt.id)).where(
                AuthAttempt.success.is_(False),
                AuthAttempt.created_at >= utcnow() - timedelta(minutes=window),
                or_(
                    AuthAttempt.ip == client_ip,
                    AuthAttempt.username == ATTEMPT_PREFIX + data.username,
                ),
            )
        )
        or 0
    )
    if failures >= limit:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "尝试过多，请稍后再试")

    admin = await db.scalar(select(Admin).where(Admin.username == data.username))
    valid = (
        admin is not None
        and admin.status != "disabled"
        and verify_admin_password(admin, data.password)
    )
    db.add(
        AuthAttempt(
            ip=client_ip,
            username=ATTEMPT_PREFIX + data.username,
            success=bool(valid),
        )
    )
    if not valid or admin is None:
        await db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "用户名或密码不对")

    _, token = await create_admin_session(
        db, admin, request.headers.get("user-agent", "")[:120] or None, settings
    )
    # **必须提交。** 会话记录不落库的话，Cookie 发出去了但下一个请求查不到它，
    # 表现是「登录成功，然后每个请求都 401」。
    await db.commit()
    set_admin_cookie(response, token, settings)
    return admin


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
async def admin_logout(response: Response, db: Db, admin: CurrentAdmin) -> None:
    """撤销这个管理员的**全部**会话。

    后台是高权限入口，登出时顺手把其他设备一起踢掉，比只清当前 Cookie 稳妥。
    """
    now = utcnow()
    for session in await db.scalars(
        select(AdminSession).where(
            AdminSession.admin_id == admin.id, AdminSession.revoked_at.is_(None)
        )
    ):
        session.revoked_at = now
    await db.commit()
    clear_admin_cookie(response)


@router.get("/auth/me", response_model=AdminMe)
async def admin_me(admin: CurrentAdmin) -> Admin:
    return admin


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=10)


@router.post("/auth/password", status_code=status.HTTP_204_NO_CONTENT)
async def change_admin_password(data: PasswordChange, db: Db, admin: CurrentAdmin) -> None:
    """改后台密码。**要先验旧密码**——会话可能是别人在你没锁屏的电脑上捡的。"""
    if not verify_admin_password(admin, data.current_password):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "当前密码不对")
    set_admin_password(admin, data.new_password)
    await db.commit()


# ── 配置 ──────────────────────────────────────────────────────────────────


@router.get("/config")
async def read_config(db: Db, settings: Config, admin: CurrentAdmin) -> dict[str, Any]:
    """全部设置项的定义 + 当前值。密钥只回遮罩，永远不回明文。"""
    return {
        "groups": runtime_config.GROUP_LABELS,
        "settings": await runtime_config.describe(db, settings),
    }


class ConfigUpdate(BaseModel):
    #: 键 → 新值（一律用字符串，服务端按注册表的类型解析和校验）。
    values: dict[str, str]


@router.patch("/config")
async def write_config(
    data: ConfigUpdate, db: Db, settings: Config, admin: CurrentAdmin
) -> dict[str, Any]:
    try:
        changed = await runtime_config.set_many(db, data.values, settings)
    except runtime_config.ValidationError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    await db.commit()
    logger.info("后台 %s 改了配置：%s", admin.username, "、".join(changed) or "（无变化）")
    return {"changed": changed, "settings": await runtime_config.describe(db, settings)}


class ConfigReset(BaseModel):
    keys: list[str]


@router.post("/config/reset")
async def reset_config(
    data: ConfigReset, db: Db, settings: Config, admin: CurrentAdmin
) -> dict[str, Any]:
    """删掉覆盖，回到 `.env` 里的值。"""
    try:
        removed = await runtime_config.reset(db, data.keys)
    except runtime_config.ValidationError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    await db.commit()
    return {"reset": removed, "settings": await runtime_config.describe(db, settings)}


# ── 记忆 ──────────────────────────────────────────────────────────────────


class MemoryRead(BaseModel):
    id: str
    visibility: str
    memory_type: str
    content: str
    importance: int
    confidence: float
    status: str
    access_count: int
    created_at: Any
    occurred_at: Any = None

    model_config = ConfigDict(from_attributes=True)


@router.get("/memories", response_model=list[MemoryRead])
async def list_memories(
    db: Db,
    admin: CurrentAdmin,
    q: str = "",
    memory_type: str = "",
    visibility: str = "",
    min_importance: int = 0,
    limit: int = 100,
    offset: int = 0,
) -> list[MemoryRecord]:
    stmt = select(MemoryRecord)
    if q:
        stmt = stmt.where(MemoryRecord.content.ilike(f"%{q}%"))
    if memory_type:
        stmt = stmt.where(MemoryRecord.memory_type == memory_type)
    if visibility:
        stmt = stmt.where(MemoryRecord.visibility == visibility)
    if min_importance:
        stmt = stmt.where(MemoryRecord.importance >= min_importance)
    stmt = stmt.order_by(MemoryRecord.created_at.desc()).limit(min(limit, 500)).offset(offset)
    return list(await db.scalars(stmt))


@router.get("/memories/facets")
async def memory_facets(db: Db, admin: CurrentAdmin) -> dict[str, Any]:
    """有哪些类型和可见域，各多少条。"""
    kinds = (
        await db.execute(
            select(MemoryRecord.memory_type, func.count())
            .group_by(MemoryRecord.memory_type)
            .order_by(func.count().desc())
        )
    ).all()
    scopes = (
        await db.execute(
            select(MemoryRecord.visibility, func.count()).group_by(MemoryRecord.visibility)
        )
    ).all()
    return {
        "kinds": [{"value": k, "count": c} for k, c in kinds],
        "scopes": [{"value": s, "count": c} for s, c in scopes],
        "total": await db.scalar(select(func.count(MemoryRecord.id))) or 0,
    }


@router.delete("/memories/{memory_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_memory(memory_id: str, db: Db, admin: CurrentAdmin) -> None:
    """删记忆。

    后台删除也走撤回语义，正文与证据链保留用于审计，但检索立即停止且向量移除。
    """
    item = await db.get(MemoryRecord, memory_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "记忆不存在")
    before = {
        "content": item.content,
        "importance": item.importance,
        "status": item.status,
    }
    item.status = "retracted"
    item.valid_to = utcnow()
    db.add(
        MemoryRevision(
            memory_id=item.id,
            operation="admin_retract",
            before_json=before,
            after_json={**before, "status": "retracted"},
            actor_type="admin",
            actor_id=admin.id,
            reason="后台撤回",
        )
    )
    await db.execute(
        delete(MemoryRecordEmbedding).where(MemoryRecordEmbedding.memory_id == item.id)
    )
    await db.commit()
    logger.info("后台 %s 删了记忆 %s", admin.username, memory_id)


# ── 技能与工具调用 ────────────────────────────────────────────────────────


@router.get("/capabilities")
async def list_capabilities(db: Db, admin: CurrentAdmin) -> dict[str, Any]:
    """服务器能力目录。设备授权仍由各用户在自己的设备上管理。"""
    skills = list(await db.scalars(select(Skill).order_by(Skill.name)))
    return {
        "core": core_catalog(),
        "skills": [
            {
                "key": f"skill.{skill.name}",
                "label": skill.name,
                "kind": "skill",
                "execution_plane": "server",
                "risk_level": "high",
                "enabled": skill.enabled,
                "activeVersionId": skill.active_version_id,
            }
            for skill in skills
        ],
        "devicePolicy": {
            "execution_plane": "device",
            "managedBy": "user_on_each_device",
            "arbitraryExecution": False,
        },
    }


def _mcp_server_payload(server: McpServer, tool_count: int = 0) -> dict[str, Any]:
    return {
        "id": server.id,
        "name": server.name,
        "url": server.url,
        "transport": server.transport,
        "enabled": server.enabled,
        "status": server.status,
        "hasAuth": bool(server.auth_headers_ciphertext),
        "toolCount": tool_count,
        "lastError": server.last_error,
        "lastSyncedAt": server.last_synced_at,
        "createdAt": server.created_at,
    }


def _validate_mcp_url(url: str, settings: Settings) -> str:
    parsed = urlparse(url.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "MCP URL 必须是 http(s)")
    if parsed.username or parsed.password or parsed.fragment:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "MCP URL 不能内嵌凭据或片段")
    if settings.app_env != "development" and parsed.scheme != "https":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "生产环境 MCP 必须使用 HTTPS")
    return url.strip()


class McpServerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120, pattern=r"^[a-z0-9][a-z0-9-]*$")
    url: str = Field(min_length=8, max_length=2048)
    auth_headers: dict[str, str] = Field(default_factory=dict)


class McpServerUpdate(BaseModel):
    enabled: bool | None = None
    url: str | None = Field(default=None, min_length=8, max_length=2048)
    auth_headers: dict[str, str] | None = None


class McpToolUpdate(BaseModel):
    enabled: bool | None = None
    risk_level: Literal["none", "low", "high"] | None = None


def _validated_headers(headers: dict[str, str]) -> dict[str, str]:
    if len(headers) > 20:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "MCP 认证头过多")
    cleaned = {}
    for key, value in headers.items():
        if not key or len(key) > 100 or "\n" in key or "\r" in key:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "MCP Header 名无效")
        if len(value) > 8_000 or "\n" in value or "\r" in value:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "MCP Header 值无效")
        cleaned[key] = value
    return cleaned


@router.get("/mcp-servers")
async def list_mcp_servers(db: Db, admin: CurrentAdmin) -> list[dict[str, Any]]:
    counts = dict(
        (
            await db.execute(select(McpTool.server_id, func.count()).group_by(McpTool.server_id))
        ).all()
    )
    servers = list(await db.scalars(select(McpServer).order_by(McpServer.name)))
    return [_mcp_server_payload(server, counts.get(server.id, 0)) for server in servers]


@router.post("/mcp-servers", status_code=status.HTTP_201_CREATED)
async def create_mcp_server(
    data: McpServerCreate,
    db: Db,
    settings: Config,
    admin: CurrentAdmin,
) -> dict[str, Any]:
    if await db.scalar(select(McpServer.id).where(McpServer.name == data.name)):
        raise HTTPException(status.HTTP_409_CONFLICT, "MCP Server 名称已存在")
    server = McpServer(
        name=data.name,
        url=_validate_mcp_url(data.url, settings),
        transport="streamable_http",
        auth_headers_ciphertext=encrypt_headers(_validated_headers(data.auth_headers), settings),
        enabled=False,
        status="unverified",
    )
    db.add(server)
    await db.commit()
    await db.refresh(server)
    logger.info("后台 %s 新增了 MCP Server %s", admin.username, server.name)
    return _mcp_server_payload(server)


@router.patch("/mcp-servers/{server_id}")
async def update_mcp_server(
    server_id: str,
    data: McpServerUpdate,
    db: Db,
    settings: Config,
    admin: CurrentAdmin,
) -> dict[str, Any]:
    server = await db.get(McpServer, server_id)
    if server is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "MCP Server 不存在")
    connection_changed = data.url is not None or data.auth_headers is not None
    if data.url is not None:
        server.url = _validate_mcp_url(data.url, settings)
    if data.auth_headers is not None:
        server.auth_headers_ciphertext = encrypt_headers(
            _validated_headers(data.auth_headers), settings
        )
    if connection_changed:
        server.enabled = False
        server.status = "unverified"
        server.last_error = None
        server.last_synced_at = None
        await db.execute(delete(McpTool).where(McpTool.server_id == server.id))
    if data.enabled is not None:
        if data.enabled and server.status != "healthy":
            raise HTTPException(status.HTTP_409_CONFLICT, "请先同步并通过 MCP 健康检查")
        server.enabled = data.enabled
    await db.commit()
    logger.info("后台 %s 更新了 MCP Server %s", admin.username, server.name)
    return _mcp_server_payload(server)


@router.post("/mcp-servers/{server_id}/sync")
async def sync_mcp_server(
    server_id: str,
    db: Db,
    settings: Config,
    admin: CurrentAdmin,
) -> dict[str, Any]:
    server = await db.get(McpServer, server_id)
    if server is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "MCP Server 不存在")
    try:
        tools = await McpHost(settings).sync_tools(db, server)
    except Exception as error:
        server.status = "failed"
        server.enabled = False
        server.last_error = str(error)[:2000]
        await db.commit()
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "MCP 同步失败") from error
    logger.info(
        "后台 %s 同步了 MCP Server %s，共 %s 个工具",
        admin.username,
        server.name,
        len(tools),
    )
    return {
        "server": _mcp_server_payload(server, len(tools)),
        "tools": [
            {
                "id": item.id,
                "name": item.name,
                "description": item.description,
                "inputSchema": item.input_schema,
                "outputSchema": item.output_schema,
                "annotations": item.annotations,
                "enabled": item.enabled,
                "riskLevel": item.risk_level,
            }
            for item in tools
        ],
    }


@router.get("/mcp-servers/{server_id}/tools")
async def list_mcp_tools(
    server_id: str, db: Db, admin: CurrentAdmin
) -> list[dict[str, Any]]:
    if await db.get(McpServer, server_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "MCP Server 不存在")
    tools = list(
        await db.scalars(
            select(McpTool).where(McpTool.server_id == server_id).order_by(McpTool.name)
        )
    )
    return [
        {
            "id": item.id,
            "name": item.name,
            "description": item.description,
            "inputSchema": item.input_schema,
            "outputSchema": item.output_schema,
            "annotations": item.annotations,
            "enabled": item.enabled,
            "riskLevel": item.risk_level,
        }
        for item in tools
    ]


@router.patch("/mcp-tools/{tool_id}")
async def update_mcp_tool(
    tool_id: str, data: McpToolUpdate, db: Db, admin: CurrentAdmin
) -> dict[str, Any]:
    item = await db.get(McpTool, tool_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "MCP 工具不存在")
    if data.enabled is not None:
        item.enabled = data.enabled
    if data.risk_level is not None:
        item.risk_level = data.risk_level
    await db.commit()
    logger.info("后台 %s 更新了 MCP Tool %s", admin.username, item.name)
    return {"id": item.id, "enabled": item.enabled, "riskLevel": item.risk_level}


@router.delete("/mcp-servers/{server_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_mcp_server(server_id: str, db: Db, admin: CurrentAdmin) -> None:
    server = await db.get(McpServer, server_id)
    if server is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "MCP Server 不存在")
    await db.delete(server)
    await db.commit()
    logger.info("后台 %s 删除了 MCP Server %s", admin.username, server.name)


def _skill_version_payload(skill: Skill, version: SkillVersion) -> dict[str, Any]:
    return {
        "id": version.id,
        "revision": version.revision,
        "sha256": version.sha256,
        "active": version.id == skill.active_version_id,
        "createdAt": version.created_at,
    }


def _skill_payload(skill: Skill, version: SkillVersion | None = None) -> dict[str, Any]:
    payload = {
        "id": skill.id,
        "name": skill.name,
        "description": skill.description,
        "enabled": skill.enabled,
        "activeVersionId": skill.active_version_id,
        "createdAt": skill.created_at,
    }
    if version is not None:
        payload["version"] = _skill_version_payload(skill, version)
    return payload


@router.get("/skills")
async def list_skills(db: Db, admin: CurrentAdmin) -> list[dict[str, Any]]:
    skills = list(await db.scalars(select(Skill).order_by(Skill.name)))
    counts = dict(
        (
            await db.execute(
                select(SkillVersion.skill_id, func.count()).group_by(SkillVersion.skill_id)
            )
        ).all()
    )
    return [
        {
            "id": s.id,
            "name": s.name,
            "description": s.description,
            "enabled": s.enabled,
            "activeVersionId": s.active_version_id,
            "versionCount": counts.get(s.id, 0),
            "createdAt": s.created_at,
        }
        for s in skills
    ]


class SkillToggle(BaseModel):
    enabled: bool


@router.post("/skills/upload", status_code=status.HTTP_201_CREATED)
async def upload_skill(
    archive: Annotated[UploadFile, File()],
    db: Db,
    settings: Config,
    admin: CurrentAdmin,
) -> dict[str, Any]:
    """安装一个 Skill 版本。可执行扩展的入口只属于独立后台账号。"""
    data = await archive.read(settings.skill_max_archive_bytes + 1)
    if len(data) > settings.skill_max_archive_bytes:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Skill ZIP 超过大小限制")
    try:
        skill, version = await SkillRegistry(ObjectStorage(settings), settings).install(db, data)
    except (ValueError, OSError) as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(error)) from error
    logger.info(
        "后台 %s 安装了 Skill %s@%s (%s)",
        admin.username,
        skill.name,
        version.revision,
        version.sha256[:12],
    )
    return _skill_payload(skill, version)


@router.patch("/skills/{skill_id}")
async def toggle_skill(
    skill_id: str, data: SkillToggle, db: Db, admin: CurrentAdmin
) -> dict[str, Any]:
    skill = await db.get(Skill, skill_id)
    if skill is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "技能不存在")
    if data.enabled and skill.active_version_id is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "技能没有可启用版本")
    skill.enabled = data.enabled
    await db.commit()
    logger.info("后台 %s 把技能 %s 设为 %s", admin.username, skill.name, data.enabled)
    return {"id": skill.id, "enabled": skill.enabled}


@router.get("/skills/{skill_id}/versions")
async def skill_versions(skill_id: str, db: Db, admin: CurrentAdmin) -> list[dict[str, Any]]:
    skill = await db.get(Skill, skill_id)
    if skill is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "技能不存在")
    rows = await db.scalars(
        select(SkillVersion)
        .where(SkillVersion.skill_id == skill_id)
        .order_by(SkillVersion.created_at.desc())
    )
    return [_skill_version_payload(skill, version) for version in rows]


@router.post("/skills/{skill_id}/versions/{version_id}/activate")
async def activate_skill_version(
    skill_id: str,
    version_id: str,
    db: Db,
    settings: Config,
    admin: CurrentAdmin,
) -> dict[str, Any]:
    skill, version = await SkillRegistry(ObjectStorage(settings), settings).activate(
        db, skill_id, version_id
    )
    logger.info(
        "后台 %s 激活了 Skill %s@%s (%s)",
        admin.username,
        skill.name,
        version.revision,
        version.sha256[:12],
    )
    return _skill_payload(skill, version)


@router.get("/tool-runs")
async def list_tool_runs(
    db: Db,
    admin: CurrentAdmin,
    tool: str = "",
    status_filter: str = "",
    limit: int = 100,
) -> dict[str, Any]:
    """工具调用记录。看得出「哪个工具被调得最多、哪个老是失败」。"""
    stmt = select(ToolRun)
    if tool:
        stmt = stmt.where(ToolRun.tool_name == tool)
    if status_filter:
        stmt = stmt.where(ToolRun.status == status_filter)
    runs = list(await db.scalars(stmt.order_by(ToolRun.created_at.desc()).limit(min(limit, 500))))
    summary = (
        await db.execute(
            select(ToolRun.tool_name, ToolRun.status, func.count())
            .group_by(ToolRun.tool_name, ToolRun.status)
            .order_by(func.count().desc())
        )
    ).all()
    return {
        "runs": [
            {
                "id": r.id,
                "tool": r.tool_name,
                "status": r.status,
                "createdAt": r.created_at,
                "completedAt": r.completed_at,
                "arguments": r.arguments,
                # 结果可能很大（比如一次文档生成），列表里只给个长度。
                "resultSize": len(str(r.result or "")),
            }
            for r in runs
        ],
        "summary": [{"tool": t, "status": s, "count": c} for t, s, c in summary],
    }


# ── 宠物人格 ──────────────────────────────────────────────────────────────


@router.get("/personas")
async def list_personas(db: Db, admin: CurrentAdmin) -> list[dict[str, Any]]:
    rows = (
        await db.execute(
            select(CompanionPersona, Companion.name)
            .join(Companion, Companion.id == CompanionPersona.companion_id)
            .order_by(CompanionPersona.created_at.desc())
        )
    ).all()
    return [
        {
            "id": p.id,
            "companionId": p.companion_id,
            "companionName": companion_name,
            "name": p.name,
            "prompt": p.prompt,
            "version": p.version,
        }
        for p, companion_name in rows
    ]


class PersonaWrite(BaseModel):
    prompt: str


@router.patch("/personas/{persona_id}")
async def update_persona(
    persona_id: str, data: PersonaWrite, db: Db, admin: CurrentAdmin
) -> dict[str, Any]:
    persona = await db.get(CompanionPersona, persona_id)
    if persona is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "人格不存在")
    persona.prompt = data.prompt
    persona.version += 1
    await db.commit()
    return {"id": persona.id, "version": persona.version}


# ── 主站账号 ──────────────────────────────────────────────────────────────


@router.get("/accounts")
async def list_accounts(db: Db, admin: CurrentAdmin) -> dict[str, Any]:
    users = list(await db.scalars(select(User).order_by(User.created_at)))
    now = utcnow()
    active = dict(
        (
            await db.execute(
                select(UserSession.user_id, func.count())
                .where(UserSession.revoked_at.is_(None), UserSession.expires_at > now)
                .group_by(UserSession.user_id)
            )
        ).all()
    )
    from app.cli import MAX_USERS

    return {
        # 上限一起给出来，前端才知道「还能不能再建一个」。
        # 硬编码在 cli.MAX_USERS，不是配置项——理由见 create_account。
        "maxUsers": MAX_USERS,
        "accounts": [
            {
                "id": u.id,
                "username": u.username,
                "displayName": u.display_name,
                "enabled": u.enabled,
                "activeSessions": active.get(u.id, 0),
                "createdAt": u.created_at,
            }
            for u in users
        ],
    }


class AccountCreate(BaseModel):
    username: str = Field(min_length=2, max_length=40)
    display_name: str = Field(min_length=1, max_length=60)
    password: str = Field(min_length=8)


@router.post("/accounts", status_code=status.HTTP_201_CREATED)
async def create_account(data: AccountCreate, db: Db, admin: CurrentAdmin) -> dict[str, Any]:
    """新建主站账号。

    **上限两个，而且这不是配置项。** 「对方」在这个站里的定义就是「另一个
    enabled 用户」（见 docs/couple-site-feature-plan.md §0.3）——聊天、每日一问、
    @宠物 全都建立在「恰好两个人」之上。放开这个限制不是加一行配置的事，是要
    重新想清楚那些功能对三个人意味着什么。

    与 `app.cli create-user` 同一条规则，上限也从那里引进来，免得两处各写一个数。
    """
    from app.cli import MAX_USERS

    if await db.scalar(select(User.id).where(User.username == data.username)):
        raise HTTPException(status.HTTP_409_CONFLICT, f"用户名 {data.username} 已被占用")
    count = await db.scalar(select(func.count(User.id))) or 0
    if count >= MAX_USERS:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"这个站最多 {MAX_USERS} 个账号。要换人的话，先停用旧的那个。",
        )
    user = User(
        username=data.username,
        display_name=data.display_name,
        password_hash=hash_password(data.password),
    )
    db.add(user)
    await db.commit()
    logger.info("后台 %s 新建了主站账号 %s", admin.username, data.username)
    return {"id": user.id, "username": user.username, "displayName": user.display_name}


class AccountPassword(BaseModel):
    new_password: str = Field(min_length=8)


@router.post("/accounts/{user_id}/password", status_code=status.HTTP_204_NO_CONTENT)
async def reset_account_password(
    user_id: str, data: AccountPassword, db: Db, admin: CurrentAdmin
) -> None:
    """重置主站账号密码，并**撤销该账号全部会话**。

    改了密码却留着旧会话，等于没改——真要用到这个功能的场景（密码泄露、
    手机丢了），恰恰是必须把已登录的设备踢下线的场景。
    """
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "账号不存在")
    user.password_hash = hash_password(data.new_password)
    now = utcnow()
    for session in await db.scalars(
        select(UserSession).where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
    ):
        session.revoked_at = now
    await db.commit()
    logger.info("后台 %s 重置了 %s 的密码并踢掉全部会话", admin.username, user.username)


class AccountToggle(BaseModel):
    enabled: bool


@router.patch("/accounts/{user_id}")
async def toggle_account(
    user_id: str, data: AccountToggle, db: Db, admin: CurrentAdmin
) -> dict[str, Any]:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "账号不存在")
    user.enabled = data.enabled
    if not data.enabled:
        now = utcnow()
        for session in await db.scalars(
            select(UserSession).where(
                UserSession.user_id == user_id, UserSession.revoked_at.is_(None)
            )
        ):
            session.revoked_at = now
    await db.commit()
    return {"id": user.id, "enabled": user.enabled}


@router.post("/accounts/{user_id}/sessions/revoke", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_account_sessions(user_id: str, db: Db, admin: CurrentAdmin) -> None:
    now = utcnow()
    for session in await db.scalars(
        select(UserSession).where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
    ):
        session.revoked_at = now
    await db.commit()


# ── 首页素材 ──────────────────────────────────────────────────────────────


@router.post("/hero/{slot}")
async def upload_hero(
    slot: Literal["video", "poster"],
    file: UploadFile,
    db: Db,
    settings: Config,
    admin: CurrentAdmin,
) -> dict[str, Any]:
    """换首页那段视频或那张静态图。**不用重新部署。**

    在这之前素材是 `public/hero/*` 里的静态文件，烤进镜像——换一张图要走完整
    的构建和部署流程。现在存进对象存储，配置里记住键，前端优先读配置。

    键是固定的（见 `HERO_OBJECT_KEYS`），同一个槽位永远覆盖同一个对象，
    不会越攒越多。
    """
    allowed = HERO_CONTENT_TYPES[slot]
    if file.content_type not in allowed:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            f"{slot} 只接受 {'、'.join(sorted(allowed))}",
        )
    payload = await file.read()
    limit = int((await runtime_config.load_all(db, settings))["upload.max_bytes"])
    if len(payload) > limit:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "文件太大")

    storage = ObjectStorage(settings)
    key = HERO_OBJECT_KEYS[slot]
    await storage.put_bytes(
        settings.minio_derived_bucket, key, payload, file.content_type or "application/octet-stream"
    )
    await runtime_config.set_many(db, {f"site.hero_{slot}_attachment": key}, settings)
    await db.commit()
    logger.info("后台 %s 换了首页%s（%d 字节）", admin.username, slot, len(payload))
    return {"slot": slot, "objectKey": key, "size": len(payload)}


@router.delete("/hero/{slot}", status_code=status.HTTP_204_NO_CONTENT)
async def reset_hero(
    slot: Literal["video", "poster"], db: Db, settings: Config, admin: CurrentAdmin
) -> None:
    """回到镜像里自带的那份。"""
    await runtime_config.reset(db, [f"site.hero_{slot}_attachment"])
    await db.commit()


# ── 仪表盘 ────────────────────────────────────────────────────────────────


def _hhmm(value: Any) -> str:
    """静默时段在配置里可能是 `time` 也可能是字符串，前端只想要 HH:MM。"""
    return value.strftime("%H:%M") if hasattr(value, "strftime") else str(value)


@router.get("/dashboard")
async def dashboard(db: Db, settings: Config, admin: CurrentAdmin) -> dict[str, Any]:
    values = await runtime_config.load_all(db, settings)
    counts = {}
    for label, model in (
        ("memories", MemoryRecord),
        ("skills", Skill),
        ("toolRuns", ToolRun),
        ("users", User),
    ):
        counts[label] = await db.scalar(select(func.count(model.id))) or 0

    failed_runs = (
        await db.scalar(select(func.count(ToolRun.id)).where(ToolRun.status == "failed")) or 0
    )
    # 有多少项被后台改过（其余的跟着 .env 走）。只数 cfg. 前缀，
    # 那张表里还住着 letter_title 这些内容类配置。
    overridden = (
        await db.scalar(
            select(func.count(SiteConfig.key)).where(
                SiteConfig.key.startswith(runtime_config.PREFIX)
            )
        )
        or 0
    )

    return {
        "counts": counts,
        "failedToolRuns": failed_runs,
        "configOverrides": overridden,
        "pet": {
            "dailyCallBudget": values["pet.daily_call_budget"],
            "dailyProactiveBudget": values["pet.daily_proactive_budget"],
            "quiet": f"{_hhmm(values['pet.quiet_start'])}–{_hhmm(values['pet.quiet_end'])}",
        },
        "chatModel": values["chat.model"],
        "embeddingModel": values["embedding.model"],
    }


# ── Passkey（后台）──────────────────────────────────────────────────────
#
# 与主站同一套逻辑，但 audience 是 "admin"——**主站的 passkey 登不了后台**，
# 反过来也一样。这与 Cookie 和会话表的隔离是同一条思路。


class AdminPasskeyFinish(BaseModel):
    challenge_id: str
    credential: dict[str, Any]
    label: str = ""


@router.post("/auth/passkey/register/begin")
async def admin_passkey_register_begin(
    db: Db, settings: Config, admin: CurrentAdmin
) -> dict[str, Any]:
    payload = await passkeys.begin_registration(
        db, settings, "admin", admin.id, admin.username, admin.username
    )
    await db.commit()
    return payload


@router.post("/auth/passkey/register/finish")
async def admin_passkey_register_finish(
    data: AdminPasskeyFinish, db: Db, settings: Config, admin: CurrentAdmin
) -> dict[str, Any]:
    try:
        item = await passkeys.finish_registration(
            db, settings, "admin", admin.id, data.challenge_id, data.credential, data.label
        )
    except passkeys.PasskeyError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    await db.commit()
    return {"id": item.id, "label": item.label}


@router.post("/auth/passkey/login/begin")
async def admin_passkey_login_begin(db: Db, settings: Config) -> dict[str, Any]:
    payload = await passkeys.begin_authentication(db, settings, "admin")
    await db.commit()
    return payload


@router.post("/auth/passkey/login/finish", response_model=AdminMe)
async def admin_passkey_login_finish(
    data: AdminPasskeyFinish,
    request: Request,
    response: Response,
    db: Db,
    settings: Config,
) -> Admin:
    try:
        stored = await passkeys.finish_authentication(
            db, settings, "admin", data.challenge_id, data.credential
        )
    except passkeys.PasskeyError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc)) from exc

    admin = await db.get(Admin, stored.admin_id)
    if admin is None or admin.status == "disabled":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "账号不可用")
    _, token = await create_admin_session(
        db, admin, request.headers.get("user-agent", "")[:120] or None, settings
    )
    await db.commit()
    set_admin_cookie(response, token, settings)
    return admin


@router.get("/auth/passkey")
async def admin_passkey_list(db: Db, admin: CurrentAdmin) -> list[dict[str, Any]]:
    return [
        {
            "id": item.id,
            "label": item.label,
            "createdAt": item.created_at,
            "lastUsedAt": item.last_used_at,
        }
        for item in await passkeys.list_credentials(db, "admin", admin.id)
    ]


@router.delete("/auth/passkey/{credential_pk}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_passkey_delete(credential_pk: str, db: Db, admin: CurrentAdmin) -> None:
    if not await passkeys.delete_credential(db, "admin", admin.id, credential_pk):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "没有这把钥匙")
    await db.commit()
