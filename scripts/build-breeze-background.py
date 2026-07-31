"""Build a seamless APNG breeze loop from a painted meadow background."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import numpy as np
from PIL import Image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--frames", type=int, default=32)
    parser.add_argument("--duration-ms", type=int, default=125)
    parser.add_argument("--horizon", type=float, default=0.66)
    return parser.parse_args()


def shifted_row(row: np.ndarray, offset: float) -> np.ndarray:
    """Shift one RGB row with clamped, linearly interpolated edge sampling."""
    width = row.shape[0]
    source_x = np.clip(np.arange(width, dtype=np.float32) - offset, 0, width - 1)
    left = np.floor(source_x).astype(np.int32)
    right = np.minimum(left + 1, width - 1)
    blend = (source_x - left)[:, None]
    return row[left] * (1.0 - blend) + row[right] * blend


def build_frame(source: np.ndarray, phase: float, horizon: int) -> Image.Image:
    height, width, _ = source.shape
    frame = source.astype(np.float32).copy()

    # Clouds drift slowly while the horizon stays locked in place.
    cloud_offset = 11.0 * math.sin(phase)
    transition = max(1, round(height * 0.055))
    for y in range(horizon):
        distance = horizon - y
        strength = min(1.0, distance / transition)
        strength = strength * strength * (3.0 - 2.0 * strength)
        frame[y] = shifted_row(source[y], cloud_offset * strength)

    # Foreground grass sways more than distant grass. Roots and camera stay stable.
    grass_span = max(1, height - horizon)
    for y in range(horizon, height):
        depth = (y - horizon) / grass_span
        primary = math.sin(phase + depth * 1.15)
        secondary = math.sin(phase * 2.0 + depth * 2.4 + 0.7)
        sway = (5.2 * primary + 1.2 * secondary) * (depth**0.72)
        frame[y] = shifted_row(source[y], sway)

    return Image.fromarray(np.clip(frame, 0, 255).astype(np.uint8), "RGB")


def main() -> None:
    args = parse_args()
    if args.frames < 8:
        raise ValueError("--frames must be at least 8 for a smooth loop")
    if not 0.45 <= args.horizon <= 0.8:
        raise ValueError("--horizon must be between 0.45 and 0.8")

    with Image.open(args.input) as image:
        source = np.asarray(image.convert("RGB"))

    horizon = round(source.shape[0] * args.horizon)
    frames = [
        build_frame(source, 2.0 * math.pi * index / args.frames, horizon)
        for index in range(args.frames)
    ]

    args.output.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        args.output,
        "PNG",
        save_all=True,
        append_images=frames[1:],
        duration=args.duration_ms,
        loop=0,
        disposal=0,
        blend=0,
        optimize=True,
    )


if __name__ == "__main__":
    main()
