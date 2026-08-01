"""可以在后台改、不用重新部署的那些设置。

## 这个模块存在的理由

改一个模型名、调一下宠物每天最多说几次话、换一个 API Key——在这之前，每一项
都要改 `.env` 或改代码、重新构建镜像、重新部署。对一个两个人用的站来说，这个
代价荒谬。

## 一份注册表驱动全部

设置项有四十多个。**不为每一项手写一个表单控件**，而是在这里声明它的类型、
范围、分组和说明，后台那边据此自动渲染，接口据此自动校验。加一个设置项 =
在 `REGISTRY` 里加一行，前后端都不用动。

这也顺带解决了一个老问题：`site_config.EDITABLE_KEYS` 是个纯字符串集合，
没有类型也没有范围。预算填 `0` 会让宠物彻底哑掉，填 `999999` 会烧钱，而
原来的代码两个都收。

## 覆盖关系：环境变量是底，数据库是面

每一项的默认值来自 `Settings`（也就是 `.env`），后台改过的值存进 `SiteConfig`
盖在上面。**没改过就一定跟着环境变量走**，所以部署时的配置仍然有效，后台只是
多了一层可选的覆盖。删掉覆盖（reset）就回到环境变量。

## 密钥：加密落库，只写不读

`SECRET` 类型的项用 Fernet 加密后存库，密钥由 `SESSION_SECRET` 派生。接口
**永远不回传明文**，只回传一个遮罩（`sk-w••••1a2b`）。这样：

- 拿到数据库转储的人，没有 `SESSION_SECRET` 解不开；
- 后台页面本身也看不到完整值，减少肩窥和截图泄露；
- 宠物自己能跑 Python（skill-worker），万一它读到了这张表，读到的也是密文。

**这不是万能的**：能读环境变量的人（比如进了容器）依然能拿到 `SESSION_SECRET`
从而解密。它挡的是「数据库泄露」这一类，不是「服务器被拿下」。

## 缓存

这些值在热路径上被读（每次宠物思考都要看预算），不能每次都查库。进程内缓存
`CACHE_TTL_SECONDS` 秒。**故意不做跨进程的即时失效**：api / worker /
skill-worker 是三个进程，做广播要引入额外机制，而「改完最多 10 秒生效」对
一个两人小站完全够用。写入方会清掉自己进程的缓存，所以后台自己看到的是即时的。
"""

from __future__ import annotations

import base64
import hashlib
import logging
import time as time_module
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import time
from typing import Any, Literal

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.models import SiteConfig, SiteConfigHistory
from app.site_config import RUNTIME_PREFIX as SITE_CONFIG_RUNTIME_PREFIX

logger = logging.getLogger(__name__)

Kind = Literal["str", "text", "int", "float", "bool", "time", "choice", "secret"]

#: 进程内缓存的存活时间。见模块文档里关于「不做跨进程失效」的说明。
CACHE_TTL_SECONDS = 10.0

#: 后台设置项在 `SiteConfig` 里的键前缀。**不能省**：那张表里还住着
#: `letter_title` / `main_timer_date` 这些内容类配置，混在一起以后分不清
#: 哪些该出现在后台的「系统」页、哪些属于主站内容。
#:
#: 主站的 `/config` 接口靠这个前缀把系统配置**排除**掉，所以两处必须是同一个
#: 值——从 site_config 引进来，而不是各写一遍字符串。
PREFIX = SITE_CONFIG_RUNTIME_PREFIX


@dataclass(frozen=True)
class Setting:
    """一个可在后台修改的设置项。"""

    key: str
    group: str
    label: str
    kind: Kind
    #: 从 `Settings` 上取默认值的属性名。为 None 表示默认值是下面的 `fallback`。
    env_attr: str | None = None
    fallback: Any = None
    minimum: float | None = None
    maximum: float | None = None
    choices: tuple[str, ...] = ()
    help: str = ""
    #: 改了要重启进程才生效的项。UI 会标出来，免得改完以为没生效。
    restart_required: bool = False

    def default(self, settings: Settings) -> Any:
        if self.env_attr is not None:
            return getattr(settings, self.env_attr)
        return self.fallback


def _group(name: str, *settings: Setting) -> tuple[Setting, ...]:
    """把一组设置项打上同一个分组名，省得每行都写一遍。"""
    return tuple(
        Setting(**{**item.__dict__, "group": name}) for item in settings
    )


def _s(key: str, label: str, kind: Kind, **kwargs: Any) -> Setting:
    return Setting(key=key, group="", label=label, kind=kind, **kwargs)


REGISTRY: tuple[Setting, ...] = (
    # ── 对话模型 ───────────────────────────────────────────────────────────
    *_group(
        "chat",
        _s("chat.model", "模型名", "str", env_attr="chat_model",
           help="宠物用来说话和思考的模型。"),
        _s("chat.base_url", "接口地址", "str", env_attr="chat_base_url",
           help="OpenAI 兼容的 /v1 端点。"),
        _s("chat.api_key", "API Key", "secret", env_attr="chat_api_key",
           help="加密存储，保存后不再显示完整值。留空表示沿用环境变量里的。"),
        _s("chat.temperature", "温度", "float", env_attr="chat_temperature",
           minimum=0.0, maximum=2.0,
           help="越高越发散。宠物是陪伴角色，建议 0.6–0.9。"),
        _s("chat.timeout", "超时（秒）", "float", env_attr="chat_timeout",
           minimum=5.0, maximum=600.0),
        _s("chat.context_tokens", "上下文窗口", "int", env_attr="chat_context_tokens",
           minimum=8_000, maximum=4_000_000,
           help="**填模型真实支持的值**。填大了会在对话变长后突然报错，"
                "填小了会过早触发压缩、白白丢掉上下文。"),
        _s("chat.compact_at", "压缩触发点", "float", env_attr="chat_compact_at",
           minimum=0.2, maximum=0.95,
           help="用掉上下文窗口的这个比例时开始压缩历史。"),
        _s("chat.compact_keep_messages", "压缩时保留最近几条", "int",
           env_attr="chat_compact_keep_messages", minimum=4, maximum=200),
    ),
    # ── 向量与检索 ─────────────────────────────────────────────────────────
    *_group(
        "embedding",
        _s("embedding.model", "向量模型", "str", env_attr="embedding_model",
           restart_required=True,
           help="**换模型等于换向量空间**。已有记忆的向量是用旧模型算的，"
                "换了之后新旧不可比，检索会明显变差——换之前要有重算的打算。"),
        _s("embedding.base_url", "接口地址", "str", env_attr="embedding_base_url",
           restart_required=True),
        _s("embedding.api_key", "API Key", "secret", env_attr="embedding_api_key",
           restart_required=True),
        _s("embedding.dimensions", "向量维度", "int", env_attr="embedding_dimensions",
           minimum=64, maximum=4096, restart_required=True,
           help="**改这个会让已存的向量全部作废**（列宽对不上）。"
                "只有在换模型且准备重算全部记忆时才动。"),
    ),
    # ── 联网 ───────────────────────────────────────────────────────────────
    *_group(
        "web",
        _s("web.search_provider", "搜索服务", "choice",
           env_attr="web_search_provider", choices=("bocha", "none"),
           help="选 none 就是关掉联网搜索，宠物只能靠站内数据回答。"),
        _s("web.search_api_key", "搜索 API Key", "secret",
           env_attr="web_search_api_key"),
        _s("web.search_max_results", "搜索结果条数", "int",
           env_attr="web_search_max_results", minimum=1, maximum=30),
        _s("web.search_timeout", "搜索超时（秒）", "float",
           env_attr="web_search_timeout", minimum=2.0, maximum=60.0),
        _s("web.fetch_timeout", "抓网页超时（秒）", "float",
           env_attr="web_fetch_timeout", minimum=2.0, maximum=60.0),
        _s("web.fetch_max_chars", "网页正文最多取多少字", "int",
           env_attr="web_fetch_max_chars", minimum=1_000, maximum=200_000),
    ),
    # ── 宠物的节奏与预算 ───────────────────────────────────────────────────
    *_group(
        "pet",
        _s("pet.daily_call_budget", "每天最多思考多少次", "int",
           fallback=200, minimum=10, maximum=5_000,
           help="每天调用模型的上限，用尽后当天只做兜底回应。"
                "**这是花钱的闸门**，调高之前先看清单价。"),
        _s("pet.daily_proactive_budget", "每天最多主动说几次", "int",
           fallback=12, minimum=0, maximum=100,
           help="填 0 就是完全不主动说话，只在你叫它时回应。"),
        _s("pet.min_proactive_gap_seconds", "两次主动之间至少隔（秒）", "int",
           fallback=600, minimum=30, maximum=86_400,
           help="防止它在短时间里连着说好几句。"),
        _s("pet.debounce_seconds", "思考防抖（秒）", "float",
           fallback=5.0, minimum=0.5, maximum=60.0,
           help="连续动作合并成一次思考的窗口。调小更灵敏但更费钱。"),
        _s("pet.quiet_start", "静默开始", "time", fallback="23:00",
           help="这段时间里不主动打扰。纪念日当天可以突破，唠叨不行。"),
        _s("pet.quiet_end", "静默结束", "time", fallback="08:00"),
        _s("pet.nudge_schedule_minutes", "催看消息的节奏（分钟）", "str",
           fallback="0,10,30",
           help="逗号分隔。**递减而非递增**——催三次之后就不再提了，"
                "免得变成骚扰。留空表示不催。"),
        _s("pet.standin_after_minutes", "对方多久没回，它才替你说话（分钟）", "int",
           fallback=30, minimum=1, maximum=1_440),
        _s("pet.assist_context_messages", "@它时带上最近几条聊天", "int",
           fallback=14, minimum=2, maximum=60,
           help="太少它接不上话，太多每次都在烧 token。"),
    ),
    # ── 记忆 ───────────────────────────────────────────────────────────────
    *_group(
        "memory",
        _s("memory.near_duplicate_threshold", "去重相似度阈值", "float",
           fallback=0.55, minimum=0.1, maximum=0.99,
           help="新记忆与旧记忆相似度超过它就并成一条。"
                "调低会记得更少但更干净，调高会攒下很多重复。"),
        _s("memory.near_duplicate_scan", "去重时比对最近几条", "int",
           fallback=60, minimum=5, maximum=500),
        _s("memory.recency_half_life_days", "新鲜度半衰期（天）", "float",
           fallback=180.0, minimum=7.0, maximum=3_650.0,
           help="越久远的记忆权重越低，这是衰减到一半所需的天数。"),
        _s("memory.min_recency_weight", "最低权重", "float",
           fallback=0.35, minimum=0.0, maximum=1.0,
           help="再久远的记忆也不会低于这个权重——有些事就是不会过期。"),
    ),
    # ── 安全 ───────────────────────────────────────────────────────────────
    *_group(
        "security",
        _s("security.session_ttl_days", "登录有效期（天）", "int",
           env_attr="session_ttl_days", minimum=1, maximum=365,
           help="改小不会踢掉已登录的会话，只影响之后新建的。"
                "要立刻踢人请去「账号」页撤销会话。"),
        _s("security.login_max_failures", "登录失败几次后锁定", "int",
           fallback=10, minimum=3, maximum=100),
        _s("security.login_window_minutes", "失败计数窗口（分钟）", "int",
           fallback=15, minimum=1, maximum=1_440),
    ),
    # ── 上传 ───────────────────────────────────────────────────────────────
    *_group(
        "upload",
        _s("upload.max_bytes", "单个文件上限（字节）", "int",
           env_attr="max_upload_bytes", minimum=1_048_576, maximum=2_147_483_648),
        _s("upload.presign_seconds", "下载链接有效期（秒）", "int",
           env_attr="minio_presign_seconds", minimum=60, maximum=86_400),
    ),
    # ── 站点 ───────────────────────────────────────────────────────────────
    *_group(
        "site",
        _s("site.timezone", "时区", "str", env_attr="site_timezone",
           restart_required=True,
           help="影响「今天」「深夜」的判断。**容器的 TZ 要一起改**，"
                "否则定时任务的时间和这里对不上（见 docker-compose 里的注释）。"),
        _s("site.hero_video_attachment", "首页视频", "str", fallback="",
           help="留空表示用镜像里自带的那份。通过「首页素材」页上传。"),
        _s("site.hero_poster_attachment", "首页静态图", "str", fallback=""),
        _s("site.webauthn_rp_id", "Passkey 域名（RP ID）", "str",
           env_attr="webauthn_rp_id", restart_required=True,
           help="**必须和地址栏里的域名一致**（或是它的父域）。配错的表现是"
                "弹窗一闪而过、什么都没发生。本地开发填 localhost。"),
    ),
)

BY_KEY: dict[str, Setting] = {item.key: item for item in REGISTRY}

GROUP_LABELS: dict[str, str] = {
    "chat": "对话模型",
    "embedding": "向量与检索",
    "web": "联网",
    "pet": "宠物的节奏与预算",
    "memory": "记忆",
    "security": "安全",
    "upload": "上传",
    "site": "站点",
}

assert set(GROUP_LABELS) == {item.group for item in REGISTRY}, "有分组没起中文名"


# ── 密钥的加解密 ──────────────────────────────────────────────────────────

def _fernet(settings: Settings) -> Fernet:
    """从 `SESSION_SECRET` 派生一把 Fernet 密钥。

    用 SHA-256 而不是直接截取：session_secret 的长度和字符集不受控，
    Fernet 要的是恰好 32 字节。加盐是为了让这把钥匙和会话签名用的那把
    在密码学上无关——同一个 secret 派生出的两个用途不该互相泄露。
    """
    digest = hashlib.sha256(b"runtime-config-v1|" + settings.session_secret.encode())
    return Fernet(base64.urlsafe_b64encode(digest.digest()))


def encrypt_secret(raw: str, settings: Settings) -> str:
    return _fernet(settings).encrypt(raw.encode()).decode()


def decrypt_secret(stored: str, settings: Settings) -> str | None:
    """解不开就返回 None。

    解不开通常意味着 `SESSION_SECRET` 换过了——那时候**要的是回退到环境变量**，
    而不是把一串密文当成 API Key 发出去（那会让模型调用以一个看不懂的
    401 失败，排查半天）。
    """
    try:
        return _fernet(settings).decrypt(stored.encode()).decode()
    except (InvalidToken, ValueError):
        logger.warning("配置里的密钥解不开，可能是 SESSION_SECRET 变过；回退到环境变量")
        return None


def mask_secret(raw: str) -> str:
    """给前端看的遮罩。保留头尾是为了能认出「是不是我想的那把钥匙」。"""
    if not raw:
        return ""
    if len(raw) <= 10:
        return "••••"
    return f"{raw[:5]}••••{raw[-4:]}"


# ── 取值 ──────────────────────────────────────────────────────────────────

_cache: dict[str, Any] = {}
_cache_at: float = 0.0


def invalidate_cache() -> None:
    global _cache_at
    _cache_at = 0.0


def _coerce(setting: Setting, raw: str) -> Any:
    if setting.kind in ("int",):
        return int(raw)
    if setting.kind in ("float",):
        return float(raw)
    if setting.kind == "bool":
        return raw.lower() in ("1", "true", "yes", "on")
    if setting.kind == "time":
        hour, _, minute = raw.partition(":")
        return time(int(hour), int(minute or 0))
    return raw


def _clamp(setting: Setting, value: Any) -> Any:
    """**越界就夹住，不抛异常。**

    这段代码跑在读取路径上，而写入路径已经校验过一次。真会走到这里的情况是
    「注册表的范围后来收紧了，而库里还留着旧值」——那时候夹到边界是对的，
    让宠物因为一个历史值而整个崩掉不是。
    """
    if setting.minimum is not None and value < setting.minimum:
        return type(value)(setting.minimum)
    if setting.maximum is not None and value > setting.maximum:
        return type(value)(setting.maximum)
    return value


async def load_all(db: AsyncSession, settings: Settings | None = None) -> dict[str, Any]:
    """全部设置项的当前取值（数据库覆盖盖在环境变量上）。密钥是解密后的明文。"""
    global _cache, _cache_at
    now = time_module.monotonic()
    if _cache and now - _cache_at < CACHE_TTL_SECONDS:
        return _cache

    settings = settings or get_settings()
    rows = dict(
        (await db.execute(
            select(SiteConfig.key, SiteConfig.value).where(
                SiteConfig.key.startswith(PREFIX)
            )
        )).all()
    )

    resolved: dict[str, Any] = {}
    for setting in REGISTRY:
        stored = rows.get(PREFIX + setting.key)
        if stored is None or stored == "":
            resolved[setting.key] = setting.default(settings)
            continue
        if setting.kind == "secret":
            plain = decrypt_secret(stored, settings)
            resolved[setting.key] = plain if plain is not None else setting.default(settings)
            continue
        try:
            resolved[setting.key] = _clamp(setting, _coerce(setting, stored))
        except (TypeError, ValueError):
            logger.warning("配置 %s 的存值 %r 解析不了，回退默认", setting.key, stored)
            resolved[setting.key] = setting.default(settings)

    _cache, _cache_at = resolved, now
    return resolved


async def get(db: AsyncSession, key: str) -> Any:
    if key not in BY_KEY:
        raise KeyError(f"未注册的配置项：{key}")
    return (await load_all(db))[key]


def snapshot() -> dict[str, Any]:
    """给**同步代码**用的最近一次取值。

    认知队列、静默时段判断这些跑在没有数据库会话的同步路径上，拿不到
    `await load_all(db)`。它们读这个快照——由任何一次 `load_all` 顺带填上。

    **进程刚起来、还没人查过库时返回的是环境变量默认值**，这正是想要的：
    宁可用部署时的配置先跑起来，也不能因为「还没加载」就崩掉或用零值。
    代价是后台改完之后，这些同步路径最多滞后 `CACHE_TTL_SECONDS` 秒生效。
    """
    if _cache:
        return _cache
    settings = get_settings()
    return {item.key: item.default(settings) for item in REGISTRY}


def live(key: str) -> Any:
    """`snapshot()[key]` 的简写，带一个「这个键必须注册过」的断言。"""
    if key not in BY_KEY:
        raise KeyError(f"未注册的配置项：{key}")
    return snapshot()[key]


# ── 写入 ──────────────────────────────────────────────────────────────────

class ValidationError(ValueError):
    pass


def validate(setting: Setting, raw: str) -> str:
    """把前端传来的字符串校验一遍，返回**要落库的字符串**。"""
    raw = raw.strip()
    if setting.kind == "choice":
        if raw not in setting.choices:
            raise ValidationError(f"{setting.label} 只能是 {'、'.join(setting.choices)}")
        return raw
    if setting.kind == "time":
        try:
            hour, _, minute = raw.partition(":")
            time(int(hour), int(minute or 0))
        except (TypeError, ValueError) as exc:
            raise ValidationError(f"{setting.label} 要写成 HH:MM") from exc
        return raw
    if setting.kind in ("int", "float"):
        try:
            value = int(raw) if setting.kind == "int" else float(raw)
        except ValueError as exc:
            raise ValidationError(f"{setting.label} 要填数字") from exc
        if setting.minimum is not None and value < setting.minimum:
            raise ValidationError(f"{setting.label} 不能小于 {setting.minimum:g}")
        if setting.maximum is not None and value > setting.maximum:
            raise ValidationError(f"{setting.label} 不能大于 {setting.maximum:g}")
        return str(value)
    return raw


async def set_many(
    db: AsyncSession,
    updates: dict[str, str],
    settings: Settings | None = None,
) -> list[str]:
    """批量写入。返回实际改动的键。

    **全部校验通过才写**，不做「一半成功一半失败」——配置项之间是有关联的
    （比如静默开始和结束），写一半会留下一个自相矛盾的状态。
    """
    settings = settings or get_settings()
    prepared: dict[str, str] = {}
    for key, raw in updates.items():
        setting = BY_KEY.get(key)
        if setting is None:
            raise ValidationError(f"未注册的配置项：{key}")
        if setting.kind == "secret":
            # 空字符串 = 「不改」。前端拿不到明文，提交时也就没法原样回传，
            # 所以留空必须解释成保持不变，否则一次保存会把所有密钥清掉。
            if not raw:
                continue
            prepared[key] = encrypt_secret(raw.strip(), settings)
            continue
        prepared[key] = validate(setting, raw)

    changed: list[str] = []
    for key, value in prepared.items():
        storage_key = PREFIX + key
        existing = await db.get(SiteConfig, storage_key)
        if existing is None:
            db.add(SiteConfig(key=storage_key, value=value))
        elif existing.value != value:
            db.add(SiteConfigHistory(key=storage_key, value=existing.value))
            existing.value = value
        else:
            continue
        changed.append(key)

    if changed:
        await db.flush()
        invalidate_cache()
    return changed


async def reset(db: AsyncSession, keys: Iterable[str]) -> list[str]:
    """删掉覆盖，回到环境变量里的值。"""
    removed = []
    for key in keys:
        if key not in BY_KEY:
            raise ValidationError(f"未注册的配置项：{key}")
        result = await db.execute(
            delete(SiteConfig).where(SiteConfig.key == PREFIX + key)
        )
        if result.rowcount:
            removed.append(key)
    if removed:
        await db.flush()
        invalidate_cache()
    return removed


async def describe(db: AsyncSession, settings: Settings | None = None) -> list[dict[str, Any]]:
    """给后台渲染表单用的完整描述：定义 + 当前值 + 是否被覆盖过。"""
    settings = settings or get_settings()
    values = await load_all(db, settings)
    overridden = {
        row[0].removeprefix(PREFIX)
        for row in (await db.execute(
            select(SiteConfig.key).where(SiteConfig.key.startswith(PREFIX))
        )).all()
    }

    out = []
    for setting in REGISTRY:
        value = values[setting.key]
        out.append({
            "key": setting.key,
            "group": setting.group,
            "groupLabel": GROUP_LABELS[setting.group],
            "label": setting.label,
            "kind": setting.kind,
            "help": setting.help,
            "minimum": setting.minimum,
            "maximum": setting.maximum,
            "choices": list(setting.choices),
            "restartRequired": setting.restart_required,
            "overridden": setting.key in overridden,
            # 密钥只给遮罩。见模块文档。
            "value": mask_secret(value) if setting.kind == "secret" else _as_json(value),
        })
    return out


def _as_json(value: Any) -> Any:
    return value.strftime("%H:%M") if isinstance(value, time) else value
