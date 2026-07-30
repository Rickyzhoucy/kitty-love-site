#!/usr/bin/env python3
"""Cut rig layers directly from each breed's canonical full-body image."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class Part:
    name: str
    joint: tuple[int, int]
    extract_polygon: tuple[tuple[int, int], ...]
    cut_polygon: tuple[tuple[int, int], ...]


CONFIGS: dict[str, dict[str, object]] = {
    "shiba": {
        "source": ROOT / "artwork/rive/shiba-realistic-cutout-v1.png",
        "parts": (
            Part(
                "front-far-leg",
                (385, 704),
                ((294, 640), (445, 635), (450, 760), (430, 1082), (278, 1088), (333, 775)),
                ((318, 715), (452, 706), (465, 780), (451, 1084), (281, 1087), (335, 778)),
            ),
            Part(
                "front-near-leg",
                (520, 704),
                ((455, 640), (603, 648), (594, 1098), (455, 1095)),
                ((463, 720), (584, 716), (589, 1095), (443, 1094)),
            ),
            Part(
                "rear-far-leg",
                (836, 666),
                ((748, 596), (900, 607), (920, 735), (900, 1000), (758, 1005), (786, 720)),
                ((785, 681), (909, 678), (936, 742), (908, 998), (765, 1001), (795, 722)),
            ),
            Part(
                "rear-near-leg",
                (976, 654),
                ((900, 570), (1057, 558), (1112, 1047), (930, 1045), (920, 720)),
                ((925, 675), (1045, 650), (1105, 1043), (937, 1042), (929, 725)),
            ),
            Part(
                "tail",
                (827, 367),
                # 收紧到尾巴本体。原多边形左下沿深入臀部约 100px，旋转时那块
                # 躯干像素会整体错位成硬边色块——离关节越远错得越多。
                ((800, 332), (778, 258), (828, 198), (900, 178), (975, 204), (1032, 264), (1044, 372), (1006, 430), (936, 446), (866, 412), (826, 372)),
                ((812, 340), (792, 268), (836, 214), (900, 196), (966, 218), (1020, 274), (1032, 370), (996, 420), (932, 434), (868, 404), (830, 372)),
            ),
        ),
        "eyes": {
            "left-eye": {"center": (292, 331), "radius": (28, 25), "socket": "#211913"},
            "right-eye": {"center": (418, 332), "radius": (28, 25), "socket": "#211913"},
        },
    },
    "bichon": {
        "source": ROOT / "artwork/rive/bichon-realistic-cutout-v1.png",
        "parts": (
            Part(
                "front-far-leg",
                (392, 760),
                ((302, 697), (452, 694), (460, 790), (450, 1046), (292, 1045), (327, 790)),
                ((326, 775), (460, 764), (478, 803), (456, 1043), (298, 1042), (334, 795)),
            ),
            Part(
                "front-near-leg",
                (540, 756),
                ((482, 686), (622, 689), (615, 1071), (482, 1070)),
                ((482, 775), (600, 770), (609, 1068), (471, 1068)),
            ),
            Part(
                "rear-far-leg",
                (783, 746),
                ((696, 678), (845, 678), (855, 779), (835, 985), (689, 983), (717, 780)),
                ((724, 760), (846, 754), (862, 787), (834, 981), (696, 980), (724, 786)),
            ),
            Part(
                "rear-near-leg",
                (928, 704),
                ((855, 628), (1018, 620), (1047, 1018), (884, 1017), (869, 760)),
                ((875, 722), (1007, 708), (1040, 1015), (890, 1015), (879, 768)),
            ),
            Part(
                "tail",
                (786, 499),
                # 同柴犬：原多边形下沿斜切过整个臀部，旋转时那条斜边会显成
                # 一道白色接缝。收紧到尾羽本体，下沿贴着尾羽与臀部的交界。
                ((760, 450), (782, 348), (850, 298), (938, 310), (1012, 372), (1055, 470), (1032, 552), (972, 578), (908, 538), (848, 492)),
                ((772, 452), (794, 360), (856, 314), (932, 324), (1000, 382), (1040, 470), (1018, 542), (966, 566), (908, 530), (852, 490)),
            ),
        ),
        "eyes": {
            "left-eye": {"center": (368, 411), "radius": (28, 27), "socket": "#231c18"},
            "right-eye": {"center": (494, 430), "radius": (29, 28), "socket": "#231c18"},
        },
    },
}


def despill_green(image: Image.Image) -> Image.Image:
    cleaned: list[tuple[int, int, int, int]] = []
    for red, green, blue, alpha in image.getdata():
        if alpha and green > red + 8 and green > blue + 8:
            green = max(red, blue)
        cleaned.append((red, green, blue, alpha))
    result = Image.new("RGBA", image.size)
    result.putdata(cleaned)
    return result


def polygon_mask(size: tuple[int, int], points: tuple[tuple[int, int], ...], blur: float) -> Image.Image:
    mask = Image.new("L", size)
    ImageDraw.Draw(mask).polygon(points, fill=255)
    return mask.filter(ImageFilter.GaussianBlur(blur)) if blur else mask


def ellipse_mask(
    size: tuple[int, int],
    center: tuple[int, int],
    radius: tuple[int, int],
    blur: float,
) -> Image.Image:
    mask = Image.new("L", size)
    cx, cy = center
    rx, ry = radius
    ImageDraw.Draw(mask).ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=255)
    return mask.filter(ImageFilter.GaussianBlur(blur))


def cropped_layer(
    source: Image.Image,
    mask: Image.Image,
    joint: tuple[int, int],
    padding: int = 12,
) -> tuple[Image.Image, dict[str, object]]:
    alpha = ImageChops.multiply(source.getchannel("A"), mask)
    bbox = alpha.getbbox()
    if bbox is None:
        raise RuntimeError("Layer mask contains no source pixels")
    bbox = (
        max(0, bbox[0] - padding),
        max(0, bbox[1] - padding),
        min(source.width, bbox[2] + padding),
        min(source.height, bbox[3] + padding),
    )
    layer = source.copy()
    layer.putalpha(alpha)
    crop = layer.crop(bbox)
    return crop, {
        "joint": list(joint),
        "sourceBox": list(bbox),
        "jointInCrop": [joint[0] - bbox[0], joint[1] - bbox[1]],
        "size": [crop.width, crop.height],
    }


def build_breed(breed: str, config: dict[str, object]) -> None:
    source_path = Path(config["source"])
    source = despill_green(Image.open(source_path).convert("RGBA"))
    output_dir = ROOT / "artwork/rive/canonical-parts" / breed
    output_dir.mkdir(parents=True, exist_ok=True)

    base = source.copy()
    base_alpha = base.getchannel("A")
    manifest: dict[str, object] = {
        "source": str(source_path.relative_to(ROOT)),
        "sourceSize": [source.width, source.height],
        "parts": {},
        "eyes": {},
    }

    for part in config["parts"]:
        extract = polygon_mask(source.size, part.extract_polygon, 1.25)
        cut = polygon_mask(source.size, part.extract_polygon, 0.75)
        if part.name == "tail":
            # 尾巴绕关节摆动，半径大，空洞边缘很容易从叠层下露出来——而且露出来
            # 的是一条高对比硬亮线，缩到显示尺寸也盖不住。把空洞明显内缩，宁可
            # 让 base 上残留一圈绒毛（低对比，几乎看不见）。
            cut = polygon_mask(source.size, part.cut_polygon, 0.75).filter(
                ImageFilter.MinFilter(21)
            )
        else:
            # 侧向按 extract 的完整宽度挖，否则 base 上残留的原腿会在摆动时
            # 露出硬边残片；但顶边压到关节以下——关节以上是髋部，挖穿了腿一
            # 摆开髋部就裂出缺口。羽化让接缝过渡自然。
            gate = Image.new("L", source.size, 0)
            ImageDraw.Draw(gate).rectangle(
                (0, part.joint[1], source.width, source.height), fill=255
            )
            cut = ImageChops.multiply(cut, gate.filter(ImageFilter.GaussianBlur(7)))
        layer, metadata = cropped_layer(source, extract, part.joint)
        layer.save(output_dir / f"{part.name}.png")
        manifest["parts"][part.name] = metadata
        if "-far-leg" not in part.name:
            base_alpha = ImageChops.multiply(base_alpha, ImageChops.invert(cut))

    base.putalpha(base_alpha)

    for eye_name, eye_config in config["eyes"].items():
        center = tuple(eye_config["center"])
        radius = tuple(eye_config["radius"])
        mask = ellipse_mask(source.size, center, radius, 1.4)
        layer, metadata = cropped_layer(source, mask, center, padding=5)
        layer.save(output_dir / f"{eye_name}.png")
        manifest["eyes"][eye_name] = metadata

        socket_mask = ellipse_mask(source.size, center, radius, 1.8)
        socket = Image.new("RGBA", source.size, eye_config["socket"])
        base = Image.composite(socket, base, socket_mask)

    base.save(output_dir / "base.png")
    (output_dir / "rig-layout.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"{breed}: wrote base, {len(config['parts'])} joints, and {len(config['eyes'])} eyes")


def main() -> None:
    for breed, config in CONFIGS.items():
        build_breed(breed, config)


if __name__ == "__main__":
    main()
