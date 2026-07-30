"""认知请求队列与打扰预算（架构文档 §5.3 / §10）。

这个模块存在的唯一理由是**拦住模型调用**。宠物身上绝大多数会动的东西——
目光跟随、走路、眨眼、需求衰减、普通闲逛——都不该触发模型（§5.1）。
如果没有一道显式的闸门，这些高频事件迟早会有人顺手接上模型。

队列必须支持的能力（§5.3）：优先级、去重、防抖、过期、取消、单会话预算、
每日预算、失败降级。下面每一条都对应一个方法或一个字段，不做「以后再说」。
"""

from __future__ import annotations

import heapq
import itertools
import logging
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

logger = logging.getLogger(__name__)


class CognitionType(StrEnum):
    USER_MESSAGE = "user_message"
    AMBIGUOUS_INTENT = "ambiguous_intent"
    IMPORTANT_EVENT = "important_event"
    PROACTIVE_THOUGHT = "proactive_thought"
    RELATIONSHIP_REFLECTION = "relationship_reflection"
    TASK_PLANNING = "task_planning"


#: 各类请求的基础优先级。数值越大越先出队。
#: 用户说话永远排最前——让宠物的自言自语插到用户前面是不可接受的。
BASE_PRIORITY: dict[CognitionType, int] = {
    CognitionType.USER_MESSAGE: 100,
    CognitionType.TASK_PLANNING: 80,
    CognitionType.AMBIGUOUS_INTENT: 70,
    CognitionType.IMPORTANT_EVENT: 50,
    CognitionType.RELATIONSHIP_REFLECTION: 30,
    CognitionType.PROACTIVE_THOUGHT: 20,
}

#: 同一 dedupeKey 的最小间隔（秒）。防抖：连续触发只认第一条。
DEBOUNCE_SECONDS: dict[CognitionType, float] = {
    CognitionType.PROACTIVE_THOUGHT: 120.0,
    CognitionType.RELATIONSHIP_REFLECTION: 900.0,
    CognitionType.IMPORTANT_EVENT: 30.0,
}
DEFAULT_DEBOUNCE_SECONDS = 5.0

#: **不得触发模型的场景**（架构文档 §5.1）。
#: 这不是文档注释，是 `is_forbidden_trigger` 的数据源——把这张表写进代码里，
#: 是为了让「鼠标一动就调模型」这种改动必须显式删掉一行才能通过。
FORBIDDEN_TRIGGERS = frozenset(
    {
        "pointer.move",
        "gaze.follow",
        "pet.walk",
        "pet.turn",
        "pet.drag",
        "pet.blink",
        "needs.decay",
        "mood.compute",
        "goal.idleWander",
        "reminder.due",          # 已知提醒到期：模板即可，不必想
        "resource.simpleCrud",   # 明确且简单的站内增删改查
        "pet.tapHead",
        "pet.tapBody",
        "task.statusExpression", # 已有任务状态的身体表达
    }
)


def is_forbidden_trigger(trigger: str) -> bool:
    return trigger in FORBIDDEN_TRIGGERS


@dataclass
class CognitionRequest:
    type: CognitionType
    context: dict[str, Any] = field(default_factory=dict)
    dedupe_key: str = ""
    #: 绝对时间戳（秒）。过了就不该再跑——一个五分钟前的「想主动说话」
    #: 现在跑出来只会答非所问。
    expires_at: float = 0.0
    #: 相对基础优先级的加成，用于同类之间排序。
    priority_boost: int = 0
    cancelled: bool = False

    @property
    def priority(self) -> int:
        return BASE_PRIORITY[self.type] + self.priority_boost


@dataclass
class BudgetState:
    """打扰预算（架构文档 §10）。"""

    quiet_mode: bool = False
    initiative_off: bool = False
    last_proactive_at: float = 0.0
    daily_proactive_count: int = 0
    daily_call_count: int = 0
    #: 主动搭话被推开的比例。上去了就自动降频——不需要用户去设置里关。
    user_dismissal_rate: float = 0.0


#: 每日模型调用上限（所有类型合计）。
DAILY_CALL_BUDGET = 200
#: 每日主动打扰上限。
DAILY_PROACTIVE_BUDGET = 12
#: 两次主动打扰的最小间隔（秒）。
MIN_PROACTIVE_GAP_SECONDS = 600.0


def proactive_gap_seconds(budget: BudgetState) -> float:
    """按被推开的比例拉长间隔。

    用户连着推开三次，间隔就该翻倍，而不是继续按原节奏敲门。这是 §10 里
    `userDismissalRate` 唯一有意义的用法——只统计不作用等于没统计。
    """
    return MIN_PROACTIVE_GAP_SECONDS * (1.0 + 3.0 * budget.user_dismissal_rate)


def allow_proactive(budget: BudgetState, now: float) -> bool:
    """能不能主动打扰。任意一条不满足就不行。"""
    if budget.initiative_off or budget.quiet_mode:
        return False
    if budget.daily_proactive_count >= DAILY_PROACTIVE_BUDGET:
        return False
    return now - budget.last_proactive_at >= proactive_gap_seconds(budget)


class RejectReason(StrEnum):
    FORBIDDEN = "forbidden_trigger"
    DUPLICATE = "duplicate"
    DEBOUNCED = "debounced"
    EXPIRED = "expired"
    DAILY_BUDGET = "daily_budget"
    PROACTIVE_BUDGET = "proactive_budget"


class CognitionQueue:
    """进程内优先级队列。

    刻意做成进程内而非落库：认知请求的价值在几十秒内衰减到零，跨进程重放一个
    过期的想法没有意义。真正需要跨进程存活的是 `CompanionPetEvent`——那是给
    Reflection 用的，已经有表了。
    """

    def __init__(self, budget: BudgetState | None = None):
        self._heap: list[tuple[int, int, CognitionRequest]] = []
        self._counter = itertools.count()
        self._by_key: dict[str, CognitionRequest] = {}
        self._last_seen: dict[str, float] = {}
        self.budget = budget or BudgetState()

    def submit(
        self,
        request: CognitionRequest,
        now: float,
        trigger: str | None = None,
    ) -> RejectReason | None:
        """入队。返回 None 表示接受，否则是拒绝原因。

        拒绝是常态而不是异常——这个队列大部分时间在说「不」。
        """
        if trigger and is_forbidden_trigger(trigger):
            return RejectReason.FORBIDDEN
        if request.expires_at and request.expires_at <= now:
            return RejectReason.EXPIRED
        if self.budget.daily_call_count >= DAILY_CALL_BUDGET:
            return RejectReason.DAILY_BUDGET
        if request.type is CognitionType.PROACTIVE_THOUGHT and not allow_proactive(
            self.budget, now
        ):
            return RejectReason.PROACTIVE_BUDGET

        key = request.dedupe_key
        if key:
            debounce = DEBOUNCE_SECONDS.get(request.type, DEFAULT_DEBOUNCE_SECONDS)
            if now - self._last_seen.get(key, float("-inf")) < debounce:
                return RejectReason.DEBOUNCED
            existing = self._by_key.get(key)
            if existing is not None and not existing.cancelled:
                # 同键已在队列里：保留优先级更高的那条，而不是排两次。
                if request.priority <= existing.priority:
                    return RejectReason.DUPLICATE
                existing.cancelled = True
            self._last_seen[key] = now
            self._by_key[key] = request

        heapq.heappush(
            self._heap, (-request.priority, next(self._counter), request)
        )
        return None

    def cancel(self, dedupe_key: str) -> bool:
        request = self._by_key.get(dedupe_key)
        if request is None or request.cancelled:
            return False
        request.cancelled = True
        return True

    def pop(self, now: float) -> CognitionRequest | None:
        """取下一个该跑的请求，顺带丢掉已取消和已过期的。"""
        while self._heap:
            _, _, request = heapq.heappop(self._heap)
            if request.cancelled:
                continue
            if request.expires_at and request.expires_at <= now:
                logger.debug("认知请求过期丢弃：%s", request.type)
                continue
            if request.dedupe_key:
                self._by_key.pop(request.dedupe_key, None)
            return request
        return None

    def record_call(self, request: CognitionRequest, now: float) -> None:
        """记一次实际发生的模型调用。预算只在真的调了之后才扣。"""
        self.budget.daily_call_count += 1
        if request.type is CognitionType.PROACTIVE_THOUGHT:
            self.budget.daily_proactive_count += 1
            self.budget.last_proactive_at = now

    def reset_daily(self) -> None:
        self.budget.daily_call_count = 0
        self.budget.daily_proactive_count = 0

    def __len__(self) -> int:
        return sum(1 for _, _, item in self._heap if not item.cancelled)
