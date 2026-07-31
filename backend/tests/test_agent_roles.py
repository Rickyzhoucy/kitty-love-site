"""三个角色的隔离约束（架构文档 §4 / §6.4）。

这些测试守的是「权限」而不是「功能」——它们失败意味着某个角色拿到了它不该
有的能力，那比少一个功能严重得多。
"""

import pytest

from app.agent_tools import build_domain_tools
from app.agents.roles import AgentRole, filter_tools, spec_for, thread_id
from app.skill_tools import build_skill_tools


def all_tools(session_maker):
    return [*build_domain_tools(session_maker), *build_skill_tools(session_maker)]


def tool_names(tools):
    return {getattr(tool, "name", "") for tool in tools}


def test_conversation_keeps_every_tool(session_maker):
    tools = all_tools(session_maker)
    assert filter_tools(AgentRole.CONVERSATION, tools) == tools


@pytest.mark.parametrize(
    "forbidden",
    [
        "site_resource_create",
        "site_resource_update",
        "site_resource_delete",
        "run_skill_script",
    ],
)
def test_cognition_cannot_write_anything(session_maker, forbidden):
    """宠物只能建议、不得擅自执行写操作（架构文档 §6.4）。"""
    names = tool_names(filter_tools(AgentRole.COGNITION, all_tools(session_maker)))
    assert forbidden not in names


def test_cognition_cannot_drive_the_body_directly(session_maker):
    """身体由仲裁器驱动。给 Agent 一个直接操纵身体的工具就绕过了优先级链。"""
    names = tool_names(filter_tools(AgentRole.COGNITION, all_tools(session_maker)))
    assert "site_pet_action" not in names
    assert "site_resource_list" in names


def test_reflection_gets_no_tools_at_all(session_maker):
    """反思只产出记忆提案，写库由调用方代码完成（架构文档 §7.3）。"""
    assert filter_tools(AgentRole.REFLECTION, all_tools(session_maker)) == []


def test_unknown_tool_defaults_to_denied_for_restricted_roles(session_maker):
    """白名单按名字匹配：新增工具默认进不了受限角色。

    忘记更新白名单的后果必须是「宠物少了个能力」，而不是「宠物多了个权限」。
    """

    class FutureTool:
        name = "site_launch_missiles"

    tools = [*all_tools(session_maker), FutureTool()]
    for role in (AgentRole.COGNITION, AgentRole.REFLECTION):
        assert "site_launch_missiles" not in tool_names(filter_tools(role, tools))
    assert "site_launch_missiles" in tool_names(
        filter_tools(AgentRole.CONVERSATION, tools)
    )


def test_checkpoint_namespaces_never_collide():
    """角色共用同一个 checkpointer，前缀相同就会读到彼此的历史。

    对 AgentRole 全集断言而不是写死几个：新增角色时忘了给前缀，这条会直接红，
    而不是等到 Reflection 的分析漏进用户看得见的对话里才发现。
    """
    ids = {thread_id(role, "conversation-1", "seg") for role in AgentRole}
    assert len(ids) == len(list(AgentRole))


def test_每个角色都有独立预算与超时():
    budgets = {spec_for(role).daily_budget for role in AgentRole}
    timeouts = {spec_for(role).timeout_seconds for role in AgentRole}
    assert len(budgets) == len(list(AgentRole))
    assert len(timeouts) == len(list(AgentRole))
    # 想不出来就别想了：认知的超时必须明显短于对话。
    assert (
        spec_for(AgentRole.COGNITION).timeout_seconds
        < spec_for(AgentRole.CONVERSATION).timeout_seconds
    )
