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
from app.workspace import (
    WorkspaceError,
    WorkspaceLimits,
    cleanup,
    delete_file,
    list_files,
    read_file,
    resolve_within,
    write_file,
)

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


# ---- 工作区 ----
#
# 与 skill 包分开的一块**可写、持久**区域。skill 包是只读的、随时能重新
# materialize 的派生物；工作区是宠物自己写的东西，重启要还在，所以挂的是卷
# 不是 tmpfs。执行仍然复用上面那套限制（超时、输出上限、进程组 kill）。

workspace_root = Path(settings.workspace_dir)
workspace_limits = WorkspaceLimits(
    max_bytes=settings.workspace_max_bytes,
    max_file_bytes=settings.workspace_max_file_bytes,
    max_files=settings.workspace_max_files,
)


def ensure_workspace() -> Path:
    workspace_root.mkdir(parents=True, exist_ok=True)
    return workspace_root


class WorkspaceWriteRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    path: str = Field(max_length=400)
    content: str = Field(max_length=2_000_000)


class WorkspaceFileRead(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    path: str
    size: int
    modified_at: str = Field(alias="modifiedAt")


class WorkspaceRunRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    script: str = Field(max_length=400)
    arguments: list[str] = Field(default_factory=list, max_length=32)


@application.post("/workspace/write", response_model=WorkspaceFileRead)
async def workspace_write(
    data: WorkspaceWriteRequest, _: None = Depends(authorize)
) -> WorkspaceFileRead:
    try:
        written = write_file(ensure_workspace(), data.path, data.content, workspace_limits)
    except WorkspaceError as error:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error)) from error
    return WorkspaceFileRead(
        path=written.path,
        size=written.size,
        modifiedAt=written.modified_at.isoformat(),
    )


@application.get("/workspace/read")
async def workspace_read(
    path: str, _: None = Depends(authorize)
) -> dict[str, str]:
    try:
        content = read_file(
            ensure_workspace(), path, settings.skill_max_output_bytes
        )
    except WorkspaceError as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(error)) from error
    return {"path": path, "content": content}


@application.get("/workspace/list", response_model=list[WorkspaceFileRead])
async def workspace_list(_: None = Depends(authorize)) -> list[WorkspaceFileRead]:
    return [
        WorkspaceFileRead(
            path=item.path,
            size=item.size,
            modifiedAt=item.modified_at.isoformat(),
        )
        for item in list_files(ensure_workspace())
    ]


@application.delete("/workspace/file", status_code=status.HTTP_204_NO_CONTENT)
async def workspace_delete(path: str, _: None = Depends(authorize)) -> None:
    try:
        delete_file(ensure_workspace(), path)
    except WorkspaceError as error:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error)) from error


@application.post("/workspace/cleanup")
async def workspace_cleanup(_: None = Depends(authorize)) -> dict[str, list[str]]:
    removed = cleanup(ensure_workspace(), settings.workspace_retention_days)
    return {"removed": removed}


@application.post("/workspace/run", response_model=ExecuteResponse)
async def workspace_run(
    data: WorkspaceRunRequest, _: None = Depends(authorize)
) -> ExecuteResponse:
    """跑工作区里的一个脚本。

    与 skill 包的 execute 共用同一套约束：超时、输出上限、超时后按进程组 kill
    （只 kill 主进程的话，它 fork 出来的子进程会活下来继续占资源）。
    """
    root = ensure_workspace()
    try:
        script = resolve_within(root, data.script)
    except WorkspaceError as error:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error)) from error
    if not script.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"没有这个脚本：{data.script}")

    process = await asyncio.create_subprocess_exec(
        *command_for(script, data.arguments),
        cwd=root,
        env={
            "PATH": os.environ.get("PATH", ""),
            "LANG": os.environ.get("LANG", "C.UTF-8"),
            "PYTHONIOENCODING": "utf-8",
            "PYTHONUNBUFFERED": "1",
            "HOME": "/tmp/kitty-skill-home",
        },
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
    except (TimeoutError, OverflowError) as error:
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGKILL)
        else:
            process.kill()
        await process.wait()
        code = (
            status.HTTP_408_REQUEST_TIMEOUT
            if isinstance(error, TimeoutError)
            else status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
        )
        raise HTTPException(code, "脚本超时或输出过多") from error

    return ExecuteResponse(
        returnCode=return_code,
        stdout=stdout.decode("utf-8", errors="replace"),
        stderr=stderr.decode("utf-8", errors="replace"),
    )


app = application
