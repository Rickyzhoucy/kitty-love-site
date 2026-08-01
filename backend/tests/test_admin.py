"""后台的隔离、配置读写、密钥不外泄。

这些是安全相关的行为，**不能靠「看起来对」**：两套账号是不是真的互不通用、
密钥是不是真的不会被回传、越界的值是不是真的写不进去，都要有测试钉住。
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.admin_auth import ADMIN_COOKIE_NAME, set_admin_password
from app.auth import SESSION_COOKIE_NAME
from app.main import create_app
from app.db import get_session
from app.models import Admin, SiteConfig
from app import runtime_config


@pytest.fixture(autouse=True)
def _clear_config_cache():
    """每个用例前后都清缓存。

    `runtime_config` 的缓存是模块级的，用例之间会互相污染——上一个用例写进去
    的预算会被下一个用例读到，而那种失败查起来非常费时间。
    """
    runtime_config.invalidate_cache()
    yield
    runtime_config.invalidate_cache()


@pytest.fixture
async def admin_client(session_maker):
    """带一个已建好的后台账号的客户端。"""
    async with session_maker() as db:
        admin = Admin(username="boss", password="", status="active")
        set_admin_password(admin, "admin-password-123")
        db.add(admin)
        await db.commit()

    app = create_app()

    async def test_session():
        async with session_maker() as db:
            yield db

    app.dependency_overrides[get_session] = test_session
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client


async def _login(client: AsyncClient) -> None:
    response = await client.post(
        "/api/v1/admin/auth/login",
        json={"username": "boss", "password": "admin-password-123"},
    )
    assert response.status_code == 200, response.text


async def test_admin_login_sets_its_own_cookie(admin_client):
    """后台登录发的是 `kitty_admin`，**绝不能是主站那个 `kitty_session`**。

    共用一个 Cookie 名的后果是浏览器只存一份：后台登录会把主站会话顶掉，
    而且任意一边泄露就等于两边同时失守。
    """
    await _login(admin_client)
    assert ADMIN_COOKIE_NAME in admin_client.cookies
    assert SESSION_COOKIE_NAME not in admin_client.cookies


async def test_main_site_session_cannot_reach_admin(client):
    """拿主站账号登录后去调后台接口，必须 401。

    这正是改造前的问题：`/admin` 用的是主站账号，能看照片的人也能改模型配置。
    """
    login = await client.post(
        "/api/v1/auth/login",
        json={"username": "daniela", "password": "secret-password"},
    )
    assert login.status_code == 200
    assert SESSION_COOKIE_NAME in client.cookies

    response = await client.get("/api/v1/admin/config")
    assert response.status_code == 401


async def test_admin_session_cannot_reach_main_site_data(admin_client):
    """反过来也一样：后台会话不该能读主站的用户接口。"""
    await _login(admin_client)
    response = await admin_client.get("/api/v1/auth/me")
    assert response.status_code == 401


async def test_config_secrets_are_never_returned_in_plaintext(admin_client, session_maker):
    """写进去的 API Key，读回来只能是遮罩；**库里存的必须是密文**。"""
    await _login(admin_client)
    secret = "sk-super-secret-value-1234567890"

    written = await admin_client.patch(
        "/api/v1/admin/config", json={"values": {"chat.api_key": secret}}
    )
    assert written.status_code == 200

    payload = (await admin_client.get("/api/v1/admin/config")).json()
    entry = next(s for s in payload["settings"] if s["key"] == "chat.api_key")
    assert entry["value"] != secret
    assert entry["value"].startswith("sk-su") and entry["value"].endswith("7890")

    async with session_maker() as db:
        stored = await db.scalar(
            select(SiteConfig.value).where(
                SiteConfig.key == runtime_config.PREFIX + "chat.api_key"
            )
        )
    assert stored is not None
    assert secret not in stored, "密钥是明文存的，加密没生效"


async def test_blank_secret_means_keep_not_clear(admin_client, session_maker):
    """密钥留空 = 不改。

    前端拿不到明文，提交表单时也就没法原样回传。如果留空被当成「清空」，
    那么随便保存一次别的设置就会把所有密钥抹掉——而症状是模型调用突然
    401，跟这次保存看起来毫无关系。
    """
    await _login(admin_client)
    await admin_client.patch(
        "/api/v1/admin/config", json={"values": {"chat.api_key": "sk-keep-me-please"}}
    )
    runtime_config.invalidate_cache()

    await admin_client.patch(
        "/api/v1/admin/config",
        json={"values": {"chat.api_key": "", "chat.temperature": "0.8"}},
    )
    runtime_config.invalidate_cache()

    async with session_maker() as db:
        values = await runtime_config.load_all(db)
    assert values["chat.api_key"] == "sk-keep-me-please"
    assert values["chat.temperature"] == 0.8


async def test_out_of_range_values_are_rejected(admin_client):
    """越界的预算写不进去。

    填 0 会让宠物彻底哑掉、填 999999 会烧钱，而改造前那套纯字符串配置
    两个都收。
    """
    await _login(admin_client)
    response = await admin_client.patch(
        "/api/v1/admin/config", json={"values": {"pet.daily_call_budget": "999999"}}
    )
    assert response.status_code == 422
    assert "不能大于" in response.text


async def test_reset_falls_back_to_environment(admin_client, session_maker):
    """删掉覆盖之后回到 `.env` 的值，而不是留一个空字符串。"""
    await _login(admin_client)
    await admin_client.patch(
        "/api/v1/admin/config", json={"values": {"pet.daily_proactive_budget": "3"}}
    )
    runtime_config.invalidate_cache()
    async with session_maker() as db:
        assert (await runtime_config.load_all(db))["pet.daily_proactive_budget"] == 3

    await admin_client.post(
        "/api/v1/admin/config/reset", json={"keys": ["pet.daily_proactive_budget"]}
    )
    runtime_config.invalidate_cache()
    async with session_maker() as db:
        restored = (await runtime_config.load_all(db))["pet.daily_proactive_budget"]
    assert restored == runtime_config.BY_KEY["pet.daily_proactive_budget"].fallback


async def test_password_change_requires_the_current_one(admin_client):
    """会话可能是别人在你没锁屏的电脑上捡的，所以改密码要先验旧密码。"""
    await _login(admin_client)
    wrong = await admin_client.post(
        "/api/v1/admin/auth/password",
        json={"current_password": "not-it", "new_password": "brand-new-password"},
    )
    assert wrong.status_code == 403

    right = await admin_client.post(
        "/api/v1/admin/auth/password",
        json={"current_password": "admin-password-123", "new_password": "brand-new-password"},
    )
    assert right.status_code == 204


async def test_logout_revokes_every_admin_session(admin_client):
    """后台是高权限入口，登出要把其他设备一起踢掉。"""
    await _login(admin_client)
    assert (await admin_client.get("/api/v1/admin/config")).status_code == 200

    assert (await admin_client.post("/api/v1/admin/auth/logout")).status_code == 204
    # Cookie 被清掉了，而且服务端那条会话也已撤销。
    assert (await admin_client.get("/api/v1/admin/config")).status_code == 401


async def test_every_registry_entry_has_a_label_and_group():
    """注册表是后台表单的唯一数据源，缺字段的话页面上会出现一个没名字的输入框。"""
    for setting in runtime_config.REGISTRY:
        assert setting.label, f"{setting.key} 没有中文名"
        assert setting.group in runtime_config.GROUP_LABELS, f"{setting.key} 的分组没登记"
        if setting.kind in ("int", "float"):
            assert setting.minimum is not None and setting.maximum is not None, (
                f"{setting.key} 是数值型但没有上下限——越界值会直接写进库"
            )


# ── Passkey ───────────────────────────────────────────────────────────────

async def test_passkey_challenge_is_single_use(session_maker):
    """挑战值用一次就作废。**这是防重放的前提**——能重复使用的挑战等于没有。"""
    from app.config import Settings
    from app import passkeys

    settings = Settings(session_secret="x" * 40)
    async with session_maker() as db:
        payload = await passkeys.begin_authentication(db, settings, "user")
        await db.commit()
        challenge_id = payload["challengeId"]

    async with session_maker() as db:
        # 第一次取：取到了（这里用不合法的凭据，所以会在校验那步失败，
        # 但挑战本身已经被消费掉了）。
        with pytest.raises(passkeys.PasskeyError):
            await passkeys.finish_authentication(
                db, settings, "user", challenge_id, {"rawId": "AAAA"}
            )
        await db.commit()

    async with session_maker() as db:
        # 第二次取：连挑战都找不到了。
        with pytest.raises(passkeys.PasskeyError, match="已经失效"):
            await passkeys.finish_authentication(
                db, settings, "user", challenge_id, {"rawId": "AAAA"}
            )


async def test_passkey_challenge_is_bound_to_its_audience(session_maker):
    """主站签发的挑战不能拿去后台用，反过来也一样。

    两套账号体系的隔离必须贯穿到挑战这一层——只在 Cookie 和会话表上隔离，
    而挑战通用的话，就留了一条把主站凭据兑换成后台会话的路。
    """
    from app.config import Settings
    from app import passkeys

    settings = Settings(session_secret="x" * 40)
    async with session_maker() as db:
        payload = await passkeys.begin_authentication(db, settings, "user")
        await db.commit()

    async with session_maker() as db:
        with pytest.raises(passkeys.PasskeyError, match="已经失效"):
            await passkeys.finish_authentication(
                db, settings, "admin", payload["challengeId"], {"rawId": "AAAA"}
            )


async def test_passkey_endpoints_need_a_session(client, admin_client):
    """注册接口要登录态；登录接口不要（还没登录呢）。"""
    assert (await client.post("/api/v1/auth/passkey/register/begin")).status_code == 401
    assert (await admin_client.post(
        "/api/v1/admin/auth/passkey/register/begin"
    )).status_code == 401

    # 登录用的挑战是公开的，任何人都能要一个——拿到也没用，
    # 没有对应的私钥就过不了校验。
    assert (await client.post("/api/v1/auth/passkey/login/begin")).status_code == 200
    assert (await admin_client.post(
        "/api/v1/admin/auth/passkey/login/begin"
    )).status_code == 200


async def test_registration_options_use_discoverable_credentials(session_maker):
    """必须是可发现凭据，否则登录时要先输用户名——那就不是「一键」了。"""
    import json
    from app.config import Settings
    from app import passkeys

    settings = Settings(session_secret="x" * 40)
    async with session_maker() as db:
        payload = await passkeys.begin_registration(
            db, settings, "user", "u1", "ricky", "Ricky"
        )
    options = json.loads(payload["options"])
    assert options["authenticatorSelection"]["residentKey"] == "required"
    assert options["authenticatorSelection"]["userVerification"] == "required"
    # 用户句柄带受众前缀，否则设备端会把主站和后台的钥匙显示成同一个账号。
    assert options["user"]["name"].endswith("（主站）")
