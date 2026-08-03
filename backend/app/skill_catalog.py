"""服务器侧 Agent Skill 目录适配器。

它只拉取目录已快照的文本文件，不在 API 容器里运行 npx/git/安装脚本。文件经
路径、数量、单文件和总大小限制后打成 ZIP，再交给现有 SkillPackageValidator。
"""

from __future__ import annotations

import io
import re
import zipfile
from pathlib import PurePosixPath
from typing import Any
from urllib.parse import urlparse

import httpx

from app.config import Settings
from app.web_tools import guard_url

SKILL_CATALOG_ID = re.compile(r"^[A-Za-z0-9_-]+(?:[./][A-Za-z0-9_-]+)+$")


class SkillCatalog:
    def __init__(self, base_url: str, token: str, settings: Settings):
        parsed = urlparse(base_url.strip())
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ValueError("Skill 目录 URL 无效")
        if parsed.username or parsed.password or parsed.fragment:
            raise ValueError("Skill 目录 URL 不能内嵌凭据或片段")
        if settings.app_env != "development" and parsed.scheme != "https":
            raise ValueError("生产环境 Skill 目录必须使用 HTTPS")
        self.base_url = base_url.rstrip("/")
        self.token = token.strip()
        self.settings = settings

    @staticmethod
    def validate_id(skill_id: str) -> str:
        value = skill_id.strip().strip("/")
        if (
            len(value) > 300
            or not SKILL_CATALOG_ID.fullmatch(value)
            or any(part in {".", ".."} for part in value.split("/"))
        ):
            raise ValueError("Skill 目录 ID 无效")
        return value

    async def _get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        headers = {"Accept": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        url = f"{self.base_url}{path}"
        if self.settings.app_env != "development":
            # URL 可由后台配置，出站前必须在 DNS 解析后排除回环、内网和元数据地址。
            url = await guard_url(url)
        async with httpx.AsyncClient(
            timeout=self.settings.skill_catalog_timeout,
            follow_redirects=False,
            headers=headers,
        ) as client:
            response = await client.get(url, params=params)
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError("Skill 目录返回了无效 JSON")
        return payload

    async def search(self, query: str, limit: int = 20) -> list[dict[str, Any]]:
        value = query.strip()
        if len(value) < 2 or len(value) > 200:
            raise ValueError("请输入 2–200 个字符的搜索词")
        payload = await self._get(
            "/api/v1/skills/search",
            {"q": value, "limit": max(1, min(limit, 50))},
        )
        data = payload.get("data")
        if not isinstance(data, list):
            raise ValueError("Skill 目录搜索结果格式无效")
        return [item for item in data if isinstance(item, dict)][:50]

    async def detail(self, skill_id: str) -> dict[str, Any]:
        return await self._get(f"/api/v1/skills/{self.validate_id(skill_id)}")

    async def audits(self, skill_id: str) -> list[dict[str, Any]]:
        try:
            payload = await self._get(
                f"/api/v1/skills/audit/{self.validate_id(skill_id)}"
            )
        except httpx.HTTPStatusError as error:
            if error.response.status_code == 404:
                return []
            raise
        audits = payload.get("audits")
        if not isinstance(audits, list):
            raise ValueError("Skill 审计结果格式无效")
        return [item for item in audits if isinstance(item, dict)]

    def build_archive(self, detail: dict[str, Any]) -> bytes:
        files = detail.get("files")
        if not isinstance(files, list) or not files:
            raise ValueError("这个 Skill 没有可安装的文件快照")
        if len(files) > self.settings.skill_max_files:
            raise ValueError("Skill 文件数超过限制")

        total = 0
        seen: set[str] = set()
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for item in files:
                if not isinstance(item, dict):
                    raise ValueError("Skill 文件快照格式无效")
                raw_path = item.get("path")
                contents = item.get("contents")
                if not isinstance(raw_path, str) or not isinstance(contents, str):
                    raise ValueError("Skill 文件快照格式无效")
                path = PurePosixPath(raw_path.replace("\\", "/"))
                normalized = str(path)
                if (
                    path.is_absolute()
                    or ".." in path.parts
                    or normalized in {"", "."}
                    or normalized in seen
                ):
                    raise ValueError("Skill 文件快照包含不安全路径")
                data = contents.encode("utf-8")
                if len(data) > self.settings.skill_max_file_bytes:
                    raise ValueError(f"Skill 文件过大：{normalized}")
                total += len(data)
                if total > self.settings.skill_max_expanded_bytes:
                    raise ValueError("Skill 文件总量超过限制")
                seen.add(normalized)
                archive.writestr(normalized, data)
        result = output.getvalue()
        if len(result) > self.settings.skill_max_archive_bytes:
            raise ValueError("Skill ZIP 超过限制")
        return result


def enforce_audit_policy(audits: list[dict[str, Any]], acknowledge_risk: bool) -> None:
    """拦住确定危险的 Skill；未审计或警告项需要 Admin 二次确认。"""
    if not audits:
        if not acknowledge_risk:
            raise ValueError("该 Skill 尚无安全审计，需要确认风险后再安装")
        return
    statuses = {str(item.get("status", "")).lower() for item in audits}
    risks = {str(item.get("riskLevel", "")).upper() for item in audits}
    if "fail" in statuses or risks.intersection({"HIGH", "CRITICAL"}):
        raise PermissionError("该 Skill 的安全审计未通过，禁止安装")
    if (statuses - {"pass"} or risks.intersection({"MEDIUM"})) and not acknowledge_risk:
        raise ValueError("该 Skill 存在审计警告，需要确认风险后再安装")
