"""让宠物读用户自己电脑上的文件。**只读。**

## 和工作区工具的区别

`workspace_*` 操作的是服务器沙箱里那块草稿纸——写坏了最多丢掉草稿。
`local_*` 碰的是**用户真实的家目录**，所以规矩完全不同：

- 只有读，没有写、没有执行（那是三期，要带审批）
- 白名单**在用户那台电脑上校验**，不在这里。服务端这份名单只用于展示。
  把闸门放在可能被提示注入影响的一侧，那不叫闸门
- 电脑不在线是常态，不是错误——文案要能直接给模型看

## 为什么工具描述里要写清"用户自己的电脑"

模型得能分清这两套工具。描述含糊的话，它会拿 `local_read` 去找自己
刚用 `workspace_write` 写的文件，然后困惑地重试——那个文件在服务器上，
不在用户的电脑上。
"""

from __future__ import annotations

from typing import Any

from langchain.tools import ToolRuntime, tool
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.local_executor import NoExecutorError, dispatch


def build_local_tools(session_maker: async_sessionmaker[AsyncSession]) -> list:
    async def run(
        runtime: ToolRuntime, tool_name: str, **arguments: Any
    ) -> Any:
        try:
            return await dispatch(
                session_maker, runtime.context.user_id, tool_name, arguments
            )
        except NoExecutorError as error:
            # 不抛出去——「电脑没开」是完全正常的情况，模型应该顺着说下去
            # （「等你回到电脑前我再看」），而不是把一个异常栈变成一次失败重试。
            return {"error": str(error)}

    @tool("local_list")
    async def local_list(path: str, runtime: ToolRuntime) -> Any:
        """列出**用户自己电脑上**某个目录里的文件。

        只能看用户授权过的目录，其余一律拒绝。path 用绝对路径，
        `~` 会被展开。想知道能看哪些目录，用 local_roots。
        """
        return await run(runtime, "local_list", path=path)

    @tool("local_read")
    async def local_read(path: str, runtime: ToolRuntime) -> Any:
        """读**用户自己电脑上**的一个文本文件，过长会截断。

        只能读授权目录里的文件。二进制文件读不了。
        """
        return await run(runtime, "local_read", path=path)

    @tool("local_search")
    async def local_search(path: str, pattern: str, runtime: ToolRuntime) -> Any:
        """在**用户自己电脑上**的某个目录里按文件名找东西。

        pattern 是 glob，比如 `*.md`、`2026*`。只搜授权目录。
        """
        return await run(runtime, "local_search", path=path, pattern=pattern)

    @tool("local_info")
    async def local_info(path: str, runtime: ToolRuntime) -> Any:
        """看**用户自己电脑上**某个文件的信息（大小、修改时间、是不是目录）。"""
        return await run(runtime, "local_info", path=path)

    @tool("local_roots")
    async def local_roots(runtime: ToolRuntime) -> Any:
        """看用户授权了哪些目录给你。

        **不确定路径能不能读时先调它**，比瞎试一个然后被拒绝要好。
        """
        return await run(runtime, "local_roots")

    return [local_list, local_read, local_search, local_info, local_roots]
