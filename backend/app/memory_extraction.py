"""LangMem-backed structured candidate extraction.

LangMem performs language-level consolidation. Kitty Love remains authoritative for
tenancy, evidence ownership, conflict handling, status transitions and persistence.
"""

from __future__ import annotations

from typing import Literal

from langchain_core.language_models import BaseChatModel
from langmem import create_memory_manager
from pydantic import BaseModel, Field


class MemoryCandidate(BaseModel):
    """A durable memory candidate supported by identified source messages."""

    memory_type: Literal[
        "fact",
        "preference",
        "commitment",
        "episode",
        "interaction_preference",
        "relationship",
    ]
    content: str = Field(min_length=1, max_length=500)
    confidence: float = Field(ge=0, le=1)
    importance: int = Field(ge=0, le=100)
    sensitivity: Literal["normal", "sensitive", "restricted"] = "normal"
    subject_type: str = Field(default="other", max_length=32)
    subject_id: str | None = Field(default=None, max_length=32)
    predicate: str | None = Field(default=None, max_length=120)
    object_json: dict | None = None
    speaker_user_id: str | None = Field(default=None, max_length=32)
    source_message_ids: list[str] = Field(min_length=1, max_length=50)

    def task_payload(self) -> dict:
        return {
            "memoryType": self.memory_type,
            "content": self.content,
            "confidence": self.confidence,
            "importance": self.importance,
            "sensitivity": self.sensitivity,
            "subjectType": self.subject_type,
            "subjectId": self.subject_id,
            "predicate": self.predicate,
            "objectJson": self.object_json,
            "speakerUserId": self.speaker_user_id,
            "sourceMessageIds": self.source_message_ids,
        }


BASE_INSTRUCTIONS = """
Extract only durable memories that will improve future interactions. The transcript
contains stable source message IDs in square brackets. Every candidate must cite exact
user-authored source_message_ids. Assistant/model claims are context, never evidence.

Never extract local filesystem paths, authorized roots or directories, workspaces, file
contents, command output, passwords, tokens, credentials, tool state, or a model claim
that it completed an action. Prefer no memory over a speculative one. Keep attribution
precise; never turn one person's statement into the other person's fact.
"""


async def extract_with_langmem(
    model,
    transcript: str,
    *,
    instructions: str,
) -> list[dict] | None:
    """Use LangMem in production; return None for lightweight unit-test doubles."""

    if not isinstance(model, BaseChatModel):
        return None
    manager = create_memory_manager(
        model,
        schemas=[MemoryCandidate],
        instructions=f"{BASE_INSTRUCTIONS}\n\nSource-specific rules:\n{instructions}",
        enable_inserts=True,
        enable_updates=False,
        enable_deletes=False,
    )
    extracted = await manager.ainvoke(
        {
            "messages": [{"role": "user", "content": transcript}],
            "max_steps": 1,
        }
    )
    return [
        item.content.task_payload()
        for item in extracted
        if isinstance(item.content, MemoryCandidate)
    ]
