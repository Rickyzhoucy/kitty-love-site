"""Reflection Agent：只有真正的经历才进记忆（架构文档 §4.3 / §9）。"""

from sqlalchemy import select

from app.agents.reflection import (
    IMPORTANCE_FLOOR,
    ReflectionAgent,
    companions_with_pending,
    pending_count,
    pending_events,
    record_event,
)
from app.conversations import ConversationService
from app.memory import MemoryService
from app.models import CompanionPetEvent, MemoryItem, User


class FakeEmbeddingProvider:
    dimensions = 1024
    provider_name = "fake"
    model_name = "fake-1024"

    async def embed_query(self, text):
        del text
        return [0.25] * 1024

    async def embed_documents(self, texts):
        return [[0.25] * 1024 for _ in texts]


class ScriptedModel:
    def __init__(self, content):
        self.content = content
        self.calls = 0

    async def ainvoke(self, messages):
        self.calls += 1
        self.last_prompt = "\n".join(str(m.content) for m in messages)

        class Response:
            pass

        response = Response()
        response.content = self.content
        return response


async def _companion(session_maker):
    async with session_maker() as db:
        user_id = await db.scalar(select(User.id))
        companion, _ = await ConversationService().ensure_companion(db, user_id)
        return companion.id


async def test_tool_logs_never_reach_the_reflection_prompt(session_maker):
    """普通工具日志不得进入情感记忆（架构文档 §9）。

    过滤在读取端：不合格的事件根本不会被查出来，也就没机会漏进 Prompt。
    """
    companion_id = await _companion(session_maker)
    async with session_maker() as db:
        await record_event(
            db, companion_id, "tool.completed", {"name": "site_resource_list"}, 90
        )
        await record_event(
            db, companion_id, "interaction.milestone", {"level": 3}, 80
        )
        await db.commit()

        events = await pending_events(db, companion_id)
    assert [event.type for event in events] == ["interaction.milestone"]


async def test_low_importance_events_are_filtered_out(session_maker):
    companion_id = await _companion(session_maker)
    async with session_maker() as db:
        await record_event(
            db, companion_id, "interaction.milestone", {}, IMPORTANCE_FLOOR - 1
        )
        await db.commit()
        assert await pending_events(db, companion_id) == []


async def test_reflection_writes_memory_and_marks_events_processed(session_maker):
    companion_id = await _companion(session_maker)
    async with session_maker() as db:
        await record_event(
            db, companion_id, "proactive.accepted", {"utterance": "要休息吗"}, 75
        )
        await db.commit()

    model = ScriptedModel(
        '[{"kind":"relationship","content":"主人愿意在忙碌时被打断一下","importance":70}]'
    )
    async with session_maker() as db:
        from app.models import Companion

        companion = await db.get(Companion, companion_id)
        written = await ReflectionAgent(
            model, MemoryService(FakeEmbeddingProvider())
        ).reflect(db, companion)
    assert written == ["主人愿意在忙碌时被打断一下"]

    async with session_maker() as db:
        memories = list(await db.scalars(select(MemoryItem)))
        events = list(await db.scalars(select(CompanionPetEvent)))
    assert len(memories) == 1
    assert memories[0].scope == "companion"
    assert all(event.processed_at is not None for event in events)


async def test_failed_reflection_keeps_events_for_next_time(session_maker):
    """反思失败不能把事件标记成已处理——那等于悄悄丢掉它们。"""
    companion_id = await _companion(session_maker)
    async with session_maker() as db:
        await record_event(db, companion_id, "user.sentiment", {"mood": "低落"}, 80)
        await db.commit()

    async with session_maker() as db:
        from app.models import Companion

        companion = await db.get(Companion, companion_id)
        written = await ReflectionAgent(
            ScriptedModel("模型今天不想输出 JSON"),
            MemoryService(FakeEmbeddingProvider()),
        ).reflect(db, companion)
    assert written == []

    async with session_maker() as db:
        events = list(await db.scalars(select(CompanionPetEvent)))
    assert all(event.processed_at is None for event in events)


async def test_pending_count_matches_what_reflection_can_actually_consume(
    session_maker,
):
    """计数与读取必须用同一套过滤条件，否则触发阈值和实际消费量对不上。"""
    companion_id = await _companion(session_maker)
    async with session_maker() as db:
        for _ in range(3):
            await record_event(db, companion_id, "interaction.milestone", {}, 80)
        await record_event(db, companion_id, "tool.completed", {}, 99)
        await record_event(db, companion_id, "user.sentiment", {}, 10)
        await db.commit()

        assert await pending_count(db, companion_id) == 3
        assert len(await pending_events(db, companion_id)) == 3


async def test_sweep_only_lists_companions_that_have_work(session_maker):
    companion_id = await _companion(session_maker)
    async with session_maker() as db:
        assert await companions_with_pending(db) == []
        await record_event(db, companion_id, "task.highRisk", {"steps": []}, 75)
        await db.commit()
        assert await companions_with_pending(db) == [companion_id]


async def test_reflection_survives_embedding_failure(session_maker):
    """向量化挂了不该连累记忆本身——条目已经写进去了。"""

    class BrokenEmbedding(FakeEmbeddingProvider):
        async def embed_documents(self, texts):
            raise RuntimeError("embedding provider down")

        async def embed_query(self, text):
            raise RuntimeError("embedding provider down")

    companion_id = await _companion(session_maker)
    async with session_maker() as db:
        await record_event(db, companion_id, "interaction.milestone", {"level": 2}, 70)
        await db.commit()

    async with session_maker() as db:
        from app.models import Companion

        companion = await db.get(Companion, companion_id)
        written = await ReflectionAgent(
            ScriptedModel('[{"kind":"relationship","content":"关系更近了一步"}]'),
            MemoryService(BrokenEmbedding()),
        ).reflect(db, companion)
    assert written == ["关系更近了一步"]

    async with session_maker() as db:
        assert len(list(await db.scalars(select(MemoryItem)))) == 1


async def test_event_endpoint_enqueues_reflection_once_a_batch_is_ready(
    authenticated_client,
):
    """按量触发：攒够一批才反思，孤立的一两件事提炼不出关系层面的东西。"""
    from app.agents.reflection import REFLECTION_BATCH_TRIGGER

    class RecordingQueue:
        def __init__(self):
            self.jobs = []

        async def enqueue(self, task_name, payload, *, idempotency_key):
            self.jobs.append((task_name, payload, idempotency_key))

    queue = RecordingQueue()
    app = authenticated_client._transport.app
    app.state.job_queue = queue

    for index in range(REFLECTION_BATCH_TRIGGER - 1):
        response = await authenticated_client.post(
            "/api/v1/pet/events",
            json={"type": "interaction.milestone", "importance": 70, "payload": {}},
        )
        assert response.status_code == 204
        assert queue.jobs == [], f"第 {index + 1} 条就触发了反思，太早"

    await authenticated_client.post(
        "/api/v1/pet/events",
        json={"type": "interaction.milestone", "importance": 70, "payload": {}},
    )
    assert [job[0] for job in queue.jobs] == ["pet.reflect"]
    app.state.job_queue = None


async def test_unqualified_events_never_trigger_reflection(authenticated_client):
    """工具日志再多也不该触发一次反思。"""

    class RecordingQueue:
        def __init__(self):
            self.jobs = []

        async def enqueue(self, task_name, payload, *, idempotency_key):
            self.jobs.append(task_name)

    queue = RecordingQueue()
    app = authenticated_client._transport.app
    app.state.job_queue = queue
    for _ in range(20):
        await authenticated_client.post(
            "/api/v1/pet/events",
            json={"type": "tool.completed", "importance": 99, "payload": {}},
        )
    assert queue.jobs == []
    app.state.job_queue = None


async def test_reflection_does_not_call_the_model_when_nothing_qualifies(
    session_maker,
):
    """没有够格的事件就不该产生一次调用。"""
    companion_id = await _companion(session_maker)
    async with session_maker() as db:
        await record_event(db, companion_id, "tool.completed", {}, 99)
        await db.commit()

    model = ScriptedModel("[]")
    async with session_maker() as db:
        from app.models import Companion

        companion = await db.get(Companion, companion_id)
        await ReflectionAgent(
            model, MemoryService(FakeEmbeddingProvider())
        ).reflect(db, companion)
    assert model.calls == 0
