"""任务语义层（架构文档 §6.2 / §6.3）。

`tool.*` 是执行层审计——谁调了什么、返回了什么，面向排查问题。
`agent.task.*` 是语义层——现在这轮在做哪一类事、风险多高、进行到哪一步，
面向宠物的身体表达。两套事件并存，互不替代。

宠物只消费语义层：它不需要知道调的是 `site_resource_delete` 还是
`site_resource_update`，只需要知道「正在改站内数据，风险偏高」。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

AgentTaskStatus = Literal[
    "created",
    "planning",
    "confirmation_required",
    "running",
    "progress",
    "waiting",
    "succeeded",
    "failed",
    "cancelled",
]

RiskLevel = Literal["none", "low", "high"]

#: 一轮对话本身的能力标识。工具步骤会覆盖为各自的 site.* 能力。
CHAT_CAPABILITY = "site.chat"

#: 资源名 → 能力标识（架构文档 §6.1）。
_RESOURCE_CAPABILITY: dict[str, str] = {
    "plan": "site.plan",
    "wish": "site.wish",
    "photo": "site.photo",
    "milestone": "site.timeline",
    "message": "site.message",
    "timer": "site.timer",
}

_RESOURCE_LABEL: dict[str, str] = {
    "plan": "计划",
    "wish": "心愿",
    "photo": "照片",
    "milestone": "时间线",
    "message": "留言",
    "timer": "纪念日",
}

_WRITE_VERB: dict[str, str] = {
    "site_resource_create": "新增",
    "site_resource_update": "修改",
    "site_resource_delete": "删除",
}

#: 工具 → 风险等级（架构文档 §6.4）。
#: 只读为 none；有副作用但可撤销为 low；破坏性或可执行代码为 high。
_TOOL_RISK: dict[str, RiskLevel] = {
    "site_resource_list": "none",
    "site_resource_create": "low",
    "site_resource_update": "low",
    "site_resource_delete": "high",
    "site_pet_action": "none",
    "list_skills": "none",
    "load_skill": "none",
    "read_skill_resource": "none",
    "run_skill_script": "high",
    # 联网只读，但打的是站外服务，风险等级按 low 而不是 none——
    # 它会把查询词发出去，本身就是一次对外披露。
    "web_search": "low",
    "web_read": "low",
    # 生成文档会新建一条附件记录，属于可撤销的写操作。
    "create_document": "low",
}

#: 执行体在站外、时长不由本进程决定的工具。这类步骤的语义是「等」而不是「做」，
#: 对应架构文档 §6.3 的 waiting 行。
_EXTERNAL_TOOLS = frozenset({"run_skill_script", "web_search", "web_read"})


@dataclass(frozen=True)
class TaskStep:
    """一次工具调用在语义层的投影。对应 P3 的 AgentTaskStep。"""

    capability: str
    risk_level: RiskLevel
    safe_summary: str
    external: bool

    @property
    def running_status(self) -> AgentTaskStatus:
        return "waiting" if self.external else "running"


def _resource_of(tool_input: Any) -> str | None:
    if isinstance(tool_input, dict):
        value = tool_input.get("resource")
        if isinstance(value, str) and value:
            return value
    return None


def describe_step(tool_name: str, tool_input: Any) -> TaskStep:
    """把一次工具调用翻译成语义层描述。

    `safe_summary` 只由工具名和资源类型拼出——**不含 payload**。摘要会经 SSE
    发到前端并可能显示在气泡里，把用户数据带进来等于把内容泄进日志和 UI。
    """
    risk = _TOOL_RISK.get(tool_name, "low")
    resource = _resource_of(tool_input)
    label = _RESOURCE_LABEL.get(resource or "", "站内数据")

    if tool_name == "site_resource_list":
        capability = _RESOURCE_CAPABILITY.get(resource or "", "site.plan")
        summary = f"查询{label}"
    elif tool_name in _WRITE_VERB:
        capability = _RESOURCE_CAPABILITY.get(resource or "", "site.plan")
        summary = f"{_WRITE_VERB[tool_name]}{label}"
    elif tool_name == "site_pet_action":
        capability = "site.pet"
        summary = "做一个动作"
    elif tool_name in {"list_skills", "load_skill", "read_skill_resource"}:
        capability = "site.skill"
        summary = "查阅 Skill"
    elif tool_name == "run_skill_script":
        capability = "site.skill"
        summary = "执行 Skill 脚本"
    elif tool_name == "web_search":
        capability = "web.search"
        summary = "上网查一下"
    elif tool_name == "web_read":
        capability = "web.read"
        summary = "读一个网页"
    elif tool_name == "create_document":
        capability = "site.document"
        summary = "做一份文档"
    else:
        capability = CHAT_CAPABILITY
        summary = "处理请求"

    return TaskStep(
        capability=capability,
        risk_level=risk,
        safe_summary=summary,
        external=tool_name in _EXTERNAL_TOOLS,
    )


def task_event(
    status: AgentTaskStatus,
    task_id: str,
    *,
    step: TaskStep | None = None,
    sequence: int | None = None,
) -> tuple[str, dict[str, Any]]:
    """构造 (SSE 事件名, payload)。事件名沿用架构文档 §6.2 的点分状态。"""
    payload: dict[str, Any] = {
        "taskId": task_id,
        "capability": step.capability if step else CHAT_CAPABILITY,
        "safeSummary": step.safe_summary if step else "回应你",
        "riskLevel": step.risk_level if step else "none",
    }
    if sequence is not None:
        payload["sequence"] = sequence
    return f"agent.task.{status}", payload
