"""Pet Cognition Agent —— 宠物自己想事情（架构文档 §4.2）。

与 Conversation Agent 的根本区别：**它的输出不是给用户看的文本，而是给行为脑
的一份提案**。提案必须过 Schema 校验才能进仲裁器；校验失败或超时一律静默丢弃，
宠物继续按本地行为脑运行（架构文档 §2 原则 2）。

「静默丢弃」不是偷懒，是刻意的：宠物的生活不能依赖模型可用。模型挂了、超时了、
胡说了，用户应该完全察觉不到——最多是这一刻宠物没主动说话。
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field, ValidationError

from app.agents.roles import AgentRole, spec_for

logger = logging.getLogger(__name__)

#: 宠物可以提出的目标。与前端 `brain/goals.ts` 的 PetGoalId 对齐——
#: 模型编出一个不存在的目标，仲裁器无从执行，所以在这里就挡掉。
ALLOWED_GOALS = frozenset(
    {
        "idle",
        "rest",
        "sleep",
        "seekAttention",
        "play",
        "explore",
        "eat",
        "observe",
        "follow",
    }
)

ALLOWED_EMOTIONS = frozenset({"happy", "normal", "curious", "sad", "focused"})

SYSTEM_PROMPT = """你是一只电子宠物的「想法」。你不是助手，不要提供服务。

你的输出会交给宠物的行为脑，由它决定要不要采纳——所以你只是提议，不是命令。

规则：
- 只输出一个 JSON 对象，不要代码块，不要解释。
- goal 必须是这几个之一：idle, rest, sleep, seekAttention, play, explore, eat, observe, follow。
- emotion 必须是：happy, normal, curious, sad, focused。
- utterance 是宠物想说的一句话，不超过 30 字；没什么想说的就给 null。
  它应该像宠物在自言自语或对主人搭话，不要像客服。
- capabilityRequest 只能是只读能力，或者 null。你不能要求新增、修改或删除任何东西。
- memoryProposal 是一句值得长期记住的观察，或者 null。普通的日常动作不值得记。
- expiresIn 是这个想法的有效秒数，10 到 600 之间。

字段：{"goal","emotion","reason","utterance","capabilityRequest","memoryProposal","expiresIn"}
"""


class CognitionProposal(BaseModel):
    """Cognition Agent 的输出契约（架构文档 §4.2）。

    每个字段都有边界，因为这是**模型写的、要拿去驱动身体的数据**。
    宽松地接收会让一次模型抽风变成一次用户可见的异常行为。
    """

    goal: str
    emotion: str = "normal"
    reason: str = Field(default="", max_length=200)
    utterance: str | None = Field(default=None, max_length=60)
    capability_request: str | None = Field(default=None, alias="capabilityRequest")
    memory_proposal: str | None = Field(
        default=None, alias="memoryProposal", max_length=200
    )
    expires_in: int = Field(default=120, alias="expiresIn", ge=10, le=600)

    model_config = {"populate_by_name": True}


@dataclass(frozen=True)
class CognitionInput:
    """架构文档 §4.2 列出的六项输入。"""

    needs: dict[str, float]
    mood: dict[str, Any]
    relationship: dict[str, Any]
    page: str
    local_time: str
    recent_interactions: list[str]
    memories: list[str]
    active_task: str | None
    proactive_budget_left: int
    #: 对方今天的情绪打卡，人话形式（"有点低落（没睡好）"）。没打卡就是 None。
    #: 有了它，主动搭话才能从「你很久没互动了」变成「有事说事」（计划文档 §2.4）。
    #: **宠物只知道对方标了什么，不知道为什么**——可以关心，不可以推断原因。
    partner_mood: str | None = None


def _strip_fence(raw: str) -> str:
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1]
        text = text.rsplit("```", 1)[0]
    return text.strip()


def parse_proposal(raw: str) -> CognitionProposal | None:
    """把模型输出解析成提案。任何不合规都返回 None，绝不抛给调用方。

    校验分两层：Schema 层管形状，这里管取值——模型很容易编出一个语义上合理
    但系统里不存在的 goal（比如 "comfort"），那种东西进了仲裁器就是死代码。
    """
    try:
        payload = json.loads(_strip_fence(raw))
    except (json.JSONDecodeError, TypeError):
        logger.info("Cognition 输出不是 JSON，已丢弃")
        return None
    if not isinstance(payload, dict):
        return None
    try:
        proposal = CognitionProposal.model_validate(payload)
    except ValidationError as error:
        logger.info("Cognition 输出未过 Schema，已丢弃：%s", error.error_count())
        return None
    if proposal.goal not in ALLOWED_GOALS:
        logger.info("Cognition 提出了不存在的目标 %s，已丢弃", proposal.goal)
        return None
    if proposal.emotion not in ALLOWED_EMOTIONS:
        # 情绪越界不至于丢掉整条提案，回落到中性即可。
        proposal = proposal.model_copy(update={"emotion": "normal"})
    if proposal.capability_request and not proposal.capability_request.endswith(
        (".list", ".read")
    ):
        # 宠物只能建议、不得擅自执行写操作（架构文档 §6.4）。
        # 这里不是拒绝整条提案，只是把越权的那部分摘掉。
        proposal = proposal.model_copy(update={"capability_request": None})
    return proposal


def build_prompt(payload: CognitionInput) -> str:
    interactions = "、".join(payload.recent_interactions[-5:]) or "暂无"
    memories = "\n".join(f"- {item}" for item in payload.memories[:6]) or "暂无"
    needs = ", ".join(f"{key}={value:.2f}" for key, value in payload.needs.items())
    return (
        f"当前需求：{needs}\n"
        f"当前情绪：{json.dumps(payload.mood, ensure_ascii=False)}\n"
        f"关系状态：{json.dumps(payload.relationship, ensure_ascii=False)}\n"
        f"用户所在页面：{payload.page}\n"
        f"本地时间：{payload.local_time}\n"
        f"最近互动：{interactions}\n"
        f"相关长期记忆：\n{memories}\n"
        f"当前任务：{payload.active_task or '无'}\n"
        f"对方今天的心情：{payload.partner_mood or '今天还没打卡'}\n"
        f"今天还能主动打扰的次数：{payload.proactive_budget_left}\n"
    )


class CognitionAgent:
    """只调一次模型，不进 agent loop。

    刻意不用 `create_agent`：宠物想一件事应该是一次有界的推理，不是一个可能
    自己转好几圈、调好几个工具的循环。真需要读数据时，由调用方把数据装进
    输入里——这样超时上限才是可控的。
    """

    def __init__(self, model: Any):
        self.model = model
        self.spec = spec_for(AgentRole.COGNITION)

    async def think(self, payload: CognitionInput) -> CognitionProposal | None:
        try:
            response = await asyncio.wait_for(
                self.model.ainvoke(
                    [
                        SystemMessage(content=SYSTEM_PROMPT),
                        HumanMessage(content=build_prompt(payload)),
                    ]
                ),
                timeout=self.spec.timeout_seconds,
            )
        except TimeoutError:
            logger.info("Cognition 超时，已丢弃")
            return None
        except Exception:
            logger.info("Cognition 调用失败，已丢弃", exc_info=True)
            return None
        content = getattr(response, "content", "")
        if isinstance(content, list):
            content = "".join(
                block.get("text", "")
                for block in content
                if isinstance(block, dict)
            )
        return parse_proposal(content)
