"""将 4×2 透明精灵图切分为版本化 WebP 动作资源。"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output-root", required=True, type=Path)
    parser.add_argument("--pet-id", required=True)
    parser.add_argument("--secondary-action", default="walk")
    parser.add_argument("--columns", type=int, default=4)
    parser.add_argument("--rows", type=int, default=2)
    parser.add_argument("--size", type=int, default=512)
    return parser.parse_args()


def split_cells(
    sheet: Image.Image, columns: int, rows: int
) -> list[Image.Image]:
    cells: list[Image.Image] = []
    for row in range(rows):
        for column in range(columns):
            left = round(column * sheet.width / columns)
            right = round((column + 1) * sheet.width / columns)
            top = round(row * sheet.height / rows)
            bottom = round((row + 1) * sheet.height / rows)
            cells.append(sheet.crop((left, top, right, bottom)))
    return cells


def normalize_cell(cell: Image.Image, size: int) -> Image.Image:
    side = max(cell.width, cell.height)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.alpha_composite(
        cell,
        ((side - cell.width) // 2, (side - cell.height) // 2),
    )
    return square.resize((size, size), Image.Resampling.LANCZOS)


def write_action(
    cells: list[Image.Image],
    action_dir: Path,
    *,
    size: int,
) -> list[str]:
    action_dir.mkdir(parents=True, exist_ok=True)
    frames: list[str] = []
    for index, cell in enumerate(cells, start=1):
        filename = f"{index:02d}.webp"
        normalize_cell(cell, size).save(
            action_dir / filename,
            "WEBP",
            lossless=True,
            method=6,
        )
        frames.append(f"{action_dir.name}/{filename}")
    return frames


def main() -> None:
    args = parse_args()
    version_dir = args.output_root / args.pet_id / "v1"
    version_dir.mkdir(parents=True, exist_ok=True)

    with Image.open(args.input).convert("RGBA") as sheet:
        cells = split_cells(sheet, args.columns, args.rows)
    if len(cells) != 8:
        raise ValueError("精灵图必须恰好包含 8 个单元格")

    if args.columns == 2 and args.rows == 4:
        action_cells = {
            "idle": [cells[0], cells[1], cells[1], cells[0]],
            "sit": [cells[2], cells[3], cells[3], cells[2]],
            "walk": [cells[4], cells[5], cells[5], cells[4]],
            "crawl": [cells[6], cells[7], cells[7], cells[6]],
        }
    else:
        action_cells = {
            "idle": cells[:4],
            args.secondary_action: cells[4:],
        }
        alias_action = "crawl" if args.secondary_action == "walk" else "walk"
        action_cells[alias_action] = cells[4:]

    generated = {
        action: write_action(frames, version_dir / action, size=args.size)
        for action, frames in action_cells.items()
    }

    manifest = {
        "schemaVersion": 1,
        "petId": args.pet_id,
        "version": "v1",
        "canvas": {
            "width": args.size,
            "height": args.size,
            "anchorX": 0.5,
            "anchorY": 0.92,
        },
        "defaultAction": "idle",
        "actions": {
            action: {
                "fps": 3 if action in {"idle", "sit"} else 7,
                "loop": True,
                "frames": frames,
            }
            for action, frames in generated.items()
        },
    }
    (version_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
