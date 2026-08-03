"""让服务器 Agent 通过受控桌面代理读写用户自己电脑上的文件。

## 和工作区工具的区别

`workspace_*` 操作的是服务器沙箱里那块草稿纸——写坏了最多丢掉草稿。
`local_*` 碰的是**用户真实的家目录**，所以规矩完全不同：

- 白名单**在用户那台电脑上校验**，不在这里。服务端那份名单只用于展示。
  把闸门放在可能被提示注入影响的一侧，那不叫闸门
- 读可以自动；写操作按本机策略确认，而且写之前会先备份
- 电脑不在线是常态，不是错误——文案要能直接给模型看

这里刻意没有通用命令、Python、JavaScript 或二进制执行工具。客户端不是
Agent Runtime，也不能成为服务器下发任意代码的入口；需要运行环境的任务必须
进入服务器 workspace/skill/document 等隔离 Worker。

## 改文件优先用 edit / append，不要整个覆盖

`local_write` 会把原内容整个换掉。「读出来 → 改几个字 → 整份写回去」
这条路很容易在中间丢掉原文的某些部分，而那种丢失事后很难发现。
工具描述里也是这么写的——模型选哪个工具，基本上就取决于那几句话。

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

    @tool("local_write")
    async def local_write(path: str, content: str, runtime: ToolRuntime) -> Any:
        """在**用户自己电脑上**写一个文本文件（新建或**整个覆盖**）。

        **改已有文件优先用 local_edit（精确替换）或 local_append（追加）。**
        这个工具会把原内容整个换掉——读出来、改几个字、再整份写回去的做法，
        很容易在中间把原文的某些部分弄丢，而那种丢失很难被发现。

        **每一次都会弹出系统确认框给用户看**，显示完整路径和内容开头——
        你写的东西他会先过目。被拒绝时直接说明，不要换个路径重试。

        覆盖已有文件时原文件会自动备份，可以找回。只能写在授权目录里。
        """
        return await run(runtime, "local_write", path=path, content=content)

    @tool("local_append")
    async def local_append(path: str, content: str, runtime: ToolRuntime) -> Any:
        """在**用户自己电脑上**某个文件的末尾追加内容。

        原文件不以换行结尾时会自动补一个，追加的内容不会黏在最后一行后面。
        文件不存在就等同于新建。

        记流水账、往清单里加一条，用这个——比读出来再整个写回去安全得多，
        中间不会把原有内容弄丢。
        """
        return await run(runtime, "local_append", path=path, content=content)

    @tool("local_edit")
    async def local_edit(
        path: str, old_text: str, new_text: str, runtime: ToolRuntime
    ) -> Any:
        """改**用户自己电脑上**某个文件里的一段内容（精确替换）。

        **先用 local_read 看过原文再改，不要凭印象。**
        `old_text` 必须和文件里的原文一字不差，而且**在整个文件里只能出现一次**
        ——出现多次会被拒绝，那时候把 `old_text` 取长一点（多带上下几行），
        让它只匹配你要改的那一处。

        这是改文件的**首选方式**：只动该动的那几行，文件其余部分原样不动。
        整个覆盖（local_write）只在重写整份内容时才用。
        """
        return await run(
            runtime, "local_edit", path=path, old_text=old_text, new_text=new_text
        )

    @tool("local_roots")
    async def local_roots(runtime: ToolRuntime) -> Any:
        """看用户授权了哪些目录给你。

        **不确定路径能不能读时先调它**，比瞎试一个然后被拒绝要好。
        """
        return await run(runtime, "local_roots")

    return [
        local_list,
        local_read,
        local_search,
        local_info,
        local_write,
        local_append,
        local_edit,
        local_roots,
    ]
