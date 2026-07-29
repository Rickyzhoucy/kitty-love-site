import json

from langchain.tools import ToolRuntime, tool
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import Skill, SkillVersion
from app.skill_runtime import SkillRegistry
from app.storage import ObjectStorage


def build_skill_tools(session_maker: async_sessionmaker[AsyncSession]):
    async def pinned_version(
        db: AsyncSession,
        name: str,
        runtime: ToolRuntime,
    ) -> SkillVersion:
        version_id = runtime.context.skill_versions.get(name)
        if version_id is None:
            raise ValueError(f"当前请求未启用 Skill：{name}")
        row = (
            await db.execute(
                select(SkillVersion)
                .join(Skill, Skill.id == SkillVersion.skill_id)
                .where(Skill.name == name, SkillVersion.id == version_id)
            )
        ).scalar_one_or_none()
        if row is None:
            raise ValueError(f"Skill 快照不存在：{name}")
        return row

    @tool
    async def list_skills(runtime: ToolRuntime) -> str:
        """列出已启用 Skill 的名称和用途；只返回轻量元数据。"""
        metadata = [
            {"name": name, "versionId": version_id}
            for name, version_id in runtime.context.skill_versions.items()
        ]
        return json.dumps(metadata, ensure_ascii=False)

    @tool
    async def load_skill(name: str, runtime: ToolRuntime) -> str:
        """任务与某个 Skill 匹配时，加载该 Skill 的完整 SKILL.md。"""
        async with session_maker() as db:
            version = await pinned_version(db, name, runtime)
            return await SkillRegistry(ObjectStorage()).load_instructions(version)

    @tool
    async def read_skill_resource(
        name: str,
        relative_path: str,
        runtime: ToolRuntime,
    ) -> str:
        """按 SKILL.md 指示读取 references 或 assets 中的文本资源。"""
        async with session_maker() as db:
            version = await pinned_version(db, name, runtime)
            return await SkillRegistry(ObjectStorage()).read_resource(
                version,
                relative_path,
            )

    @tool
    async def run_skill_script(
        name: str,
        script: str,
        arguments: list[str],
        runtime: ToolRuntime,
    ) -> str:
        """按 SKILL.md 指示在独立 Skill Worker 中执行包内 Python/Node 脚本。"""
        async with session_maker() as db:
            version = await pinned_version(db, name, runtime)
            result = await SkillRegistry(ObjectStorage()).run_script(
                version,
                script,
                arguments,
            )
        return json.dumps(result, ensure_ascii=False)

    return [list_skills, load_skill, read_skill_resource, run_skill_script]
