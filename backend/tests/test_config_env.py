"""环境变量到 Settings 的解析。

这里钉的是**部署时才会暴露的那类错误**：本地开发全用默认值，跑一万次测试也
碰不到；等到在生产的 .env 里写下第一个真实域名，容器起不来。
"""

from __future__ import annotations

import pytest

from app.config import Settings


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        # 最自然的写法。**改动之前这一行会让整个 API 起不来**——
        # pydantic-settings 拿 list[str] 当复合类型，先做 JSON 解码，
        # 而 `https://…` 不是合法 JSON，抛的是 SettingsError，
        # 发生在 Settings 构造期，FastAPI 根本没机会启动。
        ("https://love.rickyai.cn", ["https://love.rickyai.cn"]),
        # 多个来源，逗号后面允许有空格（谁都会顺手敲一个）。
        (
            "https://love.rickyai.cn, https://www.love.rickyai.cn",
            ["https://love.rickyai.cn", "https://www.love.rickyai.cn"],
        ),
        # JSON 写法继续支持：已经这么写的 .env 不该因为这次改动失效。
        ('["https://love.rickyai.cn"]', ["https://love.rickyai.cn"]),
        # 留空 = 一个都不允许，而不是报错。
        ("", []),
    ],
)
def test_origin_lists_accept_plain_env_strings(monkeypatch, raw, expected):
    for name in ("WEBAUTHN_ORIGINS", "CORS_ORIGINS"):
        monkeypatch.setenv(name, raw)
    settings = Settings(session_secret="x" * 40)
    assert settings.webauthn_origins == expected
    assert settings.cors_origins == expected


def test_webauthn_rp_id_comes_from_the_environment(monkeypatch):
    """RP ID 必须能被环境变量覆盖，而且要真的传进容器。

    配错的表现是**弹窗一闪而过、什么都不说**——所以这里既验证字段能被覆盖，
    也在 compose 那侧（见 docker-compose.yml 的 backend-environment）把它传下去。
    """
    monkeypatch.setenv("WEBAUTHN_RP_ID", "love.rickyai.cn")
    assert Settings(session_secret="x" * 40).webauthn_rp_id == "love.rickyai.cn"


def test_defaults_are_localhost_for_development():
    """默认值要能让本地开发直接跑起来，不用先配一堆东西。"""
    settings = Settings(session_secret="x" * 40)
    assert settings.webauthn_rp_id == "localhost"
    assert settings.webauthn_origins == ["http://localhost:3000"]
