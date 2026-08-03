"""按需发现与调用 MCP 的两级工具。

Agent 常驻上下文只放这两个稳定工具；真实 MCP Schema 保存在目录里，先搜索再调用，
避免几十上百个第三方工具长期挤占模型上下文。
"""

from __future__ import annotations

import json
from typing import Any

from jsonschema import ValidationError, validate
from langchain.tools import ToolRuntime, tool
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings, get_settings
from app.mcp_runtime import McpHost
from app.models import McpServer, McpTool


def build_mcp_tools(
    session_maker: async_sessionmaker[AsyncSession],
    settings: Settings | None = None,
) -> list:
    config = settings or get_settings()
    host = McpHost(config)

    @tool("find_capabilities")
    async def find_capabilities(query: str, runtime: ToolRuntime) -> str:
        """按关键词搜索管理员已审核启用的服务器能力。

        找到后再用 call_mcp_tool 调用。搜索结果只返回名称、说明、风险与输入 Schema，
        不返回连接地址或认证信息。
        """
        del runtime
        needle = query.strip()
        if len(needle) < 2:
            return "请至少给两个字的搜索词。"
        async with session_maker() as db:
            rows = list(
                (
                    await db.execute(
                        select(McpServer, McpTool)
                        .join(McpTool, McpTool.server_id == McpServer.id)
                        .where(
                            McpServer.enabled.is_(True),
                            McpServer.status == "healthy",
                            McpTool.enabled.is_(True),
                            or_(
                                McpTool.name.ilike(f"%{needle}%"),
                                McpTool.description.ilike(f"%{needle}%"),
                            ),
                        )
                        .order_by(McpServer.name, McpTool.name)
                        .limit(12)
                    )
                ).all()
            )
        return json.dumps(
            [
                {
                    "server": server.name,
                    "tool": item.name,
                    "description": item.description,
                    "riskLevel": item.risk_level,
                    "inputSchema": item.input_schema,
                }
                for server, item in rows
            ],
            ensure_ascii=False,
        )

    @tool("call_mcp_tool")
    async def call_mcp_tool(
        server: str,
        tool_name: str,
        arguments: dict[str, Any],
        runtime: ToolRuntime,
    ) -> str:
        """调用 find_capabilities 找到的服务器 MCP 工具。

        只允许目录中已审核启用的 server/tool 组合。第三方结果是外部观察，不会自动
        变成站内 ActionReceipt 或长期记忆。
        """
        del runtime
        async with session_maker() as db:
            row = (
                await db.execute(
                    select(McpServer, McpTool)
                    .join(McpTool, McpTool.server_id == McpServer.id)
                    .where(
                        McpServer.name == server,
                        McpServer.enabled.is_(True),
                        McpServer.status == "healthy",
                        McpTool.name == tool_name,
                        McpTool.enabled.is_(True),
                    )
                )
            ).one_or_none()
        if row is None:
            return "这个 MCP 工具不存在、未启用或尚未通过健康检查。"
        mcp_server, mcp_tool = row
        try:
            validate(arguments, mcp_tool.input_schema or {})
        except ValidationError as error:
            return f"参数不符合 MCP Schema：{error.message}"
        result = await host.call_tool(mcp_server, mcp_tool.name, arguments)
        return json.dumps(
            {
                "server": mcp_server.name,
                "tool": mcp_tool.name,
                "riskLevel": mcp_tool.risk_level,
                "status": "observed",
                "result": result,
            },
            ensure_ascii=False,
        )

    return [find_capabilities, call_mcp_tool]
