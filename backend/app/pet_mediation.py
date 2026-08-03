"""宠物在聊天里的中介行为（计划文档 §3.4 / §3.5）。

## 设计命题

调查里 **54% 的人认为「已读回执」是关系里的压力来源**。常见的两种设计都不好：
有已读回执变成「已读 14:32」的冷冰冰审判；没有回执则变成沉默，接收方不知道
对方是没看到还是不想理。

宠物是第三条路：它不报「已读/未读」这个状态，它**替这个状态说人话**。
同样的信息换个说法，焦虑就少一大半。

## 最重要的一条约束

宠物**不知道**你在不在忙。它知道的只有「这条消息还没被打开」。

所以它可以说「还没看到呢」，**不可以说「他在忙」**。让它编一个理由，就是替你
对另一个人撒谎——哪怕是善意的，一旦对方后来发现你当时在刷手机，这只宠物就
不可信了，而**可信是它全部价值的基础**。

`STANDIN_TEMPLATES` 里的每一句都只陈述事实或提出宠物自己能做的事。**全部是
模板，不调模型**：这些话是发给另一个人的，模型一发挥风险就不可控（编造理由、
语气跑偏、泄露上下文）。等这条链路跑稳了再考虑让 Cognition Agent 在
**已审核的候选池**里挑一条——而不是自由生成。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, time, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.localtime import to_local
from app.runtime_config import live
from app.models import DirectMessage, PetInterjection, utcnow

logger = logging.getLogger(__name__)

# 下面三项都在后台可改（app/runtime_config.py 的 pet.* 分组）。读快照而不是
# 常量的理由见 cognition_queue 里同样的注释：这些跑在同步路径上。


def nudge_schedule_minutes() -> tuple[int, ...]:
    """催你看消息的时间点（分钟）。

    **递减而非递增**——催完这几次就不再主动提，只保持身体姿态。递增会让它
    从提醒变成骚扰。后台留空表示一次都不催。
    """
    raw = str(live("pet.nudge_schedule_minutes"))
    points = []
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if chunk:
            try:
                points.append(int(chunk))
            except ValueError:
                logger.warning("催看节奏里有非数字：%r，已跳过", chunk)
    return tuple(points)


def standin_after_minutes() -> int:
    """超过这个时长且对方还在等，宠物才在**对方**那侧说话。"""
    return int(live("pet.standin_after_minutes"))


def quiet_hours() -> tuple[time, time]:
    """深夜静默时段（站点本地时间）。纪念日当天可以突破，唠叨不行。"""
    def parse(value: object) -> time:
        if isinstance(value, time):
            return value
        hour, _, minute = str(value).partition(":")
        return time(int(hour), int(minute or 0))

    return parse(live("pet.quiet_start")), parse(live("pet.quiet_end"))

InterjectionKind = str

#: 催你看的话。说给**收信人自己**听，所以可以直接一点。
NUDGE_TEMPLATES: tuple[str, ...] = (
    "有新消息哦。",
    "那条消息还没看呢。",
    "我就提醒到这里，你忙完再看。",
)

#: 替你答的话。说给**对方**听——只陈述事实，一句都不许编造原因。
#:
#: 这里原本有三条，配套一个「宠物给出几个可点选项」的交互（`standin_options()`
#: 加聊天页的一排按钮）。那个交互从来没有落地，于是后两条从写下起就没被读过，
#: 而注释还写着「三句一起给」——比没有注释更糟。现在只留真的会说出口的那句。
#: 要加回选项，先把前端做出来，再一起加。
STANDIN_TEMPLATES: tuple[tuple[InterjectionKind, str], ...] = (
    ("standin", "他还没看到呢。"),
)


@dataclass(frozen=True)
class NudgeDecision:
    """要不要催、催第几次。"""

    should_nudge: bool
    step: int
    body: str
    reason: str


def in_quiet_hours(now: datetime) -> bool:
    """深夜时段。跨零点，所以是「晚于起点 或 早于终点」。

    **先换算到站点本地时区再取小时。** 直接拿 `now.time()` 比的话，传进来的
    是 `utcnow()`（容器跑在 UTC），23:00–08:00 就变成了本地的 07:00–16:00
    ——宠物白天一天不说话、后半夜反倒活跃，症状完全反过来。见 localtime 模块。
    """
    start, end = quiet_hours()
    current = to_local(now).time()
    return current >= start or current < end


def decide_nudge(
    unread_since: datetime | None,
    already_nudged: int,
    now: datetime,
    *,
    initiative: str = "normal",
) -> NudgeDecision:
    """该不该催收信人看消息。

    `initiative` 沿用宠物的三档设置。安静与关闭时**只保留身体姿态，不发气泡**
    ——这是「用户可以关闭主动交流」那条验收的实现点。
    """
    if unread_since is None:
        return NudgeDecision(False, already_nudged, "", "没有未读")
    if initiative != "normal":
        return NudgeDecision(False, already_nudged, "", f"initiative={initiative}")
    if in_quiet_hours(now):
        return NudgeDecision(False, already_nudged, "", "深夜静默")
    schedule = nudge_schedule_minutes()
    if already_nudged >= len(schedule):
        return NudgeDecision(False, already_nudged, "", "催过了，不再主动提")

    waited = (now - unread_since).total_seconds() / 60
    threshold = schedule[already_nudged]
    if waited < threshold:
        return NudgeDecision(
            False, already_nudged, "", f"未读 {waited:.0f} 分钟，还没到 {threshold}"
        )
    return NudgeDecision(
        True,
        already_nudged + 1,
        NUDGE_TEMPLATES[already_nudged],
        f"未读 {waited:.0f} 分钟，第 {already_nudged + 1} 次提醒",
    )


def decide_standin(
    unread_since: datetime | None,
    sender_kept_writing: bool,
    already_stood_in: bool,
    now: datetime,
) -> tuple[bool, InterjectionKind, str, str]:
    """该不该在**对方**那侧替你说一句。

    触发要求两个条件同时成立：未读够久 **且** 对方在这期间又发了消息（说明
    对方在等）。只满足前者不触发——对方可能发完就去忙了，替他制造一次互动
    反而是打扰。
    """
    if unread_since is None:
        return False, "", "", "没有未读"
    if already_stood_in:
        # 每次未读事件最多代答一次，否则会变成宠物自己在跟对方聊天
        return False, "", "", "这次未读已经代答过了"
    if not sender_kept_writing:
        return False, "", "", "对方没有继续等"
    waited = (now - unread_since).total_seconds() / 60
    threshold = standin_after_minutes()
    if waited < threshold:
        return False, "", "", f"未读 {waited:.0f} 分钟，还没到 {threshold}"

    kind, body = STANDIN_TEMPLATES[0]
    return True, kind, body, f"未读 {waited:.0f} 分钟且对方在等"


async def count_interjections(
    db: AsyncSession,
    audience_id: str,
    kind: str,
    since: datetime,
) -> int:
    return (
        await db.scalar(
            select(func.count(PetInterjection.id)).where(
                PetInterjection.audience_id == audience_id,
                PetInterjection.kind == kind,
                PetInterjection.created_at >= since,
            )
        )
    ) or 0


async def sender_kept_writing(
    db: AsyncSession,
    recipient_id: str,
    since: datetime,
) -> bool:
    """对方在这条未读之后又发了消息，说明他还在等。"""
    count = (
        await db.scalar(
            select(func.count(DirectMessage.id)).where(
                DirectMessage.recipient_id == recipient_id,
                DirectMessage.created_at > since,
            )
        )
    ) or 0
    return count > 0


async def record_interjection(
    db: AsyncSession,
    audience_id: str,
    kind: str,
    body: str,
    message_id: str | None = None,
    companion_id: str | None = None,
) -> PetInterjection:
    """记一条插话。

    `companion_id` 是**说这句话的那只宠物**，不是听的人那只。两者经常不同：
    代答时说话的是没读消息那位的宠物，而听的是在等回复的另一位。不在这里记下来
    的话，前端只能拿本地那只顶上去，同一条插话在两边就挂着不同的名字。
    """
    interjection = PetInterjection(
        audience_id=audience_id,
        kind=kind,
        body=body,
        message_id=message_id,
        companion_id=companion_id,
    )
    db.add(interjection)
    await db.flush()
    return interjection


async def run_mediation(
    db: AsyncSession,
    recipient_id: str,
    sender_id: str,
    oldest_unread: DirectMessage | None,
    *,
    initiative: str = "normal",
    now: datetime | None = None,
) -> list[PetInterjection]:
    """跑一轮中介：该催就催，该代答就代答。

    返回这一轮新增的插话。全部落 `PetInterjection`，与真人消息分开
    ——前端必须把它们显示成宠物在说话（计划文档 §3.2）。
    """
    now = now or utcnow()
    if oldest_unread is None:
        return []

    # 说话的都是**收信人那只**宠物：催促是「你的宠物在催你看消息」，代答是
    # 「你的宠物替还没读消息的你答一句」。两种都属于 recipient 的宠物，
    # 只是听众不同。
    from app.pet_state import resolve_pet

    speaker, _ = await resolve_pet(db, recipient_id)
    speaker_id = speaker.id

    created: list[PetInterjection] = []
    window_start = oldest_unread.created_at
    if window_start.tzinfo is None:
        from datetime import UTC

        window_start = window_start.replace(tzinfo=UTC)

    # 催收信人
    nudged = await count_interjections(
        db, recipient_id, "unread_nudge", window_start
    )
    decision = decide_nudge(window_start, nudged, now, initiative=initiative)
    if decision.should_nudge:
        created.append(
            await record_interjection(
                db,
                recipient_id,
                "unread_nudge",
                decision.body,
                oldest_unread.id,
                companion_id=speaker_id,
            )
        )
    else:
        logger.debug("不催：%s", decision.reason)

    # 在对方那侧代答
    stood_in = await count_interjections(db, sender_id, "standin", window_start)
    keeps_writing = await sender_kept_writing(db, recipient_id, window_start)
    should, kind, body, reason = decide_standin(
        window_start, keeps_writing, stood_in > 0, now
    )
    if should:
        created.append(
            await record_interjection(
                db, sender_id, kind, body, oldest_unread.id, companion_id=speaker_id
            )
        )
    else:
        logger.debug("不代答：%s", reason)

    if created:
        await db.commit()
    return created


