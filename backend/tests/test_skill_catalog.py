from __future__ import annotations

import zipfile
from io import BytesIO

import pytest

from app.config import Settings
from app.skill_catalog import SkillCatalog, enforce_audit_policy


def test_catalog_snapshot_becomes_bounded_zip():
    catalog = SkillCatalog("https://skills.example.com", "token", Settings())
    archive = catalog.build_archive(
        {
            "files": [
                {
                    "path": "SKILL.md",
                    "contents": "---\nname: useful-skill\ndescription: Useful\n---\n\nDo the work.",
                },
                {"path": "references/guide.md", "contents": "# Guide"},
            ]
        }
    )
    with zipfile.ZipFile(BytesIO(archive)) as bundle:
        assert bundle.namelist() == ["SKILL.md", "references/guide.md"]


def test_catalog_snapshot_rejects_path_traversal():
    catalog = SkillCatalog("https://skills.example.com", "", Settings())
    with pytest.raises(ValueError, match="不安全路径"):
        catalog.build_archive(
            {"files": [{"path": "../SKILL.md", "contents": "malicious"}]}
        )


def test_catalog_audit_policy_requires_review_and_blocks_failed():
    with pytest.raises(ValueError, match="尚无安全审计"):
        enforce_audit_policy([], False)
    enforce_audit_policy([], True)

    warning = [{"status": "warn", "riskLevel": "MEDIUM"}]
    with pytest.raises(ValueError, match="审计警告"):
        enforce_audit_policy(warning, False)
    enforce_audit_policy(warning, True)

    with pytest.raises(PermissionError, match="禁止安装"):
        enforce_audit_policy([{"status": "fail", "riskLevel": "HIGH"}], True)


async def test_production_catalog_rejects_private_network_targets():
    catalog = SkillCatalog(
        "https://127.0.0.1",
        "",
        Settings(app_env="production", session_secret="x" * 32),
    )
    with pytest.raises(ValueError, match="内网或本机"):
        await catalog.search("pdf")
