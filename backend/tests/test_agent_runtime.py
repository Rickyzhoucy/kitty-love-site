from types import SimpleNamespace

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import ValidationError
from sqlalchemy import select

from app.agent_tools import build_domain_tools
from app.agents.conversation import (
    AgentRuntime,
    CheckpointerLifecycle,
    build_agent,
    build_chat_model,
)
from app.api import get_agent_runtime
from app.auth import hash_password
from app.config import Settings
from app.conversations import ConversationService
from app.memory import MemoryService
from app.models import User
from app.schemas import MemoryCreate


class FakeEmbeddingProvider:
    dimensions = 1024
    provider_name = "fake"
    model_name = "fake-1024"

    async def embed_documents(self, texts):
        return [await self.embed_query(text) for text in texts]

    async def embed_query(self, text):
        vector = [0.0] * 1024
        vector[sum(text.encode()) % 1024] = 1.0
        return vector


class FakeAgent:
    async def astream_events(self, *args, **kwargs):
        del args, kwargs
        yield {
            "event": "on_tool_start",
            "name": "site_resource_list",
            "data": {"input": {"resource": "plan"}},
        }
        yield {
            "event": "on_tool_end",
            "name": "site_resource_list",
            "data": {"output": []},
        }
        yield {
            "event": "on_tool_end",
            "name": "site_pet_action",
            "data": {
                "output": {
                    "action": "wave",
                    "animation": "wave",
                    "assetId": "kitty-v1",
                    "duration": 1200,
                }
            },
        }
        for delta in ("你", "好"):
            yield {
                "event": "on_chat_model_stream",
                "data": {"chunk": SimpleNamespace(content=delta)},
            }


class FailingAgent:
    async def astream_events(self, *args, **kwargs):
        del args, kwargs
        yield {
            "event": "on_chat_model_stream",
            "data": {"chunk": SimpleNamespace(content="部分回答")},
        }
        raise RuntimeError("model stream failed")


class FakeQueue:
    def __init__(self):
        self.jobs = []

    async def enqueue(self, task_name, payload, *, idempotency_key):
        self.jobs.append((task_name, payload, idempotency_key))


async def test_memory_service_embeds_and_retrieves(session_maker):
    service = MemoryService(FakeEmbeddingProvider())
    async with session_maker() as db:
        user_id = (await db.execute(select(User.id))).scalar_one()
        item = await service.create(
            db,
            user_id,
            MemoryCreate(
                scope="owner",
                kind="preference",
                content="喜欢草莓蛋糕",
                importance=80,
            ),
        )
        results = await service.search(db, user_id, "草莓蛋糕")
    assert results[0].id == item.id


async def test_memory_service_rejects_another_users_companion(session_maker):
    service = MemoryService(FakeEmbeddingProvider())
    companions = ConversationService()
    async with session_maker() as db:
        owner_id = (await db.execute(select(User.id))).scalar_one()
        other = User(
            username="other",
            display_name="Other",
            password_hash=hash_password("other-password"),
        )
        db.add(other)
        await db.commit()
        other_companion, _ = await companions.ensure_companion(db, other.id)

        with pytest.raises(ValueError, match="Companion"):
            await service.create(
                db,
                owner_id,
                MemoryCreate(
                    scope="companion",
                    companionId=other_companion.id,
                    kind="fact",
                    content="不应跨用户写入",
                ),
            )
        with pytest.raises(ValueError, match="Companion"):
            await service.list(db, owner_id, other_companion.id)


async def test_chat_stream_persists_messages_and_emits_contract(
    authenticated_client,
    session_maker,
):
    queue = FakeQueue()
    runtime = AgentRuntime(
        FakeAgent(),
        session_maker,
        FakeEmbeddingProvider(),
        queue,
    )
    app = authenticated_client._transport.app
    app.dependency_overrides[get_agent_runtime] = lambda: runtime

    response = await authenticated_client.post(
        "/api/v1/chat/stream",
        json={"conversationId": None, "message": "你好"},
    )
    assert response.status_code == 200
    assert "event: text.delta" in response.text
    assert "event: tool.started" in response.text
    assert "event: tool.completed" in response.text
    assert "event: pet.action" not in response.text
    assert "event: message.completed" in response.text

    # 语义层与执行层并存：tool.* 面向审计，agent.task.* 面向宠物的身体表达。
    assert "event: agent.task.created" in response.text
    assert "event: agent.task.running" in response.text
    assert "event: agent.task.progress" in response.text
    assert "event: agent.task.succeeded" in response.text
    # 摘要只由工具名与资源类型拼出，不得带上 payload。
    assert '"safeSummary":"查询计划"' in response.text
    assert '"capability":"site.plan"' in response.text
    assert '"riskLevel":"none"' in response.text

    conversations = (await authenticated_client.get("/api/v1/conversations")).json()
    messages = (
        await authenticated_client.get(
            f"/api/v1/conversations/{conversations[0]['id']}/messages"
        )
    ).json()
    assert [(message["role"], message["content"]) for message in messages] == [
        ("user", "你好"),
        ("assistant", "你好"),
    ]
    assert [job[0] for job in queue.jobs] == [
        "memory.extract",
    ]


async def test_chat_stream_rejects_unknown_conversation_before_streaming(
    authenticated_client,
    session_maker,
):
    runtime = AgentRuntime(
        FakeAgent(),
        session_maker,
        FakeEmbeddingProvider(),
    )
    app = authenticated_client._transport.app
    app.dependency_overrides[get_agent_runtime] = lambda: runtime

    response = await authenticated_client.post(
        "/api/v1/chat/stream",
        json={"conversationId": "missing-conversation", "message": "你好"},
    )

    assert response.status_code == 404


async def test_interrupted_agent_reply_is_persisted(session_maker):
    runtime = AgentRuntime(
        FailingAgent(),
        session_maker,
        FakeEmbeddingProvider(),
    )
    async with session_maker() as db:
        user_id = (await db.execute(select(User.id))).scalar_one()

    chunks = []
    with pytest.raises(RuntimeError, match="model stream failed"):
        async for chunk in runtime.stream(user_id, "请回答"):
            chunks.append(chunk)

    conversations = ConversationService()
    async with session_maker() as db:
        conversation = (await conversations.list(db, user_id))[0]
        messages = await conversations.messages(db, user_id, conversation.id)
    assert "event: text.delta" in "".join(chunks)
    assert "event: agent.task.failed" in "".join(chunks)
    assert [(message.role, message.content) for message in messages] == [
        ("user", "请回答"),
        ("assistant", "部分回答"),
    ]
    assert messages[-1].metadata_["interrupted"] is True


async def test_model_configuration_and_agent_compile(session_maker):
    settings = Settings(
        database_url="sqlite+aiosqlite://",
        chat_api_key="test-key",
        embedding_api_key="test-key",
    )
    graph = build_agent(build_chat_model(settings), InMemorySaver(), session_maker)
    assert graph is not None


def test_embedding_dimension_is_fixed():
    with pytest.raises(ValidationError):
        Settings(embedding_dimensions=768)


async def test_sqlite_uses_in_memory_checkpointer():
    lifecycle = CheckpointerLifecycle(
        Settings(
            database_url="sqlite+aiosqlite://",
            chat_api_key="test-key",
            embedding_api_key="test-key",
        )
    )
    checkpointer = await lifecycle.start()
    assert isinstance(checkpointer, InMemorySaver)
    await lifecycle.stop()


async def test_domain_tools_share_crud_services(session_maker):
    tools = {tool.name: tool for tool in build_domain_tools(session_maker)}
    async with session_maker() as db:
        user_id = await db.scalar(select(User.id))
    runtime = SimpleNamespace(
        context=SimpleNamespace(user_id=user_id, companion_id=None)
    )
    created = await tools["site_resource_create"].coroutine(
        "plan",
        {
            "title": "记得喝水",
            "dueAt": "2026-07-28T20:00:00+08:00",
        },
        runtime,
    )
    assert created["dueAt"].startswith("2026-07-28T20:00:00")
    listed = await tools["site_resource_list"].coroutine("plan", runtime)
    assert listed[0]["id"] == created["id"]
    updated = await tools["site_resource_update"].coroutine(
        "plan",
        created["id"],
        {"completedAt": "2026-07-29T08:00:00+08:00"},
        runtime,
    )
    assert updated["completedAt"] is not None
    await tools["site_resource_delete"].coroutine(
        "plan", created["id"], runtime
    )
