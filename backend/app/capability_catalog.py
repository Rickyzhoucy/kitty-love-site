"""服务器能力目录。

模型不应该把工具名当成权限，也不应该从 Skill 文本里推断执行位置。这里是
Core Tool 的唯一事实源：每个工具明确归属哪项能力、在哪里执行、风险多高，
以及面向用户可以显示什么安全摘要。动态 Skill 和 MCP 后续也投影为同一结构，
但不会修改这份随服务发布的受信目录。
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Literal

CapabilityKind = Literal["core", "device", "skill", "mcp"]
ExecutionPlane = Literal["server", "device"]
RiskLevel = Literal["none", "low", "high"]


@dataclass(frozen=True)
class CapabilitySpec:
    key: str
    label: str
    kind: CapabilityKind
    execution_plane: ExecutionPlane
    risk_level: RiskLevel
    external: bool = False

    def payload(self) -> dict[str, Any]:
        return asdict(self)


CHAT = CapabilitySpec("site.chat", "回应用户", "core", "server", "none")

_RESOURCE_CAPABILITIES: dict[str, CapabilitySpec] = {
    "plan": CapabilitySpec("site.plan", "计划", "core", "server", "low"),
    "wish": CapabilitySpec("site.wish", "心愿", "core", "server", "low"),
    "photo": CapabilitySpec("site.photo", "照片", "core", "server", "low"),
    "milestone": CapabilitySpec("site.timeline", "时间线", "core", "server", "low"),
    "message": CapabilitySpec("site.message", "留言", "core", "server", "low"),
    "timer": CapabilitySpec("site.timer", "纪念日", "core", "server", "low"),
    "mood": CapabilitySpec("site.mood", "心情", "core", "server", "low"),
    "letter": CapabilitySpec("site.letter", "未来情书", "core", "server", "low"),
    "dailyQuestion": CapabilitySpec(
        "site.daily-question", "每日一问", "core", "server", "low"
    ),
}

_TOOL_CAPABILITIES: dict[str, tuple[CapabilitySpec, str]] = {
    "site_pet_action": (
        CapabilitySpec("site.pet", "宠物动作", "core", "server", "none"),
        "做一个动作",
    ),
    "list_skills": (
        CapabilitySpec("server.skill", "Skills", "skill", "server", "none"),
        "查看可用 Skill",
    ),
    "load_skill": (
        CapabilitySpec("server.skill", "Skills", "skill", "server", "none"),
        "加载 Skill 指令",
    ),
    "read_skill_resource": (
        CapabilitySpec("server.skill", "Skills", "skill", "server", "none"),
        "读取 Skill 资源",
    ),
    "run_skill_script": (
        CapabilitySpec("server.skill", "Skills", "skill", "server", "high", True),
        "在服务器沙箱执行 Skill",
    ),
    "web_search": (
        CapabilitySpec("web.search", "联网搜索", "core", "server", "low", True),
        "上网查一下",
    ),
    "web_read": (
        CapabilitySpec("web.read", "网页读取", "core", "server", "low", True),
        "读一个网页",
    ),
    "create_document": (
        CapabilitySpec("document.create", "文档生成", "core", "server", "low", True),
        "在服务器生成文档",
    ),
    "find_capabilities": (
        CapabilitySpec("server.discovery", "能力发现", "core", "server", "none"),
        "查找服务器能力",
    ),
    "call_mcp_tool": (
        CapabilitySpec("server.mcp", "MCP 工具", "mcp", "server", "high", True),
        "调用服务器 MCP 工具",
    ),
    "workspace_list": (
        CapabilitySpec("server.workspace", "任务工作区", "core", "server", "none"),
        "查看服务器任务工作区",
    ),
    "workspace_read": (
        CapabilitySpec("server.workspace", "任务工作区", "core", "server", "none"),
        "读取服务器任务文件",
    ),
    "workspace_write": (
        CapabilitySpec("server.workspace", "任务工作区", "core", "server", "low"),
        "写入服务器任务文件",
    ),
    "workspace_delete": (
        CapabilitySpec("server.workspace", "任务工作区", "core", "server", "high"),
        "删除服务器任务文件",
    ),
    "workspace_run": (
        CapabilitySpec("server.workspace", "任务工作区", "core", "server", "high", True),
        "在服务器沙箱运行任务",
    ),
    "workspace_download": (
        CapabilitySpec("server.workspace", "任务工作区", "core", "server", "low", True),
        "下载到服务器任务工作区",
    ),
    "local_list": (
        CapabilitySpec("device.file", "本机文件", "device", "device", "none", True),
        "查看已授权的本机目录",
    ),
    "local_read": (
        CapabilitySpec("device.file", "本机文件", "device", "device", "low", True),
        "读取明确选择的本机文本",
    ),
    "local_search": (
        CapabilitySpec("device.file", "本机文件", "device", "device", "low", True),
        "搜索已授权的本机目录",
    ),
    "local_info": (
        CapabilitySpec("device.file", "本机文件", "device", "device", "none", True),
        "查看本机文件信息",
    ),
    "local_roots": (
        CapabilitySpec("device.file", "本机文件", "device", "device", "none", True),
        "查看本机授权范围",
    ),
    "local_write": (
        CapabilitySpec("device.file", "本机文件", "device", "device", "high", True),
        "经本机确认保存文件",
    ),
    "local_append": (
        CapabilitySpec("device.file", "本机文件", "device", "device", "high", True),
        "经本机确认追加文件",
    ),
    "local_edit": (
        CapabilitySpec("device.file", "本机文件", "device", "device", "high", True),
        "经本机确认修改文件",
    ),
}

_WRITE_VERBS = {
    "site_resource_create": "新增",
    "site_resource_update": "修改",
    "site_resource_delete": "删除",
}


def resolve_tool(tool_name: str, tool_input: Any) -> tuple[CapabilitySpec, str]:
    """把执行层工具投影为稳定能力，不把参数内容带进可见摘要。"""
    if tool_name == "site_resource_list" or tool_name in _WRITE_VERBS:
        resource = tool_input.get("resource") if isinstance(tool_input, dict) else None
        spec = _RESOURCE_CAPABILITIES.get(str(resource), CHAT)
        if tool_name == "site_resource_list":
            return CapabilitySpec(
                spec.key, spec.label, spec.kind, spec.execution_plane, "none"
            ), f"查询{spec.label}"
        risk: RiskLevel = "high" if tool_name == "site_resource_delete" else "low"
        return CapabilitySpec(
            spec.key, spec.label, spec.kind, spec.execution_plane, risk
        ), f"{_WRITE_VERBS[tool_name]}{spec.label}"
    return _TOOL_CAPABILITIES.get(
        tool_name,
        (
            CapabilitySpec(
                CHAT.key,
                CHAT.label,
                CHAT.kind,
                CHAT.execution_plane,
                "low",
            ),
            "处理请求",
        ),
    )


def core_catalog() -> list[dict[str, Any]]:
    """返回去重后的受信目录，供 Admin 健康与治理页读取。"""
    specs = [CHAT, *_RESOURCE_CAPABILITIES.values()]
    specs.extend(spec for spec, _ in _TOOL_CAPABILITIES.values())
    return [spec.payload() for spec in {item.key: item for item in specs}.values()]
