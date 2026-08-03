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

from sqlalchemy.ext.asyncio import AsyncSession

from app.capability_catalog import CHAT, resolve_tool
from app.models import AgentTask, utcnow

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

#: 一轮对话本身的能力标识。工具步骤会覆盖为各自能力。
CHAT_CAPABILITY = CHAT.key


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


def describe_step(tool_name: str, tool_input: Any) -> TaskStep:
    """把一次工具调用翻译成语义层描述。

    `safe_summary` 只由工具名和资源类型拼出——**不含 payload**。摘要会经 SSE
    发到前端并可能显示在气泡里，把用户数据带进来等于把内容泄进日志和 UI。
    """
    spec, summary = resolve_tool(tool_name, tool_input)

    return TaskStep(
        capability=spec.key,
        risk_level=spec.risk_level,
        safe_summary=summary,
        external=spec.external,
    )


async def create_task(
    db: AsyncSession,
    *,
    task_id: str,
    user_id: str,
    companion_id: str,
    conversation_id: str | None,
) -> AgentTask:
    task = AgentTask(
        id=task_id,
        user_id=user_id,
        companion_id=companion_id,
        conversation_id=conversation_id,
        capability=CHAT_CAPABILITY,
        status="created",
        risk_level="none",
        safe_summary="回应你",
    )
    db.add(task)
    await db.commit()
    return task


async def update_task(
    db: AsyncSession,
    task_id: str,
    status: AgentTaskStatus,
    *,
    result_summary: str | None = None,
) -> None:
    task = await db.get(AgentTask, task_id)
    if task is None:
        return
    task.status = status
    if result_summary is not None:
        task.result_summary = result_summary
    if status in {"succeeded", "failed", "cancelled"}:
        task.completed_at = utcnow()
    await db.commit()


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
