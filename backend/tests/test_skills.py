import io
import zipfile

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.config import Settings
from app.models import OutboxEvent, Skill
from app.skill_runtime import SkillPackageValidator, SkillRegistry
from app.skill_worker import command_for


def skill_zip(
    *,
    name: str = "daily-helper",
    description: str = "处理日常文本的轻量助手。",
    extra: dict[str, str] | None = None,
) -> bytes:
    content = io.BytesIO()
    with zipfile.ZipFile(content, "w") as archive:
        archive.writestr(
            f"{name}/SKILL.md",
            f"---\nname: {name}\ndescription: {description}\n---\n\n按用户要求处理文本。",
        )
        for path, value in (extra or {}).items():
            archive.writestr(f"{name}/{path}", value)
    return content.getvalue()


class MemoryStorage:
    def __init__(self):
        self.objects: dict[tuple[str, str], bytes] = {}

    async def put_bytes(
        self,
        bucket: str,
        object_key: str,
        content: bytes,
        content_type: str,
    ) -> None:
        del content_type
        self.objects[(bucket, object_key)] = content

    async def get_bytes(self, bucket: str, object_key: str) -> bytes:
        return self.objects[(bucket, object_key)]


def test_skill_package_validation_and_zip_slip_rejection(tmp_path):
    settings = Settings(skill_cache_dir=str(tmp_path / "cache"))
    package = SkillPackageValidator(settings).validate_archive(
        skill_zip(extra={"references/style.md": "简洁自然。"}),
        tmp_path / "valid",
    )
    assert package.name == "daily-helper"
    assert (package.root / "references/style.md").read_text(encoding="utf-8") == "简洁自然。"

    malicious = skill_zip(extra={"../../outside.txt": "no"})
    with pytest.raises(ValueError, match="不安全路径"):
        SkillPackageValidator(settings).validate_archive(
            malicious,
            tmp_path / "invalid",
        )
    assert not (tmp_path / "outside.txt").exists()


@pytest.mark.asyncio
async def test_skill_install_is_versioned_hot_loaded_and_emits_event(
    session_maker,
    tmp_path,
):
    storage = MemoryStorage()
    settings = Settings(skill_cache_dir=str(tmp_path / "cache"))
    registry = SkillRegistry(storage, settings)  # type: ignore[arg-type]

    async with session_maker() as db:
        skill, first = await registry.install(db, skill_zip())
        _, second = await registry.install(
            db,
            skill_zip(description="新版日常文本助手。"),
        )
        stored = await db.scalar(select(Skill).where(Skill.name == "daily-helper"))
        events = list(
            await db.scalars(
                select(OutboxEvent).where(OutboxEvent.topic == "skill.changed")
            )
        )

    assert first.id != second.id
    assert stored is not None
    assert stored.active_version_id == second.id
    assert stored.description == "新版日常文本助手。"
    assert len(events) == 2
    assert (tmp_path / "cache" / second.id / "SKILL.md").is_file()


def test_skill_worker_only_allows_supported_script_types(tmp_path):
    python_script = tmp_path / "run.py"
    python_script.write_text("print('ok')", encoding="utf-8")
    command = command_for(python_script, ["hello"])
    assert command[-2:] == [str(python_script), "hello"]

    unsupported = tmp_path / "run.sh"
    unsupported.write_text("echo no", encoding="utf-8")
    with pytest.raises(HTTPException):
        command_for(unsupported, [])
