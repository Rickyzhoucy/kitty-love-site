#!/usr/bin/env python3
"""用首帧图生成首页舞台的循环视频。

    python3 scripts/generate-hero-video.py artwork/hero-cast/stage-frame.jpg

## 为什么要把首帧同时当尾帧

视频模型默认不循环——最后一帧和第一帧对不上，网页里 `loop` 播放就会每几秒
"跳"一下。这里的办法是**同一张图既当 first_frame 又当 last_frame**：模型被
约束成从这张画出发、再回到这张画，出来的片子首尾同帧，接得上。

## 两条路，取决于账号能调哪个

- **H3（`/v2/video_generation`）**：2026-07-31 发布的全模态模型，原生 2K、
  4–15 秒、能同时出音频。请求体是多模态 content 数组，`role` 标注每张图是
  首帧、尾帧还是参考图。这是首选。
- **Hailuo-02（mmx 的 SEF 模式）**：老一档，但同样支持首尾帧。H3 调不通时
  的退路，直接 `mmx video generate --first-frame X --last-frame X`。

## 已知的拦路虎（2026-07-31 实测）

两条路当时都被计费挡住：H3 报「TokenPlan 或 Credit 暂不支持 MiniMax-H3
系列模型」，Hailuo-02 报「已达到 Token Plan 用量上限」。而同一个 key 的
**文本和图片都是通的**——所以别把它当成 key 或网络的问题去查。
`mmx quota show` 里 video 那档 `current_interval_total_count` 是 0，
额度总量本身就是零，余量百分比是拿零除出来的，看着是 100% 也没用。

## 跑之前

Node 相关的证书坑见 memory/mmx-cli-node-ca.md：这台机器上跑 mmx 要加
`NODE_USE_SYSTEM_CA=0`。本脚本直接用 requests 打 HTTP，不受影响。
"""

from __future__ import annotations

import base64
import json
import mimetypes
import sys
import time
import urllib.request
from pathlib import Path

BASE = "https://api.minimaxi.com"
MODEL = "MiniMax-H3"
CONFIG = Path.home() / ".mmx/config.json"

#: 待机循环的提示词。**每一条否定都是有来由的**：视频模型很爱自作主张地
#: 推镜头、让人物走动、或者把插画"修"成写实——那三样任意一样发生，这段
#: 视频就接不回首页那张静态图了。
PROMPT = (
    "一段可以无缝循环的待机动画。镜头完全静止，不推不拉不摇。"
    "画面里两个人和两只小狗保持原来的站位和姿势，不走动、不转身、不换姿势、不改变构图。"
    "只有极轻微的自然动作：胸口随呼吸缓慢起伏，偶尔自然地眨一次眼，"
    "头发和衣角有很小幅度的飘动，两只小狗的尾巴轻轻摇一下，耳朵偶尔动一下。"
    "光线柔和恒定，不要忽明忽暗。保持原图的柔和厚涂插画画风，不要变成写实，不要改变配色。"
    "视频结束时所有角色必须回到与开头完全相同的姿势、位置和表情。"
    "不要出现新的人物、动物或物体，不要有文字，不要有转场。"
)


def api_key() -> str:
    return json.loads(CONFIG.read_text())["api_key"]


def data_uri(path: Path) -> str:
    mime = mimetypes.guess_type(path.name)[0] or "image/jpeg"
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()


def post(path: str, payload: dict, key: str) -> dict:
    request = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read())


def get(path: str, key: str) -> dict:
    request = urllib.request.Request(
        f"{BASE}{path}", headers={"Authorization": f"Bearer {key}"}
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read())


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__.splitlines()[2].strip(), file=sys.stderr)
        return 2
    frame = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("public/hero/us-idle.mp4")
    key = api_key()
    uri = data_uri(frame)

    created = post(
        "/v2/video_generation",
        {
            "model": MODEL,
            "resolution": "2K",
            "duration": 5,
            "ratio": "1:1",
            "content": [
                {"type": "text", "text": PROMPT},
                {"type": "image_url", "role": "first_frame", "image_url": {"url": uri}},
                {"type": "image_url", "role": "last_frame", "image_url": {"url": uri}},
            ],
        },
        key,
    )
    if "error" in created:
        print(f"提交失败：{created['error'].get('message')}", file=sys.stderr)
        return 1

    task_id = created["task_id"]
    print(f"任务 {task_id} 已提交，等待中……")

    while True:
        time.sleep(8)
        task = get(f"/v2/query/video_generation/{task_id}", key)["task"]
        status = task["status"]
        if status in ("succeeded", "failed", "cancelled", "expired"):
            break
        print(f"  {status}…")

    if status != "succeeded":
        print(f"生成失败：{task.get('error', {}).get('message', status)}", file=sys.stderr)
        return 1

    out.parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(task["content"]["url"], out)
    print(f"已保存 {out}（{out.stat().st_size / 1024 / 1024:.1f} MB）")
    print("下一步：转码成网页用的尺寸，别把 2K 原片直接挂首页。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
