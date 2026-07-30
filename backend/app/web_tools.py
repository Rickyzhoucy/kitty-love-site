"""联网工具：搜索与网页正文提取。

**为什么在 api 进程而不是 Skill**：skill-worker 跑在 `internal: true` 的 Docker
网络上，**没有外网**（见 docker-compose.yml）。那是刻意的沙箱设计——用户上传的
Skill 脚本不该能往外发数据。所以任何需要出网的能力都只能是 api 进程里的工具。

**SSRF 防护**：`web_read` 接受的是模型给的 URL，而模型的 URL 可能来自它读到的
网页内容。不设防的话，一句「访问 http://169.254.169.254/latest/meta-data/」
就能把云主机的凭据读出来。所以这里挡掉非 http(s)、内网地址与回环地址。
"""

from __future__ import annotations

import ipaddress
import logging
import socket
from html.parser import HTMLParser
from urllib.parse import urlparse

import anyio
import httpx
from langchain.tools import tool

from app.config import Settings, get_settings
from app.web_search import SearchProvider

logger = logging.getLogger(__name__)

#: 正文提取时整段丢弃的标签——它们的内容对阅读没有意义。
_SKIP_TAGS = frozenset({"script", "style", "noscript", "template", "svg", "iframe"})
#: 这些标签结束时补一个换行，否则整页会挤成一行。
_BLOCK_TAGS = frozenset(
    {
        "p", "div", "section", "article", "br", "li", "tr",
        "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre",
    }
)


class _TextExtractor(HTMLParser):
    """极简正文提取。

    不引 readability / beautifulsoup：目标是喂给模型的可读文本，不是还原排版。
    标准库够用，也省掉一个需要跟着安全更新的依赖。
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip_depth = 0
        self.title = ""
        self._in_title = False

    def handle_starttag(self, tag: str, attrs) -> None:
        del attrs
        if tag in _SKIP_TAGS:
            self._skip_depth += 1
        elif tag == "title":
            self._in_title = True

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIP_TAGS:
            self._skip_depth = max(0, self._skip_depth - 1)
        elif tag == "title":
            self._in_title = False
        elif tag in _BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        if self._in_title:
            self.title += data.strip()
            return
        text = data.strip()
        if text:
            self.parts.append(text)

    def text(self) -> str:
        joined = " ".join(self.parts)
        lines = [line.strip() for line in joined.split("\n")]
        return "\n".join(line for line in lines if line)


async def _resolves_to_public_address(host: str) -> bool:
    """域名解析后是否指向公网地址。

    必须在**解析之后**判断：`localtest.me` 这类域名看着是公网域名，
    解析出来却是 127.0.0.1。只检查字面量会被绕过。
    """
    try:
        infos = await anyio.to_thread.run_sync(
            lambda: socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
        )
    except socket.gaierror:
        return False
    if not infos:
        return False
    for info in infos:
        try:
            address = ipaddress.ip_address(info[4][0])
        except ValueError:
            return False
        if (
            address.is_private
            or address.is_loopback
            or address.is_link_local
            or address.is_reserved
            or address.is_multicast
            or address.is_unspecified
        ):
            return False
    return True


async def guard_url(raw_url: str) -> str:
    """校验并返回可以请求的 URL；不安全时抛 ValueError。"""
    parsed = urlparse(raw_url.strip())
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("只支持 http/https 链接")
    if not parsed.hostname:
        raise ValueError("链接缺少主机名")
    if not await _resolves_to_public_address(parsed.hostname):
        raise ValueError("拒绝访问内网或本机地址")
    return parsed.geturl()


def build_web_tools(
    provider: SearchProvider | None,
    settings: Settings | None = None,
) -> list:
    """装配联网工具。没有搜索提供方时，`web_search` 不会被注册。"""
    config = settings or get_settings()
    tools: list = []

    if provider is not None:
        @tool("web_search")
        async def web_search(query: str, count: int = 5) -> str:
            """联网搜索。需要最新信息、站内查不到的事实时使用；返回标题、链接和摘要。"""
            limit = max(1, min(count, config.web_search_max_results))
            try:
                hits = await provider.search(query.strip()[:200], limit)
            except httpx.HTTPError as error:
                logger.info("联网搜索失败：%s", error)
                return "联网搜索暂时不可用。"
            if not hits:
                return "没有搜到相关结果。"
            return "\n\n".join(
                f"{index}. {hit.title}\n{hit.url}\n{hit.snippet}"
                for index, hit in enumerate(hits, start=1)
            )

        tools.append(web_search)

    @tool("web_read")
    async def web_read(url: str) -> str:
        """读取一个网页的正文。搜索结果的摘要不够时，用它打开具体链接。"""
        try:
            safe_url = await guard_url(url)
        except ValueError as error:
            return f"无法访问：{error}"
        try:
            async with httpx.AsyncClient(
                timeout=config.web_fetch_timeout,
                follow_redirects=True,
                max_redirects=3,
                headers={"User-Agent": config.web_fetch_user_agent},
            ) as client:
                async with client.stream("GET", safe_url) as response:
                    response.raise_for_status()
                    content_type = response.headers.get("content-type", "")
                    if "html" not in content_type and "text" not in content_type:
                        return f"这个链接不是网页（{content_type or '未知类型'}）。"
                    # 流式读取并在超限时截断：Content-Length 可以撒谎，
                    # 只信它会被一个声明 1KB、实际 1GB 的响应打爆内存。
                    chunks: list[bytes] = []
                    total = 0
                    async for chunk in response.aiter_bytes():
                        chunks.append(chunk)
                        total += len(chunk)
                        if total >= config.web_fetch_max_bytes:
                            break
                    body = b"".join(chunks)
        except httpx.HTTPError as error:
            logger.info("网页读取失败 %s：%s", safe_url, error)
            return "这个页面打不开。"

        parser = _TextExtractor()
        parser.feed(body.decode("utf-8", errors="replace"))
        text = parser.text()[: config.web_fetch_max_chars]
        if not text:
            return "这个页面没有可读的正文。"
        heading = parser.title.strip()
        return f"{heading}\n\n{text}" if heading else text

    tools.append(web_read)
    return tools
