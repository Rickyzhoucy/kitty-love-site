from __future__ import annotations

import asyncio
import hashlib
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any
from uuid import uuid4

import httpx
import yaml
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.models import OutboxEvent, Skill, SkillVersion
from app.storage import ObjectStorage

SKILL_NAME = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


@dataclass(frozen=True)
class ValidatedSkill:
    root: Path
    name: str
    description: str
    instructions: str


class SkillPackageValidator:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()

    def validate_archive(self, archive: bytes, destination: Path) -> ValidatedSkill:
        if len(archive) > self.settings.skill_max_archive_bytes:
            raise ValueError("Skill ZIP 超过大小限制")
        destination.mkdir(parents=True, exist_ok=False)

        with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
            members = [member for member in bundle.infolist() if not member.is_dir()]
            if not members or len(members) > self.settings.skill_max_files:
                raise ValueError("Skill ZIP 文件数量无效")
            expanded = sum(member.file_size for member in members)
            if expanded > self.settings.skill_max_expanded_bytes:
                raise ValueError("Skill ZIP 解压后超过大小限制")
            for member in members:
                path = PurePosixPath(member.filename.replace("\\", "/"))
                if path.is_absolute() or ".." in path.parts:
                    raise ValueError("Skill ZIP 包含不安全路径")
                if member.file_size > self.settings.skill_max_file_bytes:
                    raise ValueError(f"Skill 文件过大：{path}")
            bundle.extractall(destination)

        root = self._find_root(destination)
        skill = self._read_skill(root)
        self._run_reference_validator(root)
        return skill

    @staticmethod
    def _find_root(destination: Path) -> Path:
        if (destination / "SKILL.md").is_file():
            return destination
        roots = [
            path.parent
            for path in destination.glob("*/SKILL.md")
            if path.parent.parent == destination
        ]
        if len(roots) != 1:
            raise ValueError("Skill ZIP 必须在根目录或唯一顶层目录包含 SKILL.md")
        return roots[0]

    @staticmethod
    def _read_skill(root: Path) -> ValidatedSkill:
        raw = (root / "SKILL.md").read_text(encoding="utf-8")
        if not raw.startswith("---"):
            raise ValueError("SKILL.md 缺少 YAML frontmatter")
        parts = raw.split("---", 2)
        if len(parts) != 3:
            raise ValueError("SKILL.md frontmatter 未闭合")
        metadata = yaml.safe_load(parts[1])
        if not isinstance(metadata, dict):
            raise ValueError("SKILL.md frontmatter 必须是对象")
        name = metadata.get("name")
        description = metadata.get("description")
        if (
            not isinstance(name, str)
            or len(name) > 64
            or not SKILL_NAME.fullmatch(name)
        ):
            raise ValueError("Skill name 必须是小写字母、数字和连字符")
        if not isinstance(description, str) or not description.strip():
            raise ValueError("Skill description 不能为空")
        if len(description) > 1024:
            raise ValueError("Skill description 不能超过 1024 字符")
        instructions = parts[2].strip()
        if not instructions:
            raise ValueError("SKILL.md 指令正文不能为空")
        return ValidatedSkill(root, name, description.strip(), instructions)

    @staticmethod
    def _run_reference_validator(root: Path) -> None:
        completed = subprocess.run(
            [sys.executable, "-m", "skills_ref.cli", "validate", str(root)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=30,
            check=False,
            env={**os.environ, "PYTHONUTF8": "1"},
        )
        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout).strip()
            raise ValueError(f"skills-ref 校验失败：{detail[:1000]}")


class SkillRegistry:
    def __init__(
        self,
        storage: ObjectStorage,
        settings: Settings | None = None,
    ):
        self.settings = settings or get_settings()
        self.storage = storage
        self.validator = SkillPackageValidator(self.settings)
        self.cache_root = Path(self.settings.skill_cache_dir)
        self.cache_root.mkdir(parents=True, exist_ok=True)

    async def install(
        self,
        db: AsyncSession,
        archive: bytes,
        source_metadata: dict[str, Any] | None = None,
    ) -> tuple[Skill, SkillVersion]:
        sha256 = hashlib.sha256(archive).hexdigest()
        with tempfile.TemporaryDirectory(prefix="kitty-skill-") as temp:
            package = self.validator.validate_archive(archive, Path(temp) / "package")
            skill = await db.scalar(select(Skill).where(Skill.name == package.name))
            if skill is None:
                skill = Skill(name=package.name, description=package.description)
                db.add(skill)
                await db.flush()
            else:
                skill.description = package.description

            revision = sha256[:16]
            version = await db.scalar(
                select(SkillVersion).where(
                    SkillVersion.skill_id == skill.id,
                    SkillVersion.revision == revision,
                )
            )
            if version is None:
                object_key = f"{package.name}/revisions/{revision}/package.zip"
                await self.storage.put_bytes(
                    self.settings.skill_bucket,
                    object_key,
                    archive,
                    "application/zip",
                )
                version = SkillVersion(
                    skill_id=skill.id,
                    revision=revision,
                    bucket=self.settings.skill_bucket,
                    object_key=object_key,
                    sha256=sha256,
                    metadata_={
                        "name": package.name,
                        "description": package.description,
                        **({"source": source_metadata} if source_metadata else {}),
                    },
                )
                db.add(version)
                await db.flush()

            # Validate and cache the immutable package before publishing it active.
            await self.materialize(version)
            skill.active_version_id = version.id
            skill.enabled = True
            await self._emit_changed(db, skill, version)
            await db.commit()
            await db.refresh(skill)
            await db.refresh(version)

        return skill, version

    async def activate(
        self,
        db: AsyncSession,
        skill_id: str,
        version_id: str,
    ) -> tuple[Skill, SkillVersion]:
        skill = await db.get(Skill, skill_id)
        version = await db.get(SkillVersion, version_id)
        if skill is None or version is None or version.skill_id != skill.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Skill 或版本不存在")
        await self.materialize(version)
        skill.active_version_id = version.id
        skill.enabled = True
        await self._emit_changed(db, skill, version)
        await db.commit()
        return skill, version

    async def active_metadata(self, db: AsyncSession) -> list[dict[str, str]]:
        rows = await db.execute(
            select(Skill, SkillVersion)
            .join(SkillVersion, Skill.active_version_id == SkillVersion.id)
            .where(Skill.enabled.is_(True))
            .order_by(Skill.name)
        )
        return [
            {
                "name": skill.name,
                "description": skill.description,
                "versionId": version.id,
            }
            for skill, version in rows
        ]

    async def materialize(self, version: SkillVersion) -> Path:
        target = self.cache_root / version.id
        if (target / "SKILL.md").is_file():
            return target
        archive = await self.storage.get_bytes(version.bucket, version.object_key)
        if hashlib.sha256(archive).hexdigest() != version.sha256:
            raise RuntimeError("Skill 包 SHA-256 校验失败")
        staging = self.cache_root / f".{version.id}.{uuid4().hex}.staging"
        try:
            package = self.validator.validate_archive(archive, staging)
            try:
                package.root.rename(target)
            except FileExistsError:
                if not (target / "SKILL.md").is_file():
                    raise
            return target
        finally:
            await asyncio.to_thread(shutil.rmtree, staging, True)

    async def load_instructions(self, version: SkillVersion) -> str:
        root = await self.materialize(version)
        return (root / "SKILL.md").read_text(encoding="utf-8")

    async def read_resource(self, version: SkillVersion, relative_path: str) -> str:
        root = await self.materialize(version)
        path = (root / relative_path).resolve()
        if root.resolve() not in path.parents or not path.is_file():
            raise ValueError("Skill 资源路径无效")
        if path.stat().st_size > self.settings.skill_max_file_bytes:
            raise ValueError("Skill 资源超过读取限制")
        return path.read_text(encoding="utf-8")

    async def run_script(
        self,
        version: SkillVersion,
        script: str,
        arguments: list[str],
    ) -> dict[str, Any]:
        payload = {
            "versionId": version.id,
            "bucket": version.bucket,
            "objectKey": version.object_key,
            "sha256": version.sha256,
            "script": script,
            "arguments": arguments,
        }
        async with httpx.AsyncClient(timeout=self.settings.skill_script_timeout + 10) as client:
            response = await client.post(
                f"{self.settings.skill_worker_url.rstrip('/')}/execute",
                headers={"X-Skill-Worker-Token": self.settings.skill_worker_token},
                json=payload,
            )
            response.raise_for_status()
            return response.json()

    @staticmethod
    async def _emit_changed(
        db: AsyncSession,
        skill: Skill,
        version: SkillVersion,
    ) -> None:
        event = OutboxEvent(
            topic="skill.changed",
            aggregate_type="skill",
            aggregate_id=skill.id,
            payload={
                "skillId": skill.id,
                "name": skill.name,
                "activeVersionId": version.id,
            },
        )
        db.add(event)


def skill_prompt(metadata: list[dict[str, str]]) -> str:
    if not metadata:
        return ""
    items = "\n".join(
        f"- {item['name']}: {item['description']}" for item in metadata
    )
    return (
        "\n\n可用 Skills（仅在任务匹配时调用 load_skill）：\n"
        f"{items}\n"
        "不要根据摘要猜测完整流程，命中后必须加载对应 SKILL.md。"
    )
