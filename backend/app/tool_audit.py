from typing import Any

from langchain.agents.middleware import wrap_tool_call
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.agent_context import AgentContext
from app.models import ToolRun, utcnow


def _safe_result(value: Any) -> dict[str, Any]:
    content = getattr(value, "content", value)
    if isinstance(content, dict):
        return content
    if isinstance(content, (str, int, float, bool)) or content is None:
        return {"value": content}
    return {"value": str(content)}


def build_tool_audit_middleware(
    session_maker: async_sessionmaker[AsyncSession],
):
    @wrap_tool_call
    async def audit_tool_call(request, handler):
        context: AgentContext = request.runtime.context
        tool_call = request.tool_call
        run = ToolRun(
            user_id=context.user_id,
            conversation_id=context.conversation_id,
            tool_name=str(tool_call.get("name", "")),
            arguments=tool_call.get("args") or {},
            status="running",
        )
        async with session_maker() as db:
            db.add(run)
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
                    await db.commit()
            raise
        async with session_maker() as db:
            stored = await db.get(ToolRun, run.id)
            if stored is not None:
                stored.status = "completed"
                stored.result = _safe_result(result)
                stored.completed_at = utcnow()
                await db.commit()
        return result

    return audit_tool_call
