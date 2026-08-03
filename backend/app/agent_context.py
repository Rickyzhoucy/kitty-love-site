from dataclasses import dataclass, field
from typing import Any


@dataclass
class AgentContext:
    user_id: str
    #: 不是每次跑 Agent 都属于某个对话——比如在私聊里被 @ 的那一问一答，
    #: 它不进对话本，也就没有 conversationId。审计表的这一列本就可空
    #: （ToolRun.conversationId），塞一个不存在的 id 进去会直接违反外键。
    conversation_id: str | None
    companion_id: str
    persona_name: str
    persona_prompt: str
    user_profile: dict[str, Any]
    conversation_summary: str
    memory_context: str
    source_message_id: str | None = None
    page_context: dict[str, Any] = field(default_factory=dict)
    active_task: str | None = None
    memory_ids: list[str] = field(default_factory=list)
    skill_context: str = ""
    skill_versions: dict[str, str] = field(default_factory=dict)
