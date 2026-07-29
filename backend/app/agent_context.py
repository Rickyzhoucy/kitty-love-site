from dataclasses import dataclass, field
from typing import Any


@dataclass
class AgentContext:
    user_id: str
    conversation_id: str
    companion_id: str
    persona_name: str
    persona_prompt: str
    user_profile: dict[str, Any]
    conversation_summary: str
    memory_context: str
    skill_context: str = ""
    skill_versions: dict[str, str] = field(default_factory=dict)
