from functools import lru_cache

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


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
    minio_secure: bool = False
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

    outbox_poll_seconds: float = 1.0
    outbox_retention_days: int = Field(default=7, ge=1, le=90)
    cors_origins: list[str] = ["http://localhost:3000"]

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
