from __future__ import annotations

import asyncio
import hashlib
import os
import shutil
import signal
import sys
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from app.config import get_settings
from app.skill_runtime import SkillPackageValidator
from app.storage import ObjectStorage

settings = get_settings()
storage = ObjectStorage(settings)
validator = SkillPackageValidator(settings)
application = FastAPI(title="Kitty Skill Worker", docs_url=None, redoc_url=None)
cache_root = Path(settings.skill_worker_cache_dir)
cache_root.mkdir(parents=True, exist_ok=True)
materialize_lock = asyncio.Lock()
def prepare_script_process() -> None:
    os.setsid()


class ExecuteRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    version_id: str = Field(alias="versionId")
    bucket: str
    object_key: str = Field(alias="objectKey")
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    script: str
    arguments: list[str] = Field(default_factory=list, max_length=32)


class ExecuteResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    return_code: int = Field(alias="returnCode")
    stdout: str
    stderr: str


async def authorize(x_skill_worker_token: str = Header(default="")) -> None:
    if not settings.skill_worker_token or x_skill_worker_token != settings.skill_worker_token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Skill Worker token 无效")


async def materialize(data: ExecuteRequest) -> Path:
    target = cache_root / data.version_id
    if (target / "SKILL.md").is_file():
        return target
    async with materialize_lock:
        if (target / "SKILL.md").is_file():
            return target
        archive = await storage.get_bytes(data.bucket, data.object_key)
        if hashlib.sha256(archive).hexdigest() != data.sha256:
            raise HTTPException(status.HTTP_409_CONFLICT, "Skill 包校验失败")
        staging = cache_root / f".{data.version_id}.staging"
        if staging.exists():
            shutil.rmtree(staging)
        package = validator.validate_archive(archive, staging)
        if package.root == staging:
            staging.rename(target)
        else:
            shutil.move(str(package.root), target)
            shutil.rmtree(staging)
        return target


async def read_limited(
    stream: asyncio.StreamReader,
    limit: int,
) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while chunk := await stream.read(16 * 1024):
        total += len(chunk)
        if total > limit:
            raise OverflowError("Skill 输出超过限制")
        chunks.append(chunk)
    return b"".join(chunks)


def command_for(script: Path, arguments: list[str]) -> list[str]:
    if script.suffix == ".py":
        return [sys.executable, "-I", str(script), *arguments]
    if script.suffix in {".js", ".mjs"}:
        return ["node", str(script), *arguments]
    raise HTTPException(status.HTTP_400_BAD_REQUEST, "只允许执行 Python 或 Node.js 脚本")


@application.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@application.post(
    "/execute",
    response_model=ExecuteResponse,
    dependencies=[Depends(authorize)],
)
async def execute(data: ExecuteRequest) -> ExecuteResponse:
    root = await materialize(data)
    script = (root / data.script).resolve()
    if root.resolve() not in script.parents or not script.is_file():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Skill script 路径无效")

    environment = {
        "PATH": os.environ.get("PATH", ""),
        "LANG": os.environ.get("LANG", "C.UTF-8"),
        "PYTHONIOENCODING": "utf-8",
        "PYTHONUNBUFFERED": "1",
        "HOME": "/tmp/kitty-skill-home",
    }
    process = await asyncio.create_subprocess_exec(
        *command_for(script, data.arguments),
        cwd=root,
        env=environment,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        preexec_fn=prepare_script_process if os.name == "posix" else None,
    )
    assert process.stdout is not None
    assert process.stderr is not None
    try:
        stdout, stderr = await asyncio.wait_for(
            asyncio.gather(
                read_limited(process.stdout, settings.skill_max_output_bytes),
                read_limited(process.stderr, settings.skill_max_output_bytes),
            ),
            timeout=settings.skill_script_timeout,
        )
        return_code = await process.wait()
    except TimeoutError as error:
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGKILL)
        else:
            process.kill()
        await process.wait()
        raise HTTPException(status.HTTP_408_REQUEST_TIMEOUT, "Skill script 执行超时") from error
    except OverflowError as error:
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGKILL)
        else:
            process.kill()
        await process.wait()
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, str(error)) from error

    return ExecuteResponse(
        returnCode=return_code,
        stdout=stdout.decode("utf-8", errors="replace"),
        stderr=stderr.decode("utf-8", errors="replace"),
    )


app = application
