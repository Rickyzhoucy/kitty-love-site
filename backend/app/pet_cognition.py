"""把认知队列、打扰预算与 Cognition Agent 接起来。

分层：`cognition_queue` 只管「该不该调」，`agents/cognition` 只管「怎么调、
输出合不合规」，本模块负责把两者和数据库接上——尤其是**预算的真实来源**。

预算不落在进程内存里：`dailyProactiveCount` 和 `userDismissalRate` 都从
`CompanionPetEvent` 现算。进程重启不该让宠物重新获得一天的打扰额度。
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.cognition import CognitionAgent, CognitionInput, CognitionProposal
from app.cognition_queue import (
    BudgetState,
    CognitionQueue,
    CognitionRequest,
    CognitionType,
    RejectReason,
    allow_proactive,
)
from app.models import Companion, CompanionPetEvent, utcnow

logger = logging.getLogger(__name__)

PROACTIVE_DELIVERED = "proactive.delivered"
PROACTIVE_DISMISSED = "proactive.dismissed"
PROACTIVE_ACCEPTED = "proactive.accepted"


async def _count_since(
    db: AsyncSession,
    companion_id: str,
    event_type: str,
    since: datetime,
) -> int:
    return (
        await db.scalar(
            select(func.count(CompanionPetEvent.id)).where(
                CompanionPetEvent.companion_id == companion_id,
                CompanionPetEvent.type == event_type,
                CompanionPetEvent.occurred_at >= since,
            )
        )
    ) or 0


async def load_budget(
    db: AsyncSession,
    companion: Companion,
    *,
    quiet_mode: bool,
    initiative_off: bool,
) -> BudgetState:
    """从事件表现算预算。

    `userDismissalRate` 取最近 7 天，而不是全期——用户上周烦，不代表这周还烦。
    """
    now = utcnow()
    day_start = now - timedelta(days=1)
    week_start = now - timedelta(days=7)

    delivered_today = await _count_since(
        db, companion.id, PROACTIVE_DELIVERED, day_start
    )
    delivered_week = await _count_since(
        db, companion.id, PROACTIVE_DELIVERED, week_start
    )
    dismissed_week = await _count_since(
        db, companion.id, PROACTIVE_DISMISSED, week_start
    )
    last = await db.scalar(
        select(func.max(CompanionPetEvent.occurred_at)).where(
            CompanionPetEvent.companion_id == companion.id,
            CompanionPetEvent.type == PROACTIVE_DELIVERED,
        )
    )
    last_at = 0.0
    if last is not None:
        if last.tzinfo is None:
            last = last.replace(tzinfo=UTC)
        last_at = last.timestamp()

    return BudgetState(
        quiet_mode=quiet_mode,
        initiative_off=initiative_off,
        last_proactive_at=last_at,
        daily_proactive_count=delivered_today,
        daily_call_count=0,
        user_dismissal_rate=(
            dismissed_week / delivered_week if delivered_week else 0.0
        ),
    )


class PetCognitionService:
    def __init__(self, agent: CognitionAgent):
        self.agent = agent

    async def think(
        self,
        db: AsyncSession,
        companion: Companion,
        request_type: CognitionType,
        payload: CognitionInput,
        *,
        trigger: str | None = None,
        dedupe_key: str = "",
        quiet_mode: bool = False,
        initiative_off: bool = False,
    ) -> tuple[CognitionProposal | None, RejectReason | None]:
        """跑一次认知。返回 (提案, 拒绝原因)，两者必有一个为 None。

        提案为 None 且拒绝原因也为 None，表示模型跑了但输出没过校验——
        对调用方来说结果一样（什么都不做），但日志里能分清是「没让它想」
        还是「它想不明白」。
        """
        now = utcnow().timestamp()
        budget = await load_budget(
            db,
            companion,
            quiet_mode=quiet_mode,
            initiative_off=initiative_off,
        )
        queue = CognitionQueue(budget)
        request = CognitionRequest(
            type=request_type,
            context={},
            dedupe_key=dedupe_key or f"{companion.id}:{request_type}",
            expires_at=now + 300,
        )
        rejection = queue.submit(request, now, trigger=trigger)
        if rejection is not None:
            logger.debug("认知请求被拒：%s（%s）", rejection, request_type)
            return None, rejection

        popped = queue.pop(now)
        if popped is None:
            return None, RejectReason.EXPIRED

        proposal = await self.agent.think(payload)
        queue.record_call(popped, now)

        if proposal is not None and request_type is CognitionType.PROACTIVE_THOUGHT:
            # 只有真的产出了想法才记一次打扰——模型跑了但没说出话，
            # 用户没被打扰，不该扣额度。
            db.add(
                CompanionPetEvent(
                    companion_id=companion.id,
                    type=PROACTIVE_DELIVERED,
                    payload={"goal": proposal.goal, "reason": proposal.reason},
                    importance=40,
                )
            )
            await db.commit()
        return proposal, None

