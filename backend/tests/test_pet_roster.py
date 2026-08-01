"""前后端的宠物造型名单必须一致。

加了两只插画版的狗之后，前端能选、后端 422——**前端只显示「更换造型失败，
请重试」**，看不出是哪一层拒绝的。名单分散在四处（前端一份、后端三处），
靠人记着一起改是不现实的，所以这里用测试钉住。
"""

from __future__ import annotations

import re
from pathlib import Path

from app.pet_state import ALLOWED_ASSETS, DEFAULT_ASSET, SPECIES_BY_ASSET

PET_CONFIG = (
    Path(__file__).resolve().parents[2]
    / "app"
    / "components"
    / "FloatingPet"
    / "petConfig.ts"
)


def _frontend_asset_ids() -> set[str]:
    source = PET_CONFIG.read_text(encoding="utf-8")
    block = source.split("export const PET_ASSETS", 1)[1].split("] as const", 1)[0]
    return set(re.findall(r"id:\s*'([^']+)'", block))


def test_frontend_and_backend_offer_the_same_assets():
    """前端菜单里能点到的，后端都得收。

    差集的两个方向症状不同，所以分别报：
    - 前端有、后端没有 → 选了就 422，用户看到「更换造型失败」
    - 后端有、前端没有 → 只是选不到，无害但说明名单漏了
    """
    frontend = _frontend_asset_ids()
    assert frontend, "没能从 petConfig.ts 里解析出造型名单，解析逻辑要跟着改"

    only_frontend = frontend - ALLOWED_ASSETS
    assert not only_frontend, f"前端能选但后端会拒：{sorted(only_frontend)}"

    only_backend = ALLOWED_ASSETS - frontend
    assert not only_backend, f"后端认但前端选不到：{sorted(only_backend)}"


def test_every_asset_has_a_species():
    """漏了物种不会报错，只会**静默按猫处理**——一只狗会喵喵叫。"""
    missing = ALLOWED_ASSETS - set(SPECIES_BY_ASSET)
    assert not missing, f"这些造型没登记物种：{sorted(missing)}"


def test_default_asset_is_selectable():
    """回落用的默认造型自己必须在名单里，否则回落之后依然是非法值。"""
    assert DEFAULT_ASSET in ALLOWED_ASSETS


def test_schema_accepts_every_allowed_asset():
    """接口层用的是同一份名单，不是手抄的第二份。"""
    from app.schemas import PetUpdate

    for asset_id in ALLOWED_ASSETS:
        assert PetUpdate(assetId=asset_id).asset_id == asset_id
