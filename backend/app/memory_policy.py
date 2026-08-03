"""长期记忆写入边界；本机运行上下文永远不得人格化。"""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class MemoryPolicyDecision:
    allowed: bool
    reason: str | None = None
    sensitivity: str = "normal"


FORBIDDEN_KINDS = frozenset(
    {
        "authorization",
        "file_location",
        "diary_content",
        "system_permission",
        "workspace",
        "tool_state",
        "command_output",
    }
)

LOCAL_CONTEXT_TERMS = (
    "本机授权",
    "授权目录",
    "授权路径",
    "允许目录",
    "工作区路径",
    "工作目录",
    "workspace path",
    "allowedroots",
    "system permission",
    "目录权限",
    "文件全文",
    "命令输出",
)

SECRET_PATTERNS = (
    re.compile(r"\b(?:sk|pk)-[A-Za-z0-9_-]{16,}\b"),
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"\b(?:api[_ -]?key|token|password|passwd|cookie)\s*[:=]\s*\S+", re.I),
    re.compile(r"\b(?:webauthn|passkey)\s+(?:challenge|credential)\b", re.I),
)

# POSIX 绝对路径、Windows 盘符/UNC、file://。网页 URL 不在这里。
LOCAL_PATH_PATTERNS = (
    re.compile(
        r"(?<!https:)(?<!http:)(?<![\w.])/"
        r"(?:Users|home|var|tmp|private|Volumes|opt|etc)/[^\s，。；！？]+",
        re.I,
    ),
    re.compile(r"\b[A-Z]:\\(?:[^\\\s]+\\)*[^\s]*", re.I),
    re.compile(r"\\\\[^\\\s]+\\[^\s]+"),
    re.compile(r"\bfile://[^\s]+", re.I),
)

SENSITIVE_TERMS = (
    "健康",
    "病史",
    "住址",
    "身份证",
    "手机号",
    "银行卡",
    "定位",
    "精确位置",
)


def evaluate_memory(
    content: str,
    *,
    proposed_kind: str | None = None,
    source_type: str | None = None,
) -> MemoryPolicyDecision:
    """返回能否进入长期记忆；拒绝原因只存代码，不保存污染正文。"""

    normalized = " ".join(content.strip().split())
    lowered = normalized.lower()
    kind = (proposed_kind or "").strip().lower()
    source = (source_type or "").strip().lower()

    if not normalized:
        return MemoryPolicyDecision(False, "empty")
    if kind in FORBIDDEN_KINDS:
        return MemoryPolicyDecision(False, "runtime_context_kind")
    if source in {"workspace", "local_tool", "tool_output", "command_output"}:
        return MemoryPolicyDecision(False, "runtime_context_source")
    if any(term in lowered for term in LOCAL_CONTEXT_TERMS):
        return MemoryPolicyDecision(False, "local_authorization_context")
    if any(pattern.search(normalized) for pattern in LOCAL_PATH_PATTERNS):
        return MemoryPolicyDecision(False, "local_path")
    if any(pattern.search(normalized) for pattern in SECRET_PATTERNS):
        return MemoryPolicyDecision(False, "secret")
    sensitivity = "sensitive" if any(term in normalized for term in SENSITIVE_TERMS) else "normal"
    return MemoryPolicyDecision(True, sensitivity=sensitivity)


def assert_memory_allowed(
    content: str,
    *,
    proposed_kind: str | None = None,
    source_type: str | None = None,
) -> MemoryPolicyDecision:
    decision = evaluate_memory(
        content,
        proposed_kind=proposed_kind,
        source_type=source_type,
    )
    if not decision.allowed:
        raise ValueError(f"这类内容不会进入长期记忆（{decision.reason}）")
    return decision
