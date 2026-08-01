"""`/config` 只能发出该发的那几个键。

这条接口任何登录用户都能读，而 `SiteConfig` 表里混着别的东西——后台的系统
配置、旧版 Prisma 后台留下的历史行。**过滤方向必须是白名单**：漏登记的键
读不到是看得见的故障，而漏排除的键会把密钥发到浏览器。
"""

from __future__ import annotations

from app import site_config
from app.models import SiteConfig


async def test_only_whitelisted_keys_are_returned(session_maker):
    """表里塞满不该外发的东西，`/config` 也只认白名单里那几个。

    这三个 `openai_*` 不是假想出来的：旧版 Prisma 后台真的往这张表写过，
    而迁移是原地 stamp 接管的，所以生产库里**至今还躺着一个明文的模型
    API Key**。改成白名单之前，它会随着首页那次 `/config` 一起发给浏览器。
    """
    async with session_maker() as db:
        db.add_all([
            SiteConfig(key="main_timer_date", value="2025-11-30"),
            SiteConfig(key="letter_title", value="致我最爱的人"),
            # 旧后台的遗留行
            SiteConfig(key="openai_api_key", value="sk-this-must-never-leave-the-server"),
            SiteConfig(key="openai_base_url", value="https://api.example.com/v1"),
            SiteConfig(key="openai_model", value="some-model"),
            # 新后台的系统配置（加密后的），也不该出现在这里
            SiteConfig(key="cfg.chat.api_key", value="gAAAAA-encrypted-blob"),
        ])
        await db.commit()

    async with session_maker() as db:
        values = await site_config.load(db)

    assert set(values) <= site_config.EDITABLE_KEYS, (
        f"发出了白名单之外的键：{sorted(set(values) - site_config.EDITABLE_KEYS)}"
    )
    serialised = repr(values)
    assert "sk-this-must-never-leave-the-server" not in serialised
    assert "gAAAAA-encrypted-blob" not in serialised
    # 正常内容照常返回
    assert values["main_timer_date"] == "2025-11-30"
    assert values["letter_title"] == "致我最爱的人"


async def test_defaults_fill_in_missing_keys(session_maker):
    """没存过的键回落到默认值，而不是干脆不出现。"""
    async with session_maker() as db:
        values = await site_config.load(db)
    assert values["main_timer_date"] == site_config.DEFAULTS["main_timer_date"]


async def test_returned_keys_are_all_writable_back(session_maker):
    """GET 回来的东西必须能原样 PUT 回去。

    前端「改在一起的日子」是把整个 config 展开后回传的。只要 load() 发出
    一个 EDITABLE_KEYS 之外的键，那次保存就会 422——而且报的是一个用户
    根本没碰过的配置项。
    """
    async with session_maker() as db:
        db.add(SiteConfig(key="openai_api_key", value="sk-leftover"))
        await db.commit()

    async with session_maker() as db:
        values = await site_config.load(db)

    unknown = set(values) - site_config.EDITABLE_KEYS
    assert not unknown, f"这些键会让整体回传 422：{sorted(unknown)}"
