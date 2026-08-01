from functools import lru_cache
from typing import Annotated

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

#: 用逗号分隔的列表型配置。
#:
#: **`NoDecode` 不能省。** pydantic-settings 默认拿 `list[str]` 当复合类型，
#: 会先对环境变量做一次 JSON 解码，**在任何 validator 之前**。也就是说
#: `WEBAUTHN_ORIGINS=https://love.rickyai.cn` 这种最自然的写法会直接抛
#: `SettingsError`——而那是在 Settings 构造期，FastAPI 起不来，**整个站 502**，
#: 不只是 passkey 用不了。要写成 `["https://love.rickyai.cn"]` 才行，可没人会
#: 在 .env 里写 JSON。加上 `NoDecode` 把原始字符串交给下面的 validator，
#: 逗号分隔和 JSON 两种写法就都收。
CommaSeparated = Annotated[list[str], NoDecode]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Kitty Love Companion API"
    app_env: str = "development"
    api_prefix: str = "/api/v1"
    database_url: str = "postgresql+asyncpg://kitty:kitty@localhost:5432/kitty"

    session_secret: str = Field(
        default="development-only-session-secret-change-me",
        min_length=32,
    )
    session_ttl_days: int = 30
    session_cookie_secure: bool = False

    minio_endpoint: str = "localhost:9000"
    minio_public_endpoint: str = "localhost:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "development-only"
    #: 后端连 MinIO 用不用 TLS。容器之间走内网明文，这里通常是 false。
    minio_secure: bool = False
    #: **浏览器**连 MinIO 用不用 TLS。与上面那个刻意分开：
    #:
    #: 预签名 URL 是给浏览器用的，它的 host 和协议必须是浏览器能访问到的。
    #: 生产上后端走 `minio:9000` 明文、浏览器走 `https://域名` 由 Caddy 反代，
    #: 两者不可能是同一个值。合成一个字段的后果是：要么内网连接被强上 TLS
    #: 而 MinIO 没开，要么签出来的链接是 http 而站点是 https（浏览器拦混合内容）。
    minio_public_secure: bool = False
    minio_region: str = "us-east-1"
    minio_user_bucket: str = "user-uploads"
    minio_derived_bucket: str = "derived-assets"
    minio_presign_seconds: int = 900
    max_upload_bytes: int = 50 * 1024 * 1024
    chat_attachment_inline_bytes: int = 10 * 1024 * 1024
    chat_text_attachment_bytes: int = 512 * 1024
    attachment_extracted_text_chars: int = 200_000
    attachment_max_pdf_pages: int = 200
    attachment_max_office_uncompressed_bytes: int = 100 * 1024 * 1024
    attachment_max_workbook_sheets: int = 32
    attachment_max_workbook_rows: int = 20_000
    attachment_max_workbook_cells: int = 200_000

    #: 这两个人所在的时区。**所有「今天」「深夜」都按它算，不按容器时区算。**
    #: 容器跑在 UTC，改这个不需要动容器；详见 app/localtime.py。
    site_timezone: str = "Asia/Shanghai"

    # ── Passkey（WebAuthn）─────────────────────────────────────────────
    #
    # **RP ID 必须和浏览器地址栏里的域名一致**（或是它的父域）。配错的表现是
    # 弹窗一闪而过、什么都没发生，控制台也未必说清楚——所以它是显式配置，不猜。
    # 本地开发用 localhost（WebAuthn 把 localhost 当安全上下文，不需要 https）。
    webauthn_rp_id: str = "localhost"
    #: 设备端的账号选择器里显示的名字。
    webauthn_rp_name: str = "我们的小世界"
    #: 允许的来源。**要带协议和端口**，与浏览器发来的 Origin 逐字比较。
    #: 生产上是 https://love.rickyai.cn，本地是 http://localhost:3000。
    webauthn_origins: CommaSeparated = ["http://localhost:3000"]

    outbox_poll_seconds: float = 1.0
    outbox_retention_days: int = Field(default=7, ge=1, le=90)
    cors_origins: CommaSeparated = ["http://localhost:3000"]

    chat_model: str = "qwen3.6-flash"
    chat_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    chat_api_key: str = ""
    chat_temperature: float = 0.7
    chat_timeout: float = 60.0

    #: 模型的上下文预算（token）。换模型时改这一个值即可。
    chat_context_tokens: int = Field(default=256_000, ge=8_000, le=4_000_000)
    #: 用掉这个比例就触发压缩。留一截余量：压缩本身也要把历史发给模型，
    #: 卡到 100% 再动手的话，那一次调用自己就会超长。
    chat_compact_at: float = Field(default=0.75, gt=0.1, le=0.95)
    #: 压缩后原样保留的最近消息条数。太少会把刚说的事也摘掉，
    #: 用户会感觉宠物「刚说完就忘」。
    chat_compact_keep_messages: int = Field(default=20, ge=4, le=200)
    checkpointer_pool_min_size: int = Field(default=2, ge=1, le=20)
    checkpointer_pool_max_size: int = Field(default=12, ge=1, le=50)

    embedding_model: str = "text-embedding-v4"
    embedding_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    embedding_api_key: str = ""
    embedding_dimensions: int = 1024

    # 联网能力。没有 web_search_api_key 时 web_search 工具不会注册——
    # 宁可少一个能力，也不要一个调用时才失败的工具。
    web_search_provider: str = "bocha"
    web_search_api_key: str = ""
    web_search_max_results: int = 8
    web_search_timeout: float = 12.0
    web_fetch_timeout: float = 12.0
    web_fetch_max_bytes: int = 2 * 1024 * 1024
    web_fetch_max_chars: int = 12_000
    web_fetch_user_agent: str = "KittyCompanionBot/1.0 (+private companion site)"

    skill_bucket: str = "skill-packages"
    skill_cache_dir: str = "/tmp/kitty-skill-cache"
    skill_worker_cache_dir: str = "/tmp/kitty-skill-worker-cache"
    skill_worker_url: str = "http://skill-worker:8010"
    skill_worker_token: str = Field(
        default="development-skill-worker-token-change-me",
        min_length=32,
    )
    skill_max_archive_bytes: int = 10 * 1024 * 1024
    skill_max_expanded_bytes: int = 50 * 1024 * 1024
    skill_max_file_bytes: int = 5 * 1024 * 1024
    skill_max_files: int = 500
    skill_max_output_bytes: int = 1024 * 1024
    skill_script_timeout: float = 30.0

    #: 宠物的工作目录。与 skill 包的缓存分开：那个是只读的、随时可重新materialize
    #: 的派生物，这个是它自己写的东西，重启要还在。
    workspace_dir: str = "/workspace"
    #: 整个工作区的总上限。Docker 卷没有好用的配额，所以在应用层拦：
    #: 写入前先算现有占用，超了直接拒绝。
    workspace_max_bytes: int = Field(default=64 * 1024 * 1024, ge=1024 * 1024)
    workspace_max_file_bytes: int = Field(default=8 * 1024 * 1024, ge=1024)
    workspace_max_files: int = Field(default=200, ge=1, le=5_000)
    #: 定期清理的保留天数。工作区是草稿纸不是仓库——分析完的中间文件留着只会
    #: 让下一次分析读到过期数据。
    workspace_retention_days: int = Field(default=14, ge=1, le=365)

    @field_validator("webauthn_origins", "cors_origins", mode="before")
    @classmethod
    def split_comma_separated(cls, value: object) -> object:
        """把 `a,b` 和 `["a","b"]` 都收下。

        配合上面的 `NoDecode`：环境变量原样是字符串，这里自己拆。JSON 写法
        仍然支持（旧的 .env 不会因为这次改动失效），但**逗号分隔才是主路**。
        """
        if not isinstance(value, str):
            return value
        text = value.strip()
        if not text:
            return []
        if text.startswith("["):
            import json

            return json.loads(text)
        return [part.strip() for part in text.split(",") if part.strip()]

    @model_validator(mode="after")
    def validate_embedding_dimensions(self) -> "Settings":
        if self.embedding_dimensions != 1024:
            raise ValueError("当前 pgvector schema 固定使用 1024 维向量")
        if self.checkpointer_pool_max_size < self.checkpointer_pool_min_size:
            raise ValueError("Checkpointer 连接池最大连接数不能小于最小连接数")
        return self

    @property
    def procrastinate_database_url(self) -> str:
        return self.database_url.replace("postgresql+asyncpg://", "postgresql://", 1)


@lru_cache
def get_settings() -> Settings:
    return Settings()
