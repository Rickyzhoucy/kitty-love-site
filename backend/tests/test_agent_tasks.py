from langchain_core.messages import AIMessage
from sqlalchemy import func, select

from app.conversations import ConversationService
from app.memory import MemoryService
from app.models import (
    ConversationSummary,
    MemoryEmbedding,
    MemoryItem,
    User,
)
from app.queue import job_handlers
from app.tasks import (
    _importance,
    handle_conversation_summary,
    handle_memory_extraction,
    handle_profile_refresh,
)
from app.worker import procrastinate_app


class FakeEmbeddingProvider:
    dimensions = 1024
    provider_name = "fake"
    model_name = "fake-1024"

    async def embed_query(self, text):
        del text
        return [0.25] * 1024

    async def embed_documents(self, texts):
        return [[0.25] * 1024 for _ in texts]


def test_worker_entrypoint_registers_background_handlers():
    assert procrastinate_app
    assert {"conversation.summarize", "memory.extract", "profile.refresh"} <= job_handlers.keys()


def test_importance_accepts_model_labels_and_invalid_values():
    assert _importance("high") == 80
    assert _importance("medium") == 50
    assert _importance("unknown") == 50
    assert _importance(120) == 100


class FakeModel:
    def __init__(self, content):
        self.content = content

    async def ainvoke(self, messages):
        assert messages
        return AIMessage(content=self.content)


async def test_summary_and_memory_extraction_handlers(session_maker):
    service = ConversationService()
    async with session_maker() as db:
        user_id = await db.scalar(select(User.id))
        conversation = await service.create(db, user_id, title="test")
        await service.append_message(db, conversation, "user", "我最喜欢草莓蛋糕")
        await service.append_message(db, conversation, "assistant", "我记住了")

    payload = {"conversation_id": conversation.id, "user_id": user_id}
    await handle_conversation_summary(
        payload,
        FakeModel("用户喜欢草莓蛋糕。"),
        session_maker,
    )
    await handle_memory_extraction(
        payload,
        FakeModel(
            '[{"kind":"preference","content":"用户喜欢草莓蛋糕","importance":80}]'
        ),
        MemoryService(FakeEmbeddingProvider()),
        session_maker,
    )
    await handle_profile_refresh(
        payload,
        FakeModel('{"favoriteFood":"草莓蛋糕"}'),
        session_maker,
    )

    async with session_maker() as db:
        summary = await db.scalar(
            select(ConversationSummary).where(
                ConversationSummary.conversation_id == conversation.id
            )
        )
        memory_count = await db.scalar(select(func.count()).select_from(MemoryItem))
        embedding_count = await db.scalar(
            select(func.count()).select_from(MemoryEmbedding)
        )
        profile = await service.get_or_create_profile(db, user_id)
    assert summary.summary == "用户喜欢草莓蛋糕。"
    assert memory_count == 1
    assert embedding_count == 1
    assert profile.profile["favoriteFood"] == "草莓蛋糕"
