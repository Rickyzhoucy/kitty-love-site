import hashlib
import hmac
import secrets
from datetime import timedelta
from typing import Annotated

from fastapi import Cookie, Depends, Header, HTTPException, status
from pwdlib import PasswordHash
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.db import get_session
from app.models import User, UserSession, utcnow

password_hash = PasswordHash.recommended()
SESSION_COOKIE_NAME = "kitty_session"
DUMMY_PASSWORD_HASH = (
    "$argon2id$v=19$m=65536,t=3,p=4$/m3RTM+dBkd4k3umqRzrbQ$"
    "KBikZ1e6rHFMe3B5F2CCiGFwbXTeufu/asC5OdNzMPs"
)


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, encoded: str) -> bool:
    return password_hash.verify(password, encoded)


def _token_digest(token: str, secret: str) -> bytes:
    return hmac.new(secret.encode(), token.encode(), hashlib.sha256).digest()


async def create_session(
    db: AsyncSession,
    user: User,
    device_name: str | None,
    settings: Settings,
) -> tuple[UserSession, str]:
    token = secrets.token_urlsafe(32)
    now = utcnow()
    record = UserSession(
        user_id=user.id,
        token_hash=_token_digest(token, settings.session_secret),
        expires_at=now + timedelta(days=settings.session_ttl_days),
        last_seen_at=now,
        device_name=device_name,
    )
    db.add(record)
    await db.flush()
    return record, token


def _extract_token(
    authorization: str | None,
    cookie_token: str | None,
) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return cookie_token


async def get_current_session(
    db: Annotated[AsyncSession, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
    kitty_session: Annotated[str | None, Cookie(alias="kitty_session")] = None,
) -> UserSession:
    token = _extract_token(authorization, kitty_session)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "未登录")
    digest = _token_digest(token, settings.session_secret)
    record = await db.scalar(select(UserSession).where(UserSession.token_hash == digest))
    now = utcnow()
    if (
        record is None
        or record.revoked_at is not None
        or record.expires_at.replace(tzinfo=record.expires_at.tzinfo or now.tzinfo) <= now
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "会话无效或已过期")
    last_seen = record.last_seen_at.replace(
        tzinfo=record.last_seen_at.tzinfo or now.tzinfo
    )
    if now - last_seen >= timedelta(minutes=5):
        record.last_seen_at = now
        await db.commit()
    return record


async def get_current_user(
    db: Annotated[AsyncSession, Depends(get_session)],
    current_session: Annotated[UserSession, Depends(get_current_session)],
) -> User:
    user = await db.get(User, current_session.user_id)
    if user is None or not user.enabled:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "用户不可用")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
CurrentSession = Annotated[UserSession, Depends(get_current_session)]


def set_session_cookie(response, token: str, settings: Settings) -> None:
    """种主站会话 Cookie。

    **抽出来共用**：密码登录和 passkey 登录都要种这个 Cookie，两处各写一遍的话
    迟早漂移——一处改了 `secure` 另一处没改，症状是「某条路径登录后在 https 下
    莫名掉线」。
    """
    response.set_cookie(
        SESSION_COOKIE_NAME,
        token,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        max_age=settings.session_ttl_days * 86400,
        path="/",
    )
