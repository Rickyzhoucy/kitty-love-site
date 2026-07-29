"""Remove a generated green screen without creating semi-transparent color blocks."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def remove_green(image: Image.Image) -> Image.Image:
    result = image.convert("RGBA")
    cleaned: list[tuple[int, int, int, int]] = []
    for red, green, blue, alpha in result.getdata():
        dominant = green - max(red, blue)
        if green >= 110 and dominant >= 45:
            cleaned.append((red, green, blue, 0))
            continue
        if green >= 90 and dominant >= 18:
            # Preserve antialiased fur while avoiding a broad translucent matte.
            edge_alpha = max(0, min(alpha, round(255 * (45 - dominant) / 27)))
            neutral_green = min(green, max(red, blue))
            cleaned.append((red, neutral_green, blue, edge_alpha))
            continue
        if green > max(red, blue):
            green = max(red, blue)
        cleaned.append((red, green, blue, alpha))
    result.putdata(cleaned)
    return result


def main() -> None:
    args = parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(args.input) as source:
        remove_green(source).save(args.output, "PNG", optimize=True)


if __name__ == "__main__":
    main()
