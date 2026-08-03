"""app/agent_tasks.py 的语义层映射。

注意与 tests/test_agent_tasks.py 区分：那个文件测的是 app/tasks.py 的后台作业。
"""

import pytest

from app.agent_tasks import describe_step, task_event


@pytest.mark.parametrize(
    ("tool_name", "tool_input", "capability", "risk", "summary"),
    [
        ("site_resource_list", {"resource": "plan"}, "site.plan", "none", "查询计划"),
        (
            "site_resource_create",
            {"resource": "wish"},
            "site.wish",
            "low",
            "新增心愿",
        ),
        ("site_resource_delete", {"resource": "photo"}, "site.photo", "high", "删除照片"),
        ("site_pet_action", {"action": "wave"}, "site.pet", "none", "做一个动作"),
        (
            "run_skill_script",
            {"name": "report"},
            "server.skill",
            "high",
            "在服务器沙箱执行 Skill",
        ),
    ],
)
def test_describe_step_maps_capability_and_risk(
    tool_name,
    tool_input,
    capability,
    risk,
    summary,
):
    step = describe_step(tool_name, tool_input)
    assert step.capability == capability
    assert step.risk_level == risk
    assert step.safe_summary == summary


def test_external_tools_report_waiting_instead_of_running():
    """执行体在站外时语义是「等」，宠物应表现为 waiting 而不是 working。"""
    assert describe_step("run_skill_script", {}).running_status == "waiting"
    assert describe_step("site_resource_list", {}).running_status == "running"


def test_safe_summary_never_carries_payload():
    """摘要会经 SSE 送到前端并可能显示在气泡里，绝不能带用户数据。"""
    secret = "生日礼物是求婚戒指"
    step = describe_step(
        "site_resource_create",
        {"resource": "plan", "payload": {"title": secret}},
    )
    assert secret not in step.safe_summary
    _, payload = task_event("running", "task-1", step=step, sequence=1)
    assert secret not in str(payload)


def test_unknown_tool_defaults_to_low_risk():
    """未登记的工具按 low 处理——未知不等于安全。"""
    assert describe_step("some_future_tool", {}).risk_level == "low"


def test_task_event_name_follows_architecture_contract():
    name, payload = task_event("confirmation_required", "task-9")
    assert name == "agent.task.confirmation_required"
    assert payload["taskId"] == "task-9"
    assert payload["capability"] == "site.chat"
    assert "sequence" not in payload
