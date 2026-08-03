from __future__ import annotations

import json
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
from langchain.tools import ToolRuntime

from app.config import Settings
from app.mcp_runtime import McpHost
from app.mcp_tools import build_mcp_tools
from app.models import McpServer, McpTool


async def test_find_capabilities_only_returns_reviewed_healthy_tools(session_maker):
    async with session_maker() as db:
        healthy = McpServer(
            name="calendar",
            url="https://mcp.example.com/mcp",
            status="healthy",
            enabled=True,
        )
        disabled = McpServer(
            name="private",
            url="https://mcp.example.com/private",
            status="healthy",
            enabled=False,
        )
        db.add_all([healthy, disabled])
        await db.flush()
        db.add_all(
            [
                McpTool(
                    server_id=healthy.id,
                    name="list_events",
                    description="List calendar events",
                    input_schema={"type": "object"},
                    enabled=True,
                    risk_level="low",
                ),
                McpTool(
                    server_id=healthy.id,
                    name="delete_event",
                    description="Delete calendar event",
                    input_schema={"type": "object"},
                    # 兼容升级前可能遗留的脏状态：运行时仍必须二次挡住 high。
                    enabled=True,
                    risk_level="high",
                ),
                McpTool(
                    server_id=disabled.id,
                    name="private_events",
                    description="List calendar events",
                    input_schema={"type": "object"},
                    enabled=True,
                    risk_level="low",
                ),
            ]
        )
        await db.commit()

    find_tool = build_mcp_tools(session_maker)[0]
    runtime = ToolRuntime(
        state={},
        context=None,
        config={},
        stream_writer=lambda _value: None,
        tool_call_id=None,
        store=None,
        tools=[],
    )
    payload = json.loads(await find_tool.ainvoke({"query": "events", "runtime": runtime}))
    assert [item["tool"] for item in payload] == ["list_events"]
    assert payload[0]["server"] == "calendar"
    assert "url" not in payload[0]


async def test_call_capability_rejects_legacy_enabled_high_risk_tool(
    session_maker,
    monkeypatch,
):
    async with session_maker() as db:
        server = McpServer(
            name="legacy",
            url="https://mcp.example.com/mcp",
            status="healthy",
            enabled=True,
        )
        db.add(server)
        await db.flush()
        db.add(
            McpTool(
                server_id=server.id,
                name="dangerous_write",
                description="Write externally",
                input_schema={"type": "object"},
                enabled=True,
                risk_level="high",
            )
        )
        await db.commit()

    called = False

    async def unexpected_call(*_args, **_kwargs):
        nonlocal called
        called = True
        return {}

    monkeypatch.setattr(McpHost, "call_tool", unexpected_call)
    call_tool = build_mcp_tools(session_maker)[1]
    runtime = ToolRuntime(
        state={},
        context=None,
        config={},
        stream_writer=lambda _value: None,
        tool_call_id=None,
        store=None,
        tools=[],
    )
    result = await call_tool.ainvoke(
        {
            "server": "legacy",
            "tool_name": "dangerous_write",
            "arguments": {},
            "runtime": runtime,
        }
    )
    assert "未启用" in result
    assert called is False


class _CatalogTool:
    def __init__(self, name: str, padding: str = ""):
        self.name = name
        self.padding = padding

    def model_dump(self, **_kwargs):
        return {
            "name": self.name,
            "description": self.padding,
            "inputSchema": {"type": "object"},
        }


async def test_mcp_catalog_enforces_tool_count_and_json_size_limits():
    server = McpServer(name="bounded", url="https://mcp.example.com/mcp")

    class CountSession:
        async def list_tools(self, **_kwargs):
            return SimpleNamespace(
                tools=[_CatalogTool("one"), _CatalogTool("two")],
                nextCursor=None,
            )

    @asynccontextmanager
    async def count_context(_server):
        yield CountSession()

    host = McpHost(Settings(mcp_max_tools=1, mcp_max_catalog_bytes=16_384))
    host.session = count_context
    with pytest.raises(ValueError, match="数量"):
        await host.list_tools(server)

    class SizeSession:
        async def list_tools(self, **_kwargs):
            return SimpleNamespace(
                tools=[_CatalogTool("large", "x" * 20_000)],
                nextCursor=None,
            )

    @asynccontextmanager
    async def size_context(_server):
        yield SizeSession()

    host = McpHost(Settings(mcp_max_tools=10, mcp_max_catalog_bytes=16_384))
    host.session = size_context
    with pytest.raises(ValueError, match="大小"):
        await host.list_tools(server)


async def test_mcp_catalog_rejects_repeated_pagination_cursor():
    server = McpServer(name="loop", url="https://mcp.example.com/mcp")

    class LoopSession:
        async def list_tools(self, **_kwargs):
            return SimpleNamespace(tools=[], nextCursor="same")

    @asynccontextmanager
    async def loop_context(_server):
        yield LoopSession()

    host = McpHost(Settings())
    host.session = loop_context
    with pytest.raises(ValueError, match="游标"):
        await host.list_tools(server)
