"""Passkey（WebAuthn）。主站和后台共用这一套逻辑，只是「受众」不同。

## 它解决什么

手机上打密码很烦，而这个站的两个人一天要开好几次。passkey 把登录变成一次
Face ID / 指纹。

## 它不解决什么，以及为什么必须留着密码

**手机丢了、系统重装、换到一台没同步的设备上——passkey 会把人直接锁在门外。**
这不是「稳妥起见」，是它的固有性质：私钥在设备的安全芯片里，服务端只有公钥，
没有任何找回的余地。所以密码登录**保留**，passkey 是加法。

## 大陆的现实

- **iPhone / iPad / Mac**：好。iCloud 中国由云上贵州运营，钥匙串同步正常，
  换手机 passkey 跟着走。
- **国行安卓**：能创建、能用，但同步要谷歌密码管理器（依赖 GMS，国行没有），
  所以多半是**只存在这台设备上**，换手机就没了。
- **扫码跨设备登录**（手机扫电脑上的二维码）要走 Google 的中继服务器，
  大陆多半连不上。所以电脑上还是老老实实用密码，或者单独在电脑上注册一把。

## 两个受众严格分开

`audience` 字段贯穿凭据、挑战和校验：主站的 passkey **不能**用来登后台，
反过来也一样。这与 Cookie 和会话表的隔离是同一条思路——后台能改模型配置、
翻全部记忆，它的钥匙不该和看照片的钥匙是同一把。

## RP ID 必须和域名对上

WebAuthn 把凭据绑定在 RP ID（域名）上。配错的表现是**弹窗一闪而过然后什么
都没发生**，浏览器控制台也未必说清楚。所以它是显式配置项，不猜。
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any, Literal

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from app.config import Settings
from app.models import WebAuthnChallenge, WebAuthnCredential, utcnow

logger = logging.getLogger(__name__)

Audience = Literal["user", "admin"]

#: 挑战的有效期。够慢悠悠地按指纹，又不至于让一个被截获的挑战长期可用。
CHALLENGE_TTL = timedelta(minutes=5)


class PasskeyError(RuntimeError):
    """所有对外可见的失败都走这个类型，调用方统一转成 400/401。"""


def _rp(settings: Settings) -> tuple[str, str, list[str]]:
    return settings.webauthn_rp_id, settings.webauthn_rp_name, settings.webauthn_origins


async def _issue_challenge(
    db: AsyncSession,
    challenge: bytes,
    purpose: str,
    audience: Audience,
    subject_id: str | None,
) -> str:
    # 顺手清掉过期的。这张表只会短暂地有几行，不值得单开一个定时任务。
    await db.execute(
        delete(WebAuthnChallenge).where(WebAuthnChallenge.expires_at < utcnow())
    )
    record = WebAuthnChallenge(
        challenge=challenge,
        purpose=purpose,
        audience=audience,
        subject_id=subject_id,
        expires_at=utcnow() + CHALLENGE_TTL,
    )
    db.add(record)
    await db.flush()
    return record.id


async def _take_challenge(
    db: AsyncSession, challenge_id: str, purpose: str, audience: Audience
) -> WebAuthnChallenge:
    """取出并**立即删除**。一次性是防重放的前提。"""
    record = await db.get(WebAuthnChallenge, challenge_id)
    if record is None:
        raise PasskeyError("这次操作已经失效，请重试")
    expires = record.expires_at
    now = utcnow()
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=now.tzinfo)
    used_up = expires <= now or record.purpose != purpose or record.audience != audience
    await db.delete(record)
    await db.flush()
    if used_up:
        raise PasskeyError("这次操作已经失效，请重试")
    return record


def _owner_filter(audience: Audience, subject_id: str):
    column = (
        WebAuthnCredential.user_id if audience == "user" else WebAuthnCredential.admin_id
    )
    return column == subject_id


async def list_credentials(
    db: AsyncSession, audience: Audience, subject_id: str
) -> list[WebAuthnCredential]:
    return list(
        await db.scalars(
            select(WebAuthnCredential)
            .where(_owner_filter(audience, subject_id))
            .order_by(WebAuthnCredential.created_at)
        )
    )


# ── 注册（给已登录的人加一把钥匙）────────────────────────────────────────

async def begin_registration(
    db: AsyncSession,
    settings: Settings,
    audience: Audience,
    subject_id: str,
    username: str,
    display_name: str,
) -> dict[str, Any]:
    rp_id, rp_name, _ = _rp(settings)
    existing = await list_credentials(db, audience, subject_id)

    options = generate_registration_options(
        rp_id=rp_id,
        rp_name=rp_name,
        # **用户句柄前面加受众前缀。** 同一个人可能在主站和后台都叫 ricky，
        # 不区分的话设备端会把两把钥匙显示成同一个账号，用户根本分不清。
        user_id=f"{audience}:{subject_id}".encode(),
        user_name=f"{username}（{'后台' if audience == 'admin' else '主站'}）",
        user_display_name=display_name,
        # 已经注册过的排除掉，免得在同一台设备上重复建。
        exclude_credentials=[
            PublicKeyCredentialDescriptor(id=item.credential_id) for item in existing
        ],
        authenticator_selection=AuthenticatorSelectionCriteria(
            # 可发现凭据：登录时不用先输用户名，点一下就能选账号。
            # 这正是「一键登录」的来源。
            resident_key=ResidentKeyRequirement.REQUIRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
    )
    challenge_id = await _issue_challenge(
        db, options.challenge, "register", audience, subject_id
    )
    return {"challengeId": challenge_id, "options": options_to_json(options)}


async def finish_registration(
    db: AsyncSession,
    settings: Settings,
    audience: Audience,
    subject_id: str,
    challenge_id: str,
    credential: dict[str, Any],
    label: str,
) -> WebAuthnCredential:
    rp_id, _, origins = _rp(settings)
    record = await _take_challenge(db, challenge_id, "register", audience)
    if record.subject_id != subject_id:
        raise PasskeyError("这次操作不属于当前账号")

    try:
        verified = verify_registration_response(
            credential=credential,
            expected_challenge=record.challenge,
            expected_rp_id=rp_id,
            expected_origin=origins,
            require_user_verification=True,
        )
    except Exception as exc:  # py_webauthn 抛的是一族异常，统一转成人话
        logger.warning("passkey 注册校验失败：%s", exc)
        raise PasskeyError("这把钥匙没能通过校验") from exc

    item = WebAuthnCredential(
        user_id=subject_id if audience == "user" else None,
        admin_id=subject_id if audience == "admin" else None,
        credential_id=verified.credential_id,
        public_key=verified.credential_public_key,
        sign_count=verified.sign_count,
        transports=[t for t in (credential.get("response", {}).get("transports") or [])],
        label=label[:80] or "未命名设备",
    )
    db.add(item)
    await db.flush()
    return item


# ── 登录 ──────────────────────────────────────────────────────────────────

async def begin_authentication(
    db: AsyncSession, settings: Settings, audience: Audience
) -> dict[str, Any]:
    """不带 allow_credentials：走可发现凭据，登录前我们并不知道来的是谁。"""
    rp_id, _, _ = _rp(settings)
    options = generate_authentication_options(
        rp_id=rp_id, user_verification=UserVerificationRequirement.REQUIRED
    )
    challenge_id = await _issue_challenge(db, options.challenge, "login", audience, None)
    return {"challengeId": challenge_id, "options": options_to_json(options)}


async def finish_authentication(
    db: AsyncSession,
    settings: Settings,
    audience: Audience,
    challenge_id: str,
    credential: dict[str, Any],
) -> WebAuthnCredential:
    rp_id, _, origins = _rp(settings)
    record = await _take_challenge(db, challenge_id, "login", audience)

    raw_id = base64url_to_bytes(credential.get("rawId") or credential.get("id", ""))
    stored = await db.scalar(
        select(WebAuthnCredential).where(WebAuthnCredential.credential_id == raw_id)
    )
    if stored is None:
        raise PasskeyError("这把钥匙没有登记过")

    owner_id = stored.user_id if audience == "user" else stored.admin_id
    if owner_id is None:
        # 拿主站的 passkey 来登后台（或反过来）。**这是要防的事，不是意外。**
        raise PasskeyError("这把钥匙不能用在这里")

    try:
        verified = verify_authentication_response(
            credential=credential,
            expected_challenge=record.challenge,
            expected_rp_id=rp_id,
            expected_origin=origins,
            credential_public_key=stored.public_key,
            credential_current_sign_count=stored.sign_count,
            require_user_verification=True,
        )
    except Exception as exc:
        logger.warning("passkey 登录校验失败：%s", exc)
        raise PasskeyError("验证没通过") from exc

    # **不能因为计数器没增长就拒绝。** 同步型 passkey（iCloud 钥匙串那种）
    # 多数恒为 0，按「必须递增」判会把正常用户全挡在外面。倒退才是可疑信号，
    # 那时候记一条日志——真要处置也该是人来决定，而不是在这里把人锁死。
    if verified.new_sign_count and verified.new_sign_count < stored.sign_count:
        logger.warning(
            "passkey %s 的签名计数倒退（%s → %s），可能是克隆",
            stored.id, stored.sign_count, verified.new_sign_count,
        )
    stored.sign_count = max(stored.sign_count, verified.new_sign_count)
    stored.last_used_at = utcnow()
    await db.flush()
    return stored


async def delete_credential(
    db: AsyncSession, audience: Audience, subject_id: str, credential_pk: str
) -> bool:
    item = await db.get(WebAuthnCredential, credential_pk)
    if item is None:
        return False
    owner = item.user_id if audience == "user" else item.admin_id
    if owner != subject_id:
        return False
    await db.delete(item)
    await db.flush()
    return True
