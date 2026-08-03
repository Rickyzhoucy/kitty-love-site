from contextlib import AsyncExitStack, asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.admin_api import router as admin_router
from app.agents.cognition import CognitionAgent
from app.agents.conversation import (
    AgentRuntime,
    CheckpointerLifecycle,
    build_agent,
    build_chat_model,
)
from app.agents.roles import AgentRole
from app.api import router
from app.config import get_settings
from app.db import session_factory
from app.embeddings import (
    OpenAICompatibleEmbeddingProvider,
    UnavailableEmbeddingProvider,
)
from app.pet_cognition import PetCognitionService
from app.queue import ProcrastinateJobQueue, procrastinate_app


@asynccontextmanager
async def lifespan(application: FastAPI):
    settings = get_settings()
    application.state.agent_runtime = None
    application.state.cognition_service = None
    application.state.job_queue = None
    # AsyncExitStack 保证任一初始化步骤失败时已打开的资源都能反向清理
    async with AsyncExitStack() as stack:
        job_queue = None
        if not settings.database_url.startswith("sqlite"):
            await stack.enter_async_context(procrastinate_app.open_async())
            job_queue = ProcrastinateJobQueue()
        application.state.job_queue = job_queue
        if settings.chat_api_key:
            checkpointer_lifecycle = CheckpointerLifecycle(settings)
            checkpointer = await checkpointer_lifecycle.start()
            stack.push_async_callback(checkpointer_lifecycle.stop)
            embedding_provider = (
                OpenAICompatibleEmbeddingProvider(settings)
                if settings.embedding_api_key
                else UnavailableEmbeddingProvider(settings.embedding_dimensions)
            )
            application.state.agent_runtime = AgentRuntime(
                build_agent(build_chat_model(settings), checkpointer, session_factory),
                session_factory,
                embedding_provider,
                job_queue,
                embedding_enabled=bool(settings.embedding_api_key),
            )
            # 三个角色共用模型提供方，但温度与超时按角色取（架构文档 §4）。
            # Cognition 不进 agent loop，所以只要一个模型，不要 checkpointer。
            application.state.cognition_service = PetCognitionService(
                CognitionAgent(
                    build_chat_model(settings, role=AgentRole.COGNITION)
                )
            )
        yield


def create_app() -> FastAPI:
    settings = get_settings()
    application = FastAPI(title=settings.app_name, version="0.2.0", lifespan=lifespan)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.include_router(router, prefix=settings.api_prefix)
    # 后台。**自带一套鉴权**（kitty_admin Cookie），与主站会话无关，
    # 理由见 app/admin_auth.py。
    application.include_router(admin_router, prefix=settings.api_prefix)

    @application.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return application


app = create_app()
