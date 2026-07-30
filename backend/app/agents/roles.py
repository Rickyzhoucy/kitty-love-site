"""三个 Agent 角色的装配规格（架构文档 §4）。

架构文档开头的硬性要求是：三个角色**共用模型提供方，但必须使用独立的
Prompt、上下文、Checkpoint、工具白名单和预算**。这个模块就是那五样东西的
唯一定义处——把它们摊在一起，是为了让「某个角色能不能干这件事」变成一个
可以一眼看完的问题，而不是散落在三份实现里的隐式约定。
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class AgentRole(StrEnum):
    CONVERSATION = "conversation"
    COGNITION = "cognition"
    REFLECTION = "reflection"


#: 只读工具。宠物可以自主执行的那一档（架构文档 §6.4）。
#:
#: **联网工具（web_search / web_read）刻意不在此列**，尽管它们也是只读的：
#: 一是每次调用都要花钱，宠物自己想事情时不该顺手就上网；二是它们会把内容
#: 发到站外，而 §6.4 那张「可自主执行」的清单说的全是站内只读操作。
#: 生成文档同理——那是用户要的产物，不该由宠物自作主张地做。
READ_ONLY_TOOLS = frozenset({"site_resource_list", "list_skills"})


@dataclass(frozen=True)
class RoleSpec:
    role: AgentRole
    #: None 表示不限制；空集合表示**一个工具都不给**。
    #: 这两者必须区分——Reflection 拿到空集合是刻意的，不是忘了配。
    tool_names: frozenset[str] | None
    #: Checkpoint 命名空间前缀。三个角色的对话历史绝不能互相污染。
    checkpoint_prefix: str
    #: 每用户每日调用上限。超了就降级为不调模型，宠物照常按本地行为脑生活。
    daily_budget: int
    #: 单次调用超时。超时静默丢弃（架构文档 §2 原则 2）。
    timeout_seconds: float
    temperature: float


ROLE_SPECS: dict[AgentRole, RoleSpec] = {
    # 用户主动对话。工具不设限——用户明确要求的写操作应当能做到。
    AgentRole.CONVERSATION: RoleSpec(
        role=AgentRole.CONVERSATION,
        tool_names=None,
        checkpoint_prefix="conv",
        daily_budget=1_000,
        timeout_seconds=60.0,
        temperature=0.7,
    ),
    # 宠物自己想事情。**只给只读工具**：宠物可以查今天的提醒，但不能替用户
    # 新增、修改或删除任何东西——那些只能建议，必须经用户确认（§6.4）。
    # 也刻意不给 site_pet_action：身体由仲裁器驱动，不由 Agent 直接摆布。
    AgentRole.COGNITION: RoleSpec(
        role=AgentRole.COGNITION,
        tool_names=READ_ONLY_TOOLS,
        checkpoint_prefix="cog",
        daily_budget=60,
        # 比对话短得多：想不出来就别想了，宠物不该为了「思考」僵在原地。
        timeout_seconds=12.0,
        temperature=0.8,
    ),
    # 记忆反思。一个工具都不给——它的产出是记忆提案，写库由调用方代码完成，
    # 不能让它自己去动站内数据（§7.3）。
    AgentRole.REFLECTION: RoleSpec(
        role=AgentRole.REFLECTION,
        tool_names=frozenset(),
        checkpoint_prefix="refl",
        daily_budget=24,
        timeout_seconds=45.0,
        temperature=0.3,
    ),
}


def spec_for(role: AgentRole) -> RoleSpec:
    return ROLE_SPECS[role]


def thread_id(role: AgentRole, *parts: str) -> str:
    """角色隔离的 checkpoint thread id。

    前缀不是装饰：三个角色跑在同一个 checkpointer 上，前缀相同就会读到彼此
    的历史——Reflection 的分析会漏进用户看得见的对话里。
    """
    return ":".join((spec_for(role).checkpoint_prefix, *parts))


def filter_tools(role: AgentRole, tools: list) -> list:
    """按角色白名单过滤工具列表。

    白名单按**工具名**匹配而不是按对象身份，这样新增工具默认进不了受限角色——
    忘记更新白名单的后果是「宠物少了个能力」，而不是「宠物多了个权限」。
    """
    allowed = spec_for(role).tool_names
    if allowed is None:
        return list(tools)
    return [tool for tool in tools if getattr(tool, "name", "") in allowed]
