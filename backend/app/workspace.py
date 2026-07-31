"""宠物的工作目录。

一块持久的草稿纸：它可以在这儿写个小脚本算点东西、把下载来的文件放着、把
分析结果留给下一轮读。**跑脚本仍然在 skill-worker 那个已经加固过的沙箱里**
（非 root、只读根文件系统、cap_drop ALL、无外网、超时与输出上限），这个模块
只负责那个沙箱**里面**的一块可写区域，以及它的边界。

## 三条边界

1. **路径必须留在工作区内。** `..`、绝对路径、符号链接都要挡住。这是整个
   模块最要紧的一条——沙箱的只读根文件系统挡得住写别处，但工作区卷本身是
   可写的，路径逃逸就能覆盖掉别人的文件。
2. **总量有上限。** Docker 卷没有好用的配额，所以在写入前算一遍现有占用。
   不拦的话，一个循环写文件的脚本能把宿主机磁盘写满。
3. **过期即清理。** 草稿纸不是仓库。留着的中间文件会让下一次分析读到过期
   数据，而且悄无声息。
"""

from __future__ import annotations

import logging
import shutil
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

logger = logging.getLogger(__name__)


class WorkspaceError(Exception):
    """边界被撞到了。消息直接给模型看，所以要写成人话。"""


@dataclass(frozen=True)
class WorkspaceFile:
    path: str
    size: int
    modified_at: datetime


@dataclass(frozen=True)
class WorkspaceLimits:
    max_bytes: int
    max_file_bytes: int
    max_files: int


def resolve_within(root: Path, relative: str) -> Path:
    """把相对路径解析成工作区内的绝对路径，越界就抛。

    用 `resolve()` 之后再比对前缀，而不是字符串层面查 `..`：符号链接、
    `a/../../b` 这类写法在字符串上看不出来，解析完才现原形。
    """
    # 空白名字技术上合法，但那是个看不见的文件名——模型写出来、人在列表里
    # 找不到，纯属自找麻烦。和空串、`.`、`/` 一起挡掉。
    if not relative.strip() or relative.strip() in {".", "/"}:
        raise WorkspaceError("要指定一个文件名")
    candidate = (root / relative).resolve()
    root_resolved = root.resolve()
    if candidate != root_resolved and root_resolved not in candidate.parents:
        raise WorkspaceError(f"路径超出了工作区：{relative}")
    return candidate


def usage(root: Path) -> tuple[int, int]:
    """(占用字节, 文件数)。"""
    total = 0
    count = 0
    for path in root.rglob("*"):
        if path.is_file():
            total += path.stat().st_size
            count += 1
    return total, count


def list_files(root: Path) -> list[WorkspaceFile]:
    files: list[WorkspaceFile] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        stat = path.stat()
        files.append(
            WorkspaceFile(
                path=str(path.relative_to(root)),
                size=stat.st_size,
                modified_at=datetime.fromtimestamp(stat.st_mtime, UTC),
            )
        )
    return files


def write_file(
    root: Path,
    relative: str,
    content: str,
    limits: WorkspaceLimits,
) -> WorkspaceFile:
    target = resolve_within(root, relative)
    payload = content.encode("utf-8")

    if len(payload) > limits.max_file_bytes:
        raise WorkspaceError(
            f"这个文件太大了（{len(payload)} 字节，上限 {limits.max_file_bytes}）"
        )

    used, count = usage(root)
    # 覆盖写的话，原来那份的体积要先减掉，否则反复改同一个文件会假性超限
    if target.exists():
        used -= target.stat().st_size
    else:
        count += 1
    if count > limits.max_files:
        raise WorkspaceError(f"工作区文件数超上限（{limits.max_files}）")
    if used + len(payload) > limits.max_bytes:
        raise WorkspaceError(
            f"工作区总量超上限（{limits.max_bytes} 字节），先清理一些文件"
        )

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(payload)
    stat = target.stat()
    return WorkspaceFile(
        path=str(target.relative_to(root)),
        size=stat.st_size,
        modified_at=datetime.fromtimestamp(stat.st_mtime, UTC),
    )


def read_file(root: Path, relative: str, max_bytes: int) -> str:
    target = resolve_within(root, relative)
    if not target.is_file():
        raise WorkspaceError(f"没有这个文件：{relative}")
    payload = target.read_bytes()[:max_bytes]
    # 二进制文件（下载来的图片、压缩包）读成文本没有意义，但也不该让整轮炸掉
    return payload.decode("utf-8", errors="replace")


def delete_file(root: Path, relative: str) -> None:
    target = resolve_within(root, relative)
    if target.is_dir():
        shutil.rmtree(target)
    elif target.exists():
        target.unlink()


def cleanup(root: Path, retention_days: int, now: datetime | None = None) -> list[str]:
    """删掉过期文件，返回删掉的相对路径。

    按修改时间算：还在被反复写的中间文件说明分析还在进行，不该被清掉。
    """
    moment = now or datetime.now(UTC)
    cutoff = moment - timedelta(days=retention_days)
    removed: list[str] = []
    for path in sorted(root.rglob("*"), reverse=True):
        if path.is_file():
            modified = datetime.fromtimestamp(path.stat().st_mtime, UTC)
            if modified < cutoff:
                path.unlink()
                removed.append(str(path.relative_to(root)))
        elif path.is_dir() and not any(path.iterdir()):
            path.rmdir()
    if removed:
        logger.info("工作区清理了 %s 个过期文件", len(removed))
    return removed
