#!/usr/bin/env python3
"""Bake a feathered fur patch into a puppet part to remove a cut joint opening."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("part", type=Path)
    parser.add_argument("patch", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--center-x", type=int, required=True)
    parser.add_argument("--center-y", type=int, required=True)
    parser.add_argument("--width", type=int, required=True)
    parser.add_argument("--height", type=int, required=True)
    args = parser.parse_args()

    part = Image.open(args.part).convert("RGBA")
    original_alpha = part.getchannel("A")
    patch = Image.open(args.patch).convert("RGBA").resize(
        (args.width, args.height),
        Image.Resampling.LANCZOS,
    )
    left = args.center_x - patch.width // 2
    top = args.center_y - patch.height // 2
    part.alpha_composite(patch, (left, top))
    # The patch is only meant to repaint the cut opening, which is already
    # opaque. Without this the feathered edge bleeds outside the silhouette and
    # leaves a faint halo that is invisible on a light page but shows up as grey
    # fringing on dark backgrounds and in transparent desktop windows.
    part.putalpha(original_alpha)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    part.save(args.output)
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
