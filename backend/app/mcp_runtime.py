"""服务器 MCP Client/Host。

只支持 Admin 登记的 Streamable HTTP 服务。连接、认证头、Schema 同步和调用都在
服务器；浏览器与 Tauri 永远拿不到 MCP 凭据，也不会启动 MCP 子进程。
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import timedelta
from typing import Any

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import runtime_config
from app.config import Settings
from app.models import McpServer, McpTool, utcnow


def encrypt_headers(headers: dict[str, str], settings: Settings) -> str:
    if not headers:
        return ""
    return runtime_config.encrypt_secret(
        json.dumps(headers, ensure_ascii=False, separators=(",", ":")), settings
    )


def decrypt_headers(server: McpServer, settings: Settings) -> dict[str, str]:
    if not server.auth_headers_ciphertext:
        return {}
    raw = runtime_config.decrypt_secret(server.auth_headers_ciphertext, settings)
    if raw is None:
        raise ValueError("MCP 认证配置无法解密")
    payload = json.loads(raw)
    if not isinstance(payload, dict) or not all(
        isinstance(key, str) and isinstance(value, str) for key, value in payload.items()
    ):
        raise ValueError("MCP 认证配置格式无效")
    return payload


class McpHost:
    def __init__(self, settings: Settings):
        self.settings = settings

    @asynccontextmanager
    async def session(self, server: McpServer) -> AsyncIterator[ClientSession]:
        if server.transport != "streamable_http":
            raise ValueError("当前服务器只允许 Streamable HTTP MCP")
        headers = decrypt_headers(server, self.settings)
        async with httpx.AsyncClient(
            headers=headers,
            timeout=self.settings.mcp_timeout,
            follow_redirects=False,
        ) as client:
            async with streamable_http_client(server.url, http_client=client) as (
                read_stream,
                write_stream,
                _,
            ):
                async with ClientSession(
                    read_stream,
                    write_stream,
                    read_timeout_seconds=timedelta(seconds=self.settings.mcp_timeout),
                ) as session:
                    await session.initialize()
                    yield session

    async def list_tools(self, server: McpServer) -> list[dict[str, Any]]:
        tools: list[dict[str, Any]] = []
        cursor: str | None = None
        async with self.session(server) as session:
            while True:
                page = await session.list_tools(cursor=cursor)
                tools.extend(tool.model_dump(by_alias=True, mode="json") for tool in page.tools)
                cursor = page.nextCursor
                if not cursor:
                    break
        return tools

    async def sync_tools(self, db: AsyncSession, server: McpServer) -> list[McpTool]:
        discovered = await self.list_tools(server)
        existing = {
            item.name: item
            for item in await db.scalars(select(McpTool).where(McpTool.server_id == server.id))
        }
        names: set[str] = set()
        for payload in discovered:
            name = str(payload.get("name", "")).strip()
            if not name:
                continue
            names.add(name)
            item = existing.get(name)
            if item is None:
                item = McpTool(server_id=server.id, name=name, enabled=False, risk_level="high")
                db.add(item)
            item.description = str(payload.get("description") or "")[:20_000]
            item.input_schema = payload.get("inputSchema") or {}
            item.output_schema = payload.get("outputSchema")
            item.annotations = payload.get("annotations") or {}
        if names:
            await db.execute(
                delete(McpTool).where(McpTool.server_id == server.id, McpTool.name.not_in(names))
            )
        else:
            await db.execute(delete(McpTool).where(McpTool.server_id == server.id))
        server.status = "healthy"
        server.last_error = None
        server.last_synced_at = utcnow()
        await db.commit()
        return list(
            await db.scalars(
                select(McpTool).where(McpTool.server_id == server.id).order_by(McpTool.name)
            )
        )

    async def call_tool(
        self,
        server: McpServer,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> dict[str, Any]:
        async with self.session(server) as session:
            result = await session.call_tool(tool_name, arguments=arguments)
        payload = result.model_dump(by_alias=True, mode="json")
        encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
        if len(encoded) > self.settings.mcp_max_result_bytes:
            raise ValueError("MCP 工具结果超过上下文上限")
        return payload
