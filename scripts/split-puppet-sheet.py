#!/usr/bin/env python3
"""Split a three-row transparent puppet parts sheet into named PNG assets."""

from __future__ import annotations

import argparse
import json
from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter


ROW_NAMES = (
    ("torso", "head", "tail"),
    ("front-near-leg", "front-far-leg", "rear-near-leg", "rear-far-leg"),
    ("left-eye", "right-eye", "left-eye-rim", "right-eye-rim", "neck-overlap"),
)


def component_boxes(alpha: Image.Image, scale: int = 4) -> list[tuple[int, int, int, int]]:
    width, height = alpha.size
    small = alpha.resize(
        ((width + scale - 1) // scale, (height + scale - 1) // scale),
        Image.Resampling.NEAREST,
    )
    mask = small.point(lambda value: 255 if value > 24 else 0)
    mask = mask.filter(ImageFilter.MaxFilter(5))
    pixels = mask.load()
    sw, sh = mask.size
    seen = bytearray(sw * sh)
    boxes: list[tuple[int, int, int, int]] = []

    for y in range(sh):
        for x in range(sw):
            index = y * sw + x
            if seen[index] or pixels[x, y] == 0:
                continue
            queue = deque([(x, y)])
            seen[index] = 1
            min_x = max_x = x
            min_y = max_y = y
            count = 0
            while queue:
                cx, cy = queue.popleft()
                count += 1
                min_x = min(min_x, cx)
                max_x = max(max_x, cx)
                min_y = min(min_y, cy)
                max_y = max(max_y, cy)
                for nx, ny in (
                    (cx - 1, cy),
                    (cx + 1, cy),
                    (cx, cy - 1),
                    (cx, cy + 1),
                ):
                    if nx < 0 or ny < 0 or nx >= sw or ny >= sh:
                        continue
                    next_index = ny * sw + nx
                    if seen[next_index] or pixels[nx, ny] == 0:
                        continue
                    seen[next_index] = 1
                    queue.append((nx, ny))
            if count < 18:
                continue
            boxes.append(
                (
                    max(0, min_x * scale - 12),
                    max(0, min_y * scale - 12),
                    min(width, (max_x + 1) * scale + 12),
                    min(height, (max_y + 1) * scale + 12),
                )
            )
    return boxes


def assign_rows(
    boxes: list[tuple[int, int, int, int]], height: int
) -> list[list[tuple[int, int, int, int]]]:
    rows: list[list[tuple[int, int, int, int]]] = [[], [], []]
    for box in boxes:
        center_y = (box[1] + box[3]) / 2
        row_index = min(2, int(center_y / (height / 3)))
        rows[row_index].append(box)
    for row in rows:
        row.sort(key=lambda box: box[0])
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("sheet", type=Path)
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args()

    image = Image.open(args.sheet).convert("RGBA")
    alpha = image.getchannel("A")
    rows = assign_rows(component_boxes(alpha), image.height)
    actual_counts = tuple(len(row) for row in rows)
    expected_counts = tuple(len(names) for names in ROW_NAMES)
    if actual_counts != expected_counts:
        raise SystemExit(
            f"Unexpected component layout: got {actual_counts}, expected {expected_counts}"
        )

    args.output_dir.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, object] = {
        "source": str(args.sheet),
        "sheetSize": [image.width, image.height],
        "parts": {},
    }
    for row, names in zip(rows, ROW_NAMES, strict=True):
        for box, name in zip(row, names, strict=True):
            crop = image.crop(box)
            alpha_bbox = crop.getchannel("A").getbbox()
            if alpha_bbox is None:
                raise SystemExit(f"Part {name} has no visible pixels")
            tight_box = (
                max(0, box[0] + alpha_bbox[0] - 4),
                max(0, box[1] + alpha_bbox[1] - 4),
                min(image.width, box[0] + alpha_bbox[2] + 4),
                min(image.height, box[1] + alpha_bbox[3] + 4),
            )
            part = image.crop(tight_box)
            output_path = args.output_dir / f"{name}.png"
            part.save(output_path)
            manifest["parts"][name] = {
                "file": output_path.name,
                "sheetBox": list(tight_box),
                "size": [part.width, part.height],
            }

    manifest_path = args.output_dir / "parts-layout.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {sum(actual_counts)} parts and {manifest_path}")


if __name__ == "__main__":
    main()
