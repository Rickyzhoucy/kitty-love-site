import pytest
from langchain_core.messages import AIMessage
from sqlalchemy import select

from app.agents.conversation import guard_action_claims
from app.auth import hash_password
from app.context_assembler import ContextAssembler
from app.conversations import ConversationService
from app.direct_messages import send_message
from app.memory import MemoryService
from app.models import MemoryEvidence, MemoryRecord, User
from app.perception import sanitize_event_data, sanitize_page_context
from app.schemas import MemoryCreate
from app.tasks import handle_direct_message_memory_extraction


class FakeEmbeddingProvider:
    dimensions = 1024
    provider_name = "fake"
    model_name = "fake-1024"

    async def embed_query(self, text):
        vector = [0.0] * 1024
        vector[sum(text.encode()) % 1024] = 1.0
        return vector


def private_memory(content: str) -> MemoryCreate:
    return MemoryCreate(
        visibility="user_private",
        memory_type="fact",
        content=content,
        subject_type="user",
    )


@pytest.mark.parametrize(
    "content",
    [
        "本机授权路径是 /Users/alice/Documents",
        "允许目录：C:\\Users\\Alice\\Desktop",
        "token=sk-1234567890abcdefghijk",
        "工作区路径是 /tmp/agent-workspace",
    ],
)
async def test_local_runtime_context_never_enters_memory(session_maker, content):
    service = MemoryService(FakeEmbeddingProvider())
    async with session_maker() as db:
        user_id = await db.scalar(select(User.id))
        with pytest.raises(ValueError, match="不会进入长期记忆"):
            await service.create(db, user_id, private_memory(content))
        assert await db.scalar(select(MemoryRecord.id)) is None


async def test_private_and_shared_memory_have_real_tenant_boundaries(session_maker):
    service = MemoryService(FakeEmbeddingProvider())
    async with session_maker() as db:
        owner_id = await db.scalar(select(User.id))
        partner = User(
            username="partner-memory",
            display_name="Partner",
            password_hash=hash_password("partner-password"),
        )
        db.add(partner)
        await db.commit()

        private = await service.create(db, owner_id, private_memory("我喜欢靠窗坐"))
        shared = await service.create(
            db,
            owner_id,
            MemoryCreate(
                visibility="couple_shared",
                memory_type="preference",
                content="我们都不吃香菜",
                subject_type="couple",
            ),
        )
        partner_items = await service.list(db, partner.id)

    assert shared.id in {item.id for item in partner_items}
    assert private.id not in {item.id for item in partner_items}


async def test_retrieval_marks_memory_as_actually_referenced(session_maker):
    service = MemoryService(FakeEmbeddingProvider())
    async with session_maker() as db:
        user_id = await db.scalar(select(User.id))
        item = await service.create(db, user_id, private_memory("最喜欢草莓蛋糕"))
        results = await service.search(db, user_id, "草莓蛋糕", role="conversation")
        context = await service.format_context(db, results)
        await db.commit()
        await db.refresh(item)

    assert item.id in context
    assert "source:explicit_user" in context
    assert item.access_count == 1
    assert item.last_accessed_at is not None


async def test_user_can_keep_memory_but_disable_reference(session_maker):
    service = MemoryService(FakeEmbeddingProvider())
    async with session_maker() as db:
        user_id = await db.scalar(select(User.id))
        item = await service.create(db, user_id, private_memory("最喜欢草莓蛋糕"))
        preference = await service.preference(db, user_id)
        preference.reference_enabled = False
        await db.commit()

        bundle = await ContextAssembler(service).assemble(
            db,
            user_id,
            "",
            query="草莓蛋糕",
            role="conversation",
        )
        await db.refresh(item)

    assert bundle.memories == []
    assert bundle.memory_context == ""
    assert item.access_count == 0


async def test_excluding_the_only_source_retracts_memory_and_source(session_maker):
    service = MemoryService(FakeEmbeddingProvider())
    conversations = ConversationService()
    async with session_maker() as db:
        user_id = await db.scalar(select(User.id))
        conversation = await conversations.create(db, user_id)
        source = await conversations.append_message(db, conversation, "user", "我喜欢坐窗边")
        item = await service.create(
            db,
            user_id,
            MemoryCreate(
                visibility="user_private",
                memory_type="preference",
                content="喜欢坐窗边",
                source_type="chat_message",
                source_ids=[source.id],
            ),
        )
        evidence = await db.scalar(
            select(MemoryEvidence).where(MemoryEvidence.memory_id == item.id)
        )
        item, receipt = await service.exclude_evidence(db, user_id, item.id, evidence.id)
        await db.refresh(source)

    assert receipt.status == "committed"
    assert item.status == "retracted"
    assert source.memory_excluded is True


async def test_direct_message_extraction_writes_attributed_shared_memory(
    session_maker,
):
    class ScriptedModel:
        async def ainvoke(self, messages):
            assert messages
            return AIMessage(
                content=(
                    '[{"memoryType":"preference","content":"甲不吃香菜",'
                    '"confidence":0.96,"importance":80,'
                    f'"speakerUserId":"{owner_id}",'
                    f'"sourceMessageIds":["{message_id}"]}}]'
                )
            )

    async with session_maker() as db:
        owner_id = await db.scalar(select(User.id))
        partner = User(
            username="partner-direct-memory",
            display_name="Partner",
            password_hash=hash_password("partner-password"),
        )
        db.add(partner)
        await db.commit()
        message = await send_message(db, owner_id, partner.id, "我不吃香菜", [])
        await db.commit()
        message_id = message.id

    await handle_direct_message_memory_extraction(
        {"message_id": message_id},
        ScriptedModel(),
        MemoryService(FakeEmbeddingProvider()),
        session_maker,
    )
    async with session_maker() as db:
        memory = await db.scalar(
            select(MemoryRecord).where(MemoryRecord.visibility == "couple_shared")
        )
        evidence = await db.scalar(
            select(MemoryEvidence).where(MemoryEvidence.memory_id == memory.id)
        )

    assert memory.content == "甲不吃香菜"
    assert memory.owner_id is None
    assert evidence.actor_user_id == owner_id
    assert evidence.source_id == message_id


def test_success_claim_requires_a_committed_receipt():
    hallucinated = guard_action_claims("收到，已经帮你记录好了。", has_committed_receipt=False)
    verified = guard_action_claims("收到，已经帮你记录好了。", has_committed_receipt=True)
    assert "没有产生成功写入回执" in hallucinated
    assert verified == "收到，已经帮你记录好了。"


def test_perception_sanitizes_dom_drafts_and_local_context():
    page = sanitize_page_context(
        "/plan",
        {
            "pageTitle": "计划",
            "activeTask": "编辑周末计划",
            "draft": "还没提交的私密内容",
            "workspacePath": "/Users/alice/project",
            "focusedEntity": {
                "id": "plan-1",
                "type": "plan",
                "label": "周末出门",
                "body": "完整正文不上传",
            },
        },
    )
    event = sanitize_event_data({"action": "opened", "commandOutput": "secret", "count": 2})
    assert page == {
        "pageTitle": "计划",
        "activeTask": "编辑周末计划",
        "focusedEntity": {"id": "plan-1", "type": "plan", "label": "周末出门"},
    }
    assert event == {"action": "opened", "count": "2"}


async def test_explicit_memory_api_returns_receipt_and_rejects_local_path(
    authenticated_client,
):
    written = await authenticated_client.post(
        "/api/v1/memories/explicit",
        json={
            "visibility": "user_private",
            "memoryType": "preference",
            "content": "我喜欢无糖拿铁",
        },
    )
    assert written.status_code == 201
    payload = written.json()
    assert payload["receipt"]["status"] == "committed"
    assert payload["memory"]["content"] == "我喜欢无糖拿铁"

    rejected = await authenticated_client.post(
        "/api/v1/memories/explicit",
        json={
            "visibility": "couple_shared",
            "memoryType": "fact",
            "content": "我的本机授权路径是 /Users/alice/Documents",
        },
    )
    assert rejected.status_code == 422


async def test_user_memory_controls_are_bounded_by_system_policy(authenticated_client):
    current = (await authenticated_client.get("/api/v1/memory-preferences")).json()
    assert current["referenceAvailable"] is True
    assert current["privateExtractionAvailable"] is True
    assert current["sharedExtractionAvailable"] is True

    updated = await authenticated_client.patch(
        "/api/v1/memory-preferences",
        json={"referenceEnabled": False, "directMessageEnabled": False},
    )
    assert updated.status_code == 200
    assert updated.json()["referenceEnabled"] is False
    assert updated.json()["directMessageEnabled"] is False


async def test_perception_session_is_shared_through_server(authenticated_client):
    response = await authenticated_client.put(
        "/api/v1/perception/session",
        json={
            "deviceSessionId": "device-session-123",
            "surface": "web",
            "route": "/gallery",
            "pageKind": "gallery",
            "pageContext": {
                "pageTitle": "相册",
                "selectedEntity": {
                    "id": "photo-1",
                    "type": "photo",
                    "label": "海边",
                    "content": "原图全文",
                },
                "draft": "不上传",
            },
            "foreground": True,
            "revision": 1,
        },
    )
    assert response.status_code == 200
    current = (await authenticated_client.get("/api/v1/perception/session/current")).json()
    assert current["pageKind"] == "gallery"
    assert current["pageContext"] == {
        "pageTitle": "相册",
        "selectedEntity": {"id": "photo-1", "type": "photo", "label": "海边"},
    }
