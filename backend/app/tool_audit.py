import json
from typing import Any

from langchain.agents.middleware import wrap_tool_call
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.agent_context import AgentContext
from app.agent_tasks import describe_step
from app.models import ActionReceipt, AgentTask, AgentTaskStep, Attachment, ToolRun, utcnow


def _safe_result(value: Any) -> dict[str, Any]:
    content = getattr(value, "content", value)
    if isinstance(content, dict):
        return content
    if isinstance(content, str):
        try:
            parsed = json.loads(content)
        except json.JSONDecodeError:
            return {"value": content}
        return parsed if isinstance(parsed, dict) else {"value": parsed}
    if isinstance(content, (int, float, bool)) or content is None:
        return {"value": content}
    return {"value": str(content)}


def _receipt_id(result: dict[str, Any]) -> str | None:
    receipt = result.get("actionReceipt")
    if not isinstance(receipt, dict) or receipt.get("status") != "committed":
        return None
    receipt_id = receipt.get("id")
    return receipt_id if isinstance(receipt_id, str) else None


def build_tool_audit_middleware(
    session_maker: async_sessionmaker[AsyncSession],
):
    @wrap_tool_call
    async def audit_tool_call(request, handler):
        context: AgentContext = request.runtime.context
        tool_call = request.tool_call
        tool_name = str(tool_call.get("name", ""))
        arguments = tool_call.get("args") or {}
        semantic_step = describe_step(tool_name, arguments)
        context.task_step_sequence += 1
        sequence = context.task_step_sequence
        run = ToolRun(
            user_id=context.user_id,
            conversation_id=context.conversation_id,
            tool_name=tool_name,
            arguments=arguments,
            status="running",
        )
        async with session_maker() as db:
            db.add(run)
            await db.flush()
            if context.task_id:
                task = await db.get(AgentTask, context.task_id)
                if task is not None:
                    task.status = semantic_step.running_status
                    task.capability = semantic_step.capability
                    if semantic_step.risk_level == "high" or task.risk_level == "none":
                        task.risk_level = semantic_step.risk_level
                    db.add(
                        AgentTaskStep(
                            task_id=task.id,
                            tool_run_id=run.id,
                            sequence=sequence,
                            status=semantic_step.running_status,
                            capability=semantic_step.capability,
                            safe_summary=semantic_step.safe_summary,
                        )
                    )
            await db.commit()
            await db.refresh(run)
        try:
            result = await handler(request)
        except Exception as error:
            async with session_maker() as db:
                stored = await db.get(ToolRun, run.id)
                if stored is not None:
                    stored.status = "failed"
                    stored.result = {"error": str(error)[:2000]}
                    stored.completed_at = utcnow()
                    step = await db.scalar(
                        select(AgentTaskStep).where(AgentTaskStep.tool_run_id == run.id)
                    )
                    if step is not None:
                        step.status = "failed"
                    await db.commit()
            raise
        safe_result = _safe_result(result)
        async with session_maker() as db:
            stored = await db.get(ToolRun, run.id)
            if stored is not None:
                stored.status = "completed"
                stored.result = safe_result
                stored.completed_at = utcnow()
            step = await db.scalar(
                select(AgentTaskStep).where(AgentTaskStep.tool_run_id == run.id)
            )
            if step is not None:
                step.status = "succeeded"
            receipt_id = _receipt_id(safe_result)
            if receipt_id:
                receipt = await db.get(ActionReceipt, receipt_id)
                if receipt is not None:
                    receipt.tool_run_id = run.id
            attachment_id = safe_result.get("attachmentId")
            if isinstance(attachment_id, str):
                attachment = await db.get(Attachment, attachment_id)
                if attachment is not None and attachment.owner_id == context.user_id:
                    attachment.source_tool_run_id = run.id
            await db.commit()
        return result

    return audit_tool_call
