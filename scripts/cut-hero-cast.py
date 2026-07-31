#!/usr/bin/env python3
"""把绿幕上的四位主角抠成透明底的整身图。

这四张（男生、女生、Q 版柴犬、Q 版比熊）是**同一批出的**，所以画风、比例、
光线一致——首页那个动起来的舞台和新加的两只 Q 版宠物都从这里取材，不要
各自再去找图，否则站里会出现两种画风的同一只狗。

## 为什么阈值是「绿度」而不是「像素等于 #00FF00」

生成的绿幕不是数学上的纯色（实测各通道标准差 2–5），而且主体边缘有一圈
抗锯齿的过渡像素。所以判据是 `绿 - max(红, 蓝)`：这个值对纯背景很高、对
主体很低，且不受背景本身轻微不匀的影响。中间那段做线性过渡，边缘才不会
出现锯齿。

## 去绿溢用的是仓库里已有的那条规则

`build_canonical_rig_layers.despill_green` 的做法是：一个像素只要绿明显
高过红和蓝，就把绿压到 `max(红, 蓝)`。柴犬和比熊 v6 就是这么处理的，这里
沿用同一条，免得两代素材的白毛在同一个页面上偏色不一样。
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "artwork/hero-cast/source"
OUTPUT_DIR = ROOT / "artwork/hero-cast"

#: 生成服务给的文件名是随机 ID，留着谁也看不出是谁。这里定死映射，
#: 后面所有脚本都按语义名取材。
CAST = {
    "call_imiu5NT1jGOJruuEc2ll5SKi.png": "man",
    "call_wLqZsCp7orHFDO36wMDuDlFr.png": "woman",
    "call_pydRjK4YY9SE0Wr0oNwa2iL1.png": "shiba-q",
    "call_qP3MEHHd4YPGz2s4F4E3hwsx.png": "bichon-q",
}

#: 绿度高于这个值算纯背景，低于 SOLID_BELOW 算实体，中间线性过渡。
TRANSPARENT_ABOVE = 60
SOLID_BELOW = 20

#: 裁切时四周留出的余量。0 会让后面缩放时边缘像素被采样器吃掉。
PADDING = 8


def cut(path: Path) -> Image.Image:
    rgb = np.asarray(Image.open(path).convert("RGB")).astype(float)
    red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    greenness = green - np.maximum(red, blue)

    alpha = np.clip(
        (TRANSPARENT_ABOVE - greenness) / (TRANSPARENT_ABOVE - SOLID_BELOW), 0, 1
    )

    # 去绿溢：与 build-canonical-rig-layers.py 同一条规则。
    spilled = (green > red + 8) & (green > blue + 8)
    green = np.where(spilled, np.maximum(red, blue), green)

    rgba = np.dstack([red, green, blue, alpha * 255]).astype(np.uint8)
    image = Image.fromarray(rgba, "RGBA")

    box = image.getbbox()
    if box is None:
        raise RuntimeError(f"{path.name}: 抠完什么都不剩，绿幕阈值不对")
    box = (
        max(0, box[0] - PADDING),
        max(0, box[1] - PADDING),
        min(image.width, box[2] + PADDING),
        min(image.height, box[3] + PADDING),
    )
    return image.crop(box)


def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    missing = [name for name in CAST if not (SOURCE_DIR / name).exists()]
    if missing:
        print(f"缺素材：{', '.join(missing)}（应在 {SOURCE_DIR}）", file=sys.stderr)
        return 1

    for source_name, key in CAST.items():
        cutout = cut(SOURCE_DIR / source_name)
        cutout.save(OUTPUT_DIR / f"{key}.png")
        opaque = np.asarray(cutout)[..., 3] > 200
        print(f"{key}: {cutout.width}×{cutout.height}，实心像素 {opaque.mean() * 100:.1f}%")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
