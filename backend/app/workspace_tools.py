"""宠物的工作区工具。

给它一块能写东西、能跑脚本的地方——算个账、把一堆数据整理成表、把下载来的
文件看一眼。**执行全部发生在 skill-worker 那个已加固的沙箱里**，这一层只是
把它的 HTTP 接口包成工具。

## 下载为什么不在沙箱里做

沙箱挂在 `skill-internal` 这个 `internal: true` 的网段上，**根本没有外网**。
那不是疏忽，是它最有价值的性质之一：脚本再怎么跑飞也带不走数据。

所以下载放在这一层：先过 `guard_url`（已有的 SSRF 防护，挡内网地址、非
http(s) 协议），在 API 侧取回内容，再通过 worker 的写接口落进工作区。沙箱那
边看到的只是一个已经躺在磁盘上的文件，全程不需要给它开一个出口。
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
from langchain.tools import tool

from app.config import Settings
from app.web_tools import guard_url

logger = logging.getLogger(__name__)

#: 单次下载的上限。工作区总量另有限制，这里挡的是「一个链接就把配额吃光」。
MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024


def build_workspace_tools(settings: Settings) -> list:
    base = settings.skill_worker_url.rstrip("/")
    headers = {"X-Skill-Worker-Token": settings.skill_worker_token}
    timeout = settings.skill_script_timeout + 10

    async def call(method: str, path: str, **kwargs) -> Any:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.request(
                method, f"{base}{path}", headers=headers, **kwargs
            )
            if response.status_code >= 400:
                # 把 worker 的人话错误原样带回去：模型看到「工作区总量超上限」
                # 才知道该去清理，看到「500」只会重试。
                detail = ""
                try:
                    detail = response.json().get("detail", "")
                except Exception:
                    detail = response.text[:200]
                raise ValueError(detail or f"工作区操作失败（{response.status_code}）")
            if response.status_code == 204:
                return None
            return response.json()

    @tool("workspace_list")
    async def workspace_list() -> list[dict[str, Any]]:
        """列出工作区里的文件（路径、大小、修改时间）。"""
        return await call("GET", "/workspace/list")

    @tool("workspace_write")
    async def workspace_write(path: str, content: str) -> dict[str, Any]:
        """在工作区写一个文本文件。path 是相对路径，会自动建目录。

        用来写分析脚本、存中间结果、记草稿。工作区有总量和文件数上限，
        写不下时会明确告诉你。
        """
        return await call(
            "POST", "/workspace/write", json={"path": path, "content": content}
        )

    @tool("workspace_read")
    async def workspace_read(path: str) -> str:
        """读工作区里的一个文件，内容过长会被截断。"""
        result = await call("GET", "/workspace/read", params={"path": path})
        return result["content"]

    @tool("workspace_delete")
    async def workspace_delete(path: str) -> str:
        """删掉工作区里的一个文件或目录。"""
        await call("DELETE", "/workspace/file", params={"path": path})
        return f"已删除 {path}"

    @tool("workspace_run")
    async def workspace_run(
        script: str, arguments: list[str] | None = None
    ) -> dict[str, Any]:
        """跑工作区里的一个 Python 脚本，返回 returnCode / stdout / stderr。

        脚本在隔离沙箱里执行：没有外网、有超时和输出上限。需要数据的话先用
        workspace_write 把数据写进去，或者先用站内查询工具取到再写。
        """
        return await call(
            "POST",
            "/workspace/run",
            json={"script": script, "arguments": arguments or []},
        )

    @tool("workspace_download")
    async def workspace_download(url: str, path: str) -> dict[str, Any]:
        """把一个链接的内容下载到工作区。

        只支持 http/https 公网地址，内网地址会被拒绝。大文件会被截断。
        """
        safe_url = await guard_url(url)
        async with httpx.AsyncClient(
            timeout=30.0, follow_redirects=True, max_redirects=3
        ) as client:
            response = await client.get(safe_url)
            response.raise_for_status()
            payload = response.content[:MAX_DOWNLOAD_BYTES]

        # 通过 worker 落盘，而不是这一层直接写：工作区是挂在沙箱容器里的卷，
        # API 容器根本看不到那个路径。
        return await call(
            "POST",
            "/workspace/write",
            json={
                "path": path,
                "content": payload.decode("utf-8", errors="replace"),
            },
        )

    return [
        workspace_list,
        workspace_write,
        workspace_read,
        workspace_delete,
        workspace_run,
        workspace_download,
    ]
