"""三个 Agent 角色（架构文档 §4）。

- `conversation` —— 用户主动对话，工具不设限
- `cognition`    —— 宠物自己想事情，只读工具
- `reflection`   —— 记忆反思，无工具

共用模型提供方，但 Prompt、上下文、Checkpoint、工具白名单、预算全部独立，
定义集中在 `roles.py`。
"""

from app.agents.conversation import (
    AgentGraph,
    AgentRuntime,
    CheckpointerLifecycle,
    build_agent,
    build_chat_model,
    sse,
)
from app.agents.roles import (
    ROLE_SPECS,
    AgentRole,
    RoleSpec,
    filter_tools,
    spec_for,
    thread_id,
)

__all__ = [
    "ROLE_SPECS",
    "AgentGraph",
    "AgentRole",
    "AgentRuntime",
    "CheckpointerLifecycle",
    "RoleSpec",
    "build_agent",
    "build_chat_model",
    "filter_tools",
    "spec_for",
    "sse",
    "thread_id",
]
