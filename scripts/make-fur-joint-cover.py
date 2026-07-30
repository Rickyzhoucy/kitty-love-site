#!/usr/bin/env python3
"""Create a softly feathered fur patch for hiding a puppet joint seam."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--width", type=int, default=140)
    parser.add_argument("--height", type=int, default=110)
    parser.add_argument("--feather", type=float, default=12)
    args = parser.parse_args()

    source = Image.open(args.source).convert("RGBA")
    source_alpha = source.getchannel("A")
    visible_box = source_alpha.getbbox()
    if visible_box is None:
        raise SystemExit("Source contains no visible pixels")

    center_x = (visible_box[0] + visible_box[2]) // 2
    center_y = (visible_box[1] + visible_box[3]) // 2
    left = max(0, center_x - args.width // 2)
    top = max(0, center_y - args.height // 2)
    right = min(source.width, left + args.width)
    bottom = min(source.height, top + args.height)
    patch = source.crop((left, top, right, bottom))

    mask = Image.new("L", patch.size)
    inset = int(args.feather * 1.5)
    ImageDraw.Draw(mask).ellipse(
        (inset, inset, patch.width - inset, patch.height - inset),
        fill=255,
    )
    mask = mask.filter(ImageFilter.GaussianBlur(args.feather))
    patch.putalpha(ImageChops.multiply(patch.getchannel("A"), mask))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    patch.save(args.output)
    print(f"Wrote {args.output} ({patch.width}x{patch.height})")


if __name__ == "__main__":
    main()
