#!/usr/bin/env python3
"""把一段绿幕上的原地踏步视频，切成宠物系统要的帧序列。

    python3 scripts/walk-video-to-frames.py \\
        artwork/hero-cast/dogs-walk-2k.mp4 shiba-q --crop-right 0.57

## 为什么是视频转帧，而不是绑骨骼

站里的柴犬和比熊 v6 是逐部件切开、手标关节多边形绑出来的骨骼动画。那套东西
好，但要为每只新宠物手工标一遍几十个坐标。而 H3 能直接生成**画风一致的原地
踏步循环**——同一批参考图进去，出来的毛色、笔触、比例都对得上，抽帧就是现成
的走路动画。仓库里 Kitty / Momo / Hello Kitty / Snoopy 本来就是帧序列宠物，
渲染层（PetBodyRenderer 的 `renderer: 'frames'` 分支）不需要任何改动。

## 「原地踏步」是硬要求

提示词里必须写死身体不位移。宠物在页面上的移动是**渲染层用 CSS 平移做的**，
素材自己再走一遍就成了双重位移，看起来像在冰上打滑。

## 抠图按「与背景色的距离」，不按绿度

`cut-hero-cast.py` 用的是绿度 `绿 − max(红,蓝)`，因为那批图的底是标准的
`#00FF00`。视频不能这么干：模型给的底是偏青的 `#0F9159`，蓝通道高达 91，
绿度只有 54——用绿度阈值会把整块背景判成主体。

所以这里改成**先从四角量出背景色，再按每个像素到它的欧氏距离抠**。平涂底色
是什么颜色都无所谓，也不用每次换素材都回来调阈值。
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]

#: 到背景色的距离小于这个值算纯背景，大于 SOLID_ABOVE 算实体，中间线性过渡。
#: 视频编码的块效应会让平涂底色抖动十几个色阶，所以下限不能贴着 0。
TRANSPARENT_BELOW = 42
SOLID_ABOVE = 96

#: 宠物素材的画布边长，与既有的 v1 素材一致（manifest.canvas）。
CANVAS = 512


def extract_frames(video: Path, out_dir: Path) -> list[Path]:
    subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(video), str(out_dir / "f%03d.png")],
        check=True,
    )
    return sorted(out_dir.glob("*.png"))


def background_color(frame: Image.Image) -> np.ndarray:
    """从四角取背景色。四个角都在主体之外——提示词要求了四周留白。"""
    rgb = np.asarray(frame.convert("RGB")).astype(float)
    h, w = rgb.shape[:2]
    patches = [rgb[:24, :24], rgb[:24, -24:], rgb[-24:, :24], rgb[-24:, -24:]]
    return np.median(np.concatenate([p.reshape(-1, 3) for p in patches]), axis=0)


def cut(frame: Image.Image, bg: np.ndarray) -> Image.Image:
    rgb = np.asarray(frame.convert("RGB")).astype(float)
    distance = np.sqrt(((rgb - bg) ** 2).sum(axis=2))
    alpha = np.clip(
        (distance - TRANSPARENT_BELOW) / (SOLID_ABOVE - TRANSPARENT_BELOW), 0, 1
    )

    # 去背景色溢出，分两步。
    #
    # 一、按 alpha 反推：边缘像素是「主体色 × alpha + 底色 × (1-alpha)」混出来的，
    #    解这个方程还原主体色。
    safe = np.maximum(alpha, 0.15)[..., None]
    unmixed = np.clip((rgb - bg * (1 - safe)) / safe, 0, 255)
    mixed = np.where(alpha[..., None] > 0.02, unmixed, rgb)

    # 二、半透明带里再硬压一次绿。反推是线性近似，遇到**白色主体**会失效——
    #    白毛本身三通道都接近 255，混进来的绿只把绿通道抬高一点点，反推算出的
    #    偏差量很小，压不干净。而白色恰恰是最藏不住绿边的颜色。所以在
    #    0 < alpha < 1 的那一圈里，直接把绿钳到红蓝的较大值以下。
    fringe = (alpha > 0.02) & (alpha < 0.98)
    green_excess = mixed[..., 1] - np.maximum(mixed[..., 0], mixed[..., 2])
    mixed[..., 1] = np.where(
        fringe & (green_excess > 0),
        np.maximum(mixed[..., 0], mixed[..., 2]),
        mixed[..., 1],
    )

    return Image.fromarray(
        np.dstack([mixed, alpha * 255]).astype(np.uint8), "RGBA"
    )


def union_box(images: list[Image.Image]) -> tuple[int, int, int, int]:
    """**所有帧共用一个包围盒。**

    逐帧各自裁切会让宠物在播放时上下左右乱跳——迈腿时轮廓变宽，裁出来的图
    就变宽，缩放到同一画布后主体大小就变了。取并集才能让它站稳。
    """
    # **必须只看 alpha 通道。** RGBA 上直接 getbbox() 会把「alpha=0 但 RGB
    # 不为 0」的背景像素算成有内容，包围盒直接返回整幅画。
    boxes = [im.getchannel("A").getbbox() for im in images]
    boxes = [b for b in boxes if b]
    if not boxes:
        raise RuntimeError("所有帧都是空的，绿幕阈值不对")
    return (
        min(b[0] for b in boxes),
        min(b[1] for b in boxes),
        max(b[2] for b in boxes),
        max(b[3] for b in boxes),
    )


def normalize(image: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    crop = image.crop(box)
    side = max(crop.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.alpha_composite(crop, ((side - crop.width) // 2, side - crop.height))
    return square.resize((CANVAS, CANVAS), Image.LANCZOS)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("video", type=Path)
    parser.add_argument("pet_id")
    parser.add_argument(
        "--crop-left", type=float, default=0.0,
        help="先按比例裁掉左侧（一段视频里有两只狗时用来分开）",
    )
    parser.add_argument(
        "--crop-right", type=float, default=1.0,
        help="先按比例裁掉右侧",
    )
    parser.add_argument("--walk-frames", type=int, default=4)
    args = parser.parse_args()

    out_root = ROOT / "public/pet-assets" / args.pet_id / "v1"
    with tempfile.TemporaryDirectory() as tmp:
        paths = extract_frames(args.video, Path(tmp))
        if not paths:
            print("没抽到帧", file=sys.stderr)
            return 1
        raw = [Image.open(p).convert("RGBA") for p in paths]
        width = raw[0].width
        left, right = int(width * args.crop_left), int(width * args.crop_right)
        cropped = [im.crop((left, 0, right, im.height)) for im in raw]
        bg = background_color(cropped[0])
        print(f"  背景色 #{int(bg[0]):02x}{int(bg[1]):02x}{int(bg[2]):02x}")
        cuts = [cut(im, bg) for im in cropped]
        box = union_box(cuts)

        # 走路：在一整段里等距取样，尽量覆盖一个完整步态循环。
        step = len(cuts) / args.walk_frames
        walk = [normalize(cuts[int(i * step)], box) for i in range(args.walk_frames)]

        # 待机：拿其中一帧，做极小幅度的上下呼吸。宠物在页面上只有 100px 左右，
        # 这个幅度够了，也省得再生成一段。
        still = cuts[0]
        idle = []
        for dy in (0, 1, 2, 1):
            shifted = Image.new("RGBA", still.size, (0, 0, 0, 0))
            shifted.alpha_composite(still, (0, dy))
            idle.append(normalize(shifted, box))

        actions = {
            "idle": {"fps": 3, "loop": True, "frames": []},
            "walk": {"fps": 8, "loop": True, "frames": []},
        }
        for name, frames in (("idle", idle), ("walk", walk)):
            target = out_root / name
            target.mkdir(parents=True, exist_ok=True)
            for index, image in enumerate(frames, 1):
                rel = f"{name}/{index:02d}.webp"
                image.save(out_root / rel, "WEBP", quality=90, method=6)
                actions[name]["frames"].append(rel)

        # 锚点：脚底贴地。normalize 把主体压到方块底部，所以 y 锚点接近 1。
        manifest = {
            "schemaVersion": 1,
            "petId": args.pet_id,
            "version": "v1",
            "canvas": {"width": CANVAS, "height": CANVAS,
                       "anchorX": 0.5, "anchorY": 0.98},
            "defaultAction": "idle",
            "actions": actions,
        }
        (out_root / "manifest.json").write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        print(f"{args.pet_id}: 并集包围盒 {box}，写出 idle×{len(idle)} walk×{len(walk)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
