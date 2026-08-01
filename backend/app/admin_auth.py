"""后台的独立登录。**与主站账号完全隔离。**

## 为什么要独立

改这一版之前，`/admin` 用的是主站那套账号——登录页上就写着「与主站使用同一
个账号」。那意味着：任何一个能登进主站看照片的人，也能改模型配置、看全部记忆、
拿到会话列表。这两件事的风险等级差得远。

隔离体现在三处，**缺一不可**：

| | 主站 | 后台 |
|---|---|---|
| Cookie | `kitty_session` | `kitty_admin` |
| 会话表 | `UserSession` | `AdminSession` |
| 账号表 | `User` | `Admin` |

Cookie 名不同是关键的一条：如果两边共用一个 Cookie 名，浏览器只会存一份，
后台登录会把主站的会话顶掉（反之亦然），而且**任何一边的会话泄露都等于两边
同时失守**。

## 为什么复用那张空着的 `Admin` 表

它是 Prisma 时代留下的，形状（username / password / status）正合适，而且
**从来没被任何代码引用过**——只在 `migration_bootstrap` 的接管清单里出现。
恢复旧站数据时我也刻意跳过了它，所以它是干净的。新建一张表只会让「有两张
看起来都像管理员」的表这件事更糊涂。

`password` 列直接存 argon2 摘要，与主站同一套 `pwdlib` 原语。

## 限流复用 `AuthAttempt`

后台登录失败也记进同一张表，用 `admin:` 前缀区分用户名。这样「同一个 IP 在
两边反复试密码」会被合并计数——攻击者不该因为换了个入口就重置计数器。
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import timedelta
from typing import Annotated

from fastapi import Cookie, Depends, Header, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import DUMMY_PASSWORD_HASH, hash_password, verify_password
from app.config import Settings, get_settings
from app.db import get_session
from app.models import Admin, AdminSession, utcnow

#: **不能和主站的 `kitty_session` 同名。** 见模块文档。
ADMIN_COOKIE_NAME = "kitty_admin"

#: 后台会话比主站短得多。后台能改模型配置和看全部记忆，
#: 一台没锁屏的电脑不该在两周后还留着后台权限。
ADMIN_SESSION_HOURS = 12

#: 记进 AuthAttempt 时给用户名加的前缀，用来和主站登录区分。
ATTEMPT_PREFIX = "admin:"


def _digest(token: str, secret: str) -> bytes:
    """和主站会话用的是同一套构造，但盐不同——两边的令牌摘要不该互相碰撞。"""
    return hmac.new(
        (secret + "|admin").encode(), token.encode(), hashlib.sha256
    ).digest()


async def create_admin_session(
    db: AsyncSession,
    admin: Admin,
    device_name: str | None,
    settings: Settings,
) -> tuple[AdminSession, str]:
    token = secrets.token_urlsafe(32)
    now = utcnow()
    record = AdminSession(
        admin_id=admin.id,
        token_hash=_digest(token, settings.session_secret),
        expires_at=now + timedelta(hours=ADMIN_SESSION_HOURS),
        last_seen_at=now,
        device_name=device_name,
    )
    db.add(record)
    await db.flush()
    return record, token


async def resolve_admin(
    db: AsyncSession,
    token: str | None,
    settings: Settings,
) -> Admin | None:
    if not token:
        return None
    record = await db.scalar(
        select(AdminSession).where(AdminSession.token_hash == _digest(token, settings.session_secret))
    )
    if record is None or record.revoked_at is not None:
        return None
    now = utcnow()
    expires = record.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=now.tzinfo)
    if expires <= now:
        return None

    last_seen = record.last_seen_at
    if last_seen.tzinfo is None:
        last_seen = last_seen.replace(tzinfo=now.tzinfo)
    # 每次请求都写一次库太浪费；五分钟的粒度足够看出「这个会话还活着」。
    if now - last_seen >= timedelta(minutes=5):
        record.last_seen_at = now
        await db.flush()

    admin = await db.get(Admin, record.admin_id)
    return admin if admin is not None and admin.status != "disabled" else None


async def current_admin(
    db: Annotated[AsyncSession, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    kitty_admin: Annotated[str | None, Cookie()] = None,
    authorization: Annotated[str | None, Header()] = None,
) -> Admin:
    token = kitty_admin
    if not token and authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
    admin = await resolve_admin(db, token, settings)
    if admin is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "请先登录后台")
    return admin


CurrentAdmin = Annotated[Admin, Depends(current_admin)]


def set_admin_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        ADMIN_COOKIE_NAME,
        token,
        max_age=ADMIN_SESSION_HOURS * 3600,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        # **必须是 "/" 而不是 "/admin"。** 后台页面在 /admin 下，但它调的接口
        # 在 /api/v1/admin 下——限定成 /admin 的话，Cookie 根本不会被带到接口上，
        # 每个请求都 401。隔离靠的是**另一个 Cookie 名 + 另一张会话表**，
        # 不是靠路径。
        path="/",
    )


def clear_admin_cookie(response: Response) -> None:
    response.delete_cookie(ADMIN_COOKIE_NAME, path="/")


def verify_admin_password(admin: Admin | None, password: str) -> bool:
    """恒定时间比较：账号不存在时也跑一次假摘要，免得用响应时间探出用户名。"""
    return verify_password(password, admin.password if admin else DUMMY_PASSWORD_HASH)


def set_admin_password(admin: Admin, password: str) -> None:
    admin.password = hash_password(password)
    admin.status = "active"
