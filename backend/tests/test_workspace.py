"""工作区的边界。

这个模块几乎全是「不许做什么」，所以测试也基本都是负例。最要紧的是路径逃逸
那一组——沙箱的只读根文件系统挡得住写别处，但工作区卷本身可写，路径逃逸就能
覆盖掉别的文件。
"""

from datetime import UTC, datetime, timedelta

import pytest

from app.workspace import (
    WorkspaceError,
    WorkspaceLimits,
    cleanup,
    delete_file,
    list_files,
    read_file,
    resolve_within,
    usage,
    write_file,
)

LIMITS = WorkspaceLimits(max_bytes=1024, max_file_bytes=256, max_files=5)


@pytest.fixture
def root(tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    return workspace


# ---- 路径逃逸 ----


@pytest.mark.parametrize(
    "escape",
    [
        "../outside.txt",
        "../../etc/passwd",
        "notes/../../outside.txt",
        "/etc/passwd",
        "/",
        "",
        "   ",
        ".",
    ],
)
def test_paths_cannot_escape_the_workspace(root, escape):
    with pytest.raises(WorkspaceError):
        resolve_within(root, escape)


def test_symlink_out_of_the_workspace_is_rejected(root, tmp_path):
    """字符串层面看不出来的那一类：解析完才现原形。"""
    secret = tmp_path / "secret.txt"
    secret.write_text("不该被读到")
    (root / "link").symlink_to(secret)
    with pytest.raises(WorkspaceError):
        resolve_within(root, "link")


def test_nested_paths_inside_are_fine(root):
    resolved = resolve_within(root, "analysis/2026/out.csv")
    assert str(resolved).startswith(str(root.resolve()))


# ---- 配额 ----


def test_single_file_size_limit(root):
    with pytest.raises(WorkspaceError, match="太大"):
        write_file(root, "big.txt", "x" * 300, LIMITS)


def test_total_size_limit(root):
    for index in range(4):
        write_file(root, f"f{index}.txt", "x" * 250, LIMITS)
    with pytest.raises(WorkspaceError, match="总量"):
        write_file(root, "one-more.txt", "x" * 250, LIMITS)


def test_file_count_limit(root):
    for index in range(5):
        write_file(root, f"f{index}.txt", "x", LIMITS)
    with pytest.raises(WorkspaceError, match="文件数"):
        write_file(root, "sixth.txt", "x", LIMITS)


def test_overwriting_does_not_double_count(root):
    """反复改同一个文件不该假性超限——否则脚本改几轮就写不动了。"""
    for _ in range(20):
        write_file(root, "same.txt", "y" * 200, LIMITS)
    used, count = usage(root)
    assert count == 1
    assert used == 200


# ---- 读写 ----


def test_write_then_read_roundtrip(root):
    write_file(root, "notes/hello.txt", "你好", LIMITS)
    assert read_file(root, "notes/hello.txt", 1024) == "你好"


def test_reading_a_missing_file_says_so(root):
    with pytest.raises(WorkspaceError, match="没有这个文件"):
        read_file(root, "nope.txt", 1024)


def test_binary_content_does_not_crash_the_read(root):
    """下载来的图片被当成文本读，不该让整轮回答炸掉。"""
    (root / "image.bin").write_bytes(b"\xff\xd8\xff\xe0binary")
    assert read_file(root, "image.bin", 1024)


def test_read_is_truncated(root):
    write_file(root, "long.txt", "a" * 200, LIMITS)
    assert len(read_file(root, "long.txt", 10)) == 10


def test_listing_reports_sizes(root):
    write_file(root, "a.txt", "12345", LIMITS)
    files = list_files(root)
    assert [(item.path, item.size) for item in files] == [("a.txt", 5)]


def test_delete_removes_the_file(root):
    write_file(root, "gone.txt", "x", LIMITS)
    delete_file(root, "gone.txt")
    assert list_files(root) == []


def test_delete_cannot_escape(root):
    with pytest.raises(WorkspaceError):
        delete_file(root, "../outside.txt")


# ---- 清理 ----


def test_cleanup_removes_stale_files_only(root):
    write_file(root, "fresh.txt", "x", LIMITS)
    write_file(root, "stale.txt", "x", LIMITS)
    old = (datetime.now(UTC) - timedelta(days=40)).timestamp()
    import os

    os.utime(root / "stale.txt", (old, old))

    removed = cleanup(root, retention_days=14)

    assert removed == ["stale.txt"]
    assert [item.path for item in list_files(root)] == ["fresh.txt"]


def test_cleanup_keeps_files_still_being_written(root):
    """还在被反复写的说明分析还在进行，不该被清掉。"""
    write_file(root, "working.txt", "x", LIMITS)
    assert cleanup(root, retention_days=1) == []
