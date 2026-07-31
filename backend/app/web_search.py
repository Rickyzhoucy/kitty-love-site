"""联网搜索的提供方适配层。

**为什么是可插拔的**：搜索服务是这套系统里唯一一个「选谁取决于机器部署在哪」
的依赖。部署在国内的服务器访问 Tavily / Brave 大概率超时，部署在海外访问博查
同理。把它写死成任何一家，都会在换环境时炸。

**为什么不用百炼自带的联网搜索**：它只以 MCP 形式提供
（`dashscope.aliyuncs.com/api/v1/mcps/WebSearch/mcp`），要在后端实现一个
streamable-HTTP 的 MCP 客户端才能调；而这里三家都是一次普通 POST。
等将来后端本来就要接 MCP 时，再把它加成第四个 provider 更划算。

没有配 `WEB_SEARCH_API_KEY` 时，`build_search_provider` 返回 None，
联网工具**根本不会注册**——而不是注册了、调用时再报错。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Protocol

import httpx

from app.config import Settings, get_settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SearchHit:
    title: str
    url: str
    snippet: str
    published_at: str | None = None


class SearchProvider(Protocol):
    name: str

    async def search(self, query: str, count: int) -> list[SearchHit]: ...


def _clip(text: Any, limit: int = 600) -> str:
    return str(text or "").strip()[:limit]


class BochaSearchProvider:
    """博查（bochaai.com）。国内可直连，返回结构接近 Bing。"""

    name = "bocha"
    endpoint = "https://api.bochaai.com/v1/web-search"

    def __init__(self, api_key: str, timeout: float):
        self.api_key = api_key
        self.timeout = timeout

    async def search(self, query: str, count: int) -> list[SearchHit]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                self.endpoint,
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={"query": query, "count": count, "summary": True},
            )
            response.raise_for_status()
            payload = response.json()
        pages = ((payload.get("data") or payload).get("webPages") or {}).get("value") or []
        return [
            SearchHit(
                title=_clip(item.get("name"), 200),
                url=str(item.get("url") or ""),
                snippet=_clip(item.get("summary") or item.get("snippet")),
                published_at=item.get("datePublished"),
            )
            for item in pages
            if item.get("url")
        ]


class TavilySearchProvider:
    """Tavily。面向 Agent 的检索，返回的是已排序、已裁剪的正文片段。"""

    name = "tavily"
    endpoint = "https://api.tavily.com/search"

    def __init__(self, api_key: str, timeout: float):
        self.api_key = api_key
        self.timeout = timeout

    async def search(self, query: str, count: int) -> list[SearchHit]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                self.endpoint,
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={"query": query, "max_results": count, "search_depth": "basic"},
            )
            response.raise_for_status()
            payload = response.json()
        return [
            SearchHit(
                title=_clip(item.get("title"), 200),
                url=str(item.get("url") or ""),
                snippet=_clip(item.get("content")),
            )
            for item in payload.get("results") or []
            if item.get("url")
        ]


class BraveSearchProvider:
    """Brave。独立索引，不依赖 Google/Bing。"""

    name = "brave"
    endpoint = "https://api.search.brave.com/res/v1/web/search"

    def __init__(self, api_key: str, timeout: float):
        self.api_key = api_key
        self.timeout = timeout

    async def search(self, query: str, count: int) -> list[SearchHit]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(
                self.endpoint,
                headers={
                    "X-Subscription-Token": self.api_key,
                    "Accept": "application/json",
                },
                params={"q": query, "count": count},
            )
            response.raise_for_status()
            payload = response.json()
        return [
            SearchHit(
                title=_clip(item.get("title"), 200),
                url=str(item.get("url") or ""),
                snippet=_clip(item.get("description")),
                published_at=item.get("age"),
            )
            for item in (payload.get("web") or {}).get("results") or []
            if item.get("url")
        ]


PROVIDERS: dict[str, type[BochaSearchProvider | TavilySearchProvider | BraveSearchProvider]] = {
    "bocha": BochaSearchProvider,
    "tavily": TavilySearchProvider,
    "brave": BraveSearchProvider,
}


def build_search_provider(settings: Settings | None = None) -> SearchProvider | None:
    """按配置装配搜索提供方。没配 key 就返回 None。"""
    config = settings or get_settings()
    if not config.web_search_api_key:
        return None
    factory = PROVIDERS.get(config.web_search_provider.lower())
    if factory is None:
        logger.warning(
            "未知的 WEB_SEARCH_PROVIDER=%s，联网搜索未启用（可选：%s）",
            config.web_search_provider,
            ", ".join(sorted(PROVIDERS)),
        )
        return None
    return factory(config.web_search_api_key, config.web_search_timeout)
