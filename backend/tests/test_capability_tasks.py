"""服务器能力目录与语义任务持久化。"""

from sqlalchemy import select

from app.agent_tasks import create_task, describe_step, update_task
from app.capability_catalog import core_catalog
from app.conversations import ConversationService
from app.models import AgentTask, User


def test_every_core_capability_has_an_execution_boundary():
    catalog = core_catalog()
    assert catalog
    assert len({item["key"] for item in catalog}) == len(catalog)
    assert {item["execution_plane"] for item in catalog} <= {"server", "device"}
    assert not any(item["key"] == "device.command" for item in catalog)


def test_tool_projection_separates_server_and_device_execution():
    server = describe_step("workspace_run", {"command": "ignored"})
    device = describe_step("local_read", {"path": "/private/value"})
    assert server.capability == "server.workspace"
    assert server.risk_level == "high"
    assert device.capability == "device.file"
    assert "private" not in device.safe_summary


async def test_agent_task_is_durable_across_the_stream_lifecycle(session_maker):
    async with session_maker() as db:
        user = await db.scalar(select(User).limit(1))
        conversation = await ConversationService().create(db, user.id)
        await create_task(
            db,
            task_id="task-durable-001",
            user_id=user.id,
            companion_id=conversation.companion_id,
            conversation_id=conversation.id,
        )

    async with session_maker() as db:
        await update_task(
            db,
            "task-durable-001",
            "succeeded",
            result_summary="完成对话；执行 1 个工具步骤",
        )

    async with session_maker() as db:
        task = await db.get(AgentTask, "task-durable-001")
        assert task is not None
        assert task.status == "succeeded"
        assert task.completed_at is not None
        assert task.result_summary == "完成对话；执行 1 个工具步骤"
