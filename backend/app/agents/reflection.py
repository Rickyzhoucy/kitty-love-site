"""Memory Reflection Agent —— 把经历沉淀成记忆（架构文档 §4.3 / §9）。

后台低频消费 `CompanionPetEvent` 里 `processedAt IS NULL` 且重要度够高的记录，
聚合去重后提炼成 `MemoryItem`。

两条硬约束（架构文档 §7.3 / §9）：

1. **它不直接对用户说话，也不控制身体。** 所以这个角色一个工具都没有
   （见 `roles.py`），产出只有记忆提案，写库由本模块的代码完成。
2. **普通工具日志不得进入情感记忆。** 「查询了一次备忘录」不是经历。
   过滤在 `MEANINGFUL_TYPES` 与 `IMPORTANCE_FLOOR` 两道关卡上，
   而不是指望 Prompt 里写一句「请忽略无关内容」。
"""

from __future__ import annotations

import json
import logging
from datetime import datetime

from langchain_core.messages import HumanMessage, SystemMessage
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.roles import AgentRole, spec_for
from app.memory import MemoryService
from app.models import Companion, CompanionPetEvent, utcnow
from app.schemas import MemoryCreate

logger = logging.getLogger(__name__)

#: 只有这些类型的事件才可能形成经历。工具执行、页面切换、动画播放一律不在内。
#: 白名单而非黑名单：新增一种事件类型时默认**不**进记忆，
#: 忘记登记的后果是「少记一件事」，而不是「工具日志污染了关系记忆」。
#:
#: 括号里标注了生产者。**没有生产者的条目是预留**，不是遗漏——加一种事件需要
#: 同时有生产者和白名单条目，缺一样它就不会进记忆。
MEANINGFUL_TYPES = frozenset(
    {
        "interaction.milestone",     # 关系等级变化（usePetBrain）
        "proactive.accepted",        # 主动搭话被接住了（FloatingPet）
        "proactive.dismissed",       # 主动搭话被推开了（FloatingPet）
        "task.highRisk",             # 高风险操作完成（agents/conversation）
        "dailyQuestion.completed",   # 两人都答完了每日一问（api）
        "wish.completed",            # 预留：一起做到了一件想做的事
        "interaction.longSession",   # 预留：罕见的长时间陪伴
        "user.sentiment",            # 预留：明确的情绪表达
    }
)

#: **刻意不进记忆的事件**，写在这里是为了让「为什么没有它」有据可查——
#: 否则下一个人只会看到白名单里没有，以为是漏了。
#:
#: - `anniversary.due`：日期是算出来的，不是想起来的。`EventTimer` 里存着，
#:   每年都会重新算；把「今天是第 300 天」写成记忆，明年就是条错的。
#: - `mood.checkIn`：一天一条，一年三百多条，都进记忆会把真正的事淹掉。
#:   它的价值在**当下**（给 Cognition 一个关心的理由），不在回顾。
#: - `chat.*` / `pet.action`：私聊内容属于两个人，不该被宠物二次转述成
#:   「我记得你们那天吵架了」；宠物动作则是执行细节，不是经历。
DELIBERATELY_FORGOTTEN = frozenset(
    {"anniversary.due", "mood.checkIn", "pet.action"}
)

#: 攒到这么多条待反思事件就触发一次反思。
#: 太小会让每次反思只看到孤立的一两件事，提炼不出关系层面的东西；
#: 太大则要等很久才沉淀。另有每日兜底扫描，见 `tasks.sweep_pending_reflections`。
REFLECTION_BATCH_TRIGGER = 8

#: 重要度门槛。低于这个值即使类型对也不进模型——省钱是次要的，
#: 主要是避免把琐事写成「共同回忆」。
IMPORTANCE_FLOOR = 60

#: 单次反思最多消费多少条事件。
BATCH_SIZE = 40

SYSTEM_PROMPT = """你在整理一只电子宠物与主人之间发生过的事。

从下面的事件里提炼出**对这段关系真正有影响**的经历。判断标准：
半年后回头看，这件事还值得记得吗？如果只是「今天也一起待了一会儿」，那就不值得。

规则：
- 只输出一个 JSON 数组，不要代码块，不要解释。没有值得记的就输出 []。
- 元素格式：{"kind","content","importance"}。
- kind 取 experience（共同经历）、preference（主人的偏好）、
  relationship（关系本身的变化）之一。
- content 用第三人称陈述，一句话，不超过 40 字。
- importance 是 0 到 100 的整数。
- 最多 5 条。宁可少，不要凑。
- 不要把工具执行、页面浏览、动画播放写成经历。
"""


def _strip_fence(raw: str) -> str:
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1]
        text = text.rsplit("```", 1)[0]
    return text.strip()


def _message_text(response) -> str:
    content = getattr(response, "content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            block.get("text", "")
            for block in content
            if isinstance(block, dict)
        )
    return str(content)


def is_meaningful(event: CompanionPetEvent) -> bool:
    """事件够不够格进入反思。两道关卡都得过。"""
    return event.type in MEANINGFUL_TYPES and event.importance >= IMPORTANCE_FLOOR


async def pending_events(
    db: AsyncSession,
    companion_id: str,
    limit: int = BATCH_SIZE,
) -> list[CompanionPetEvent]:
    """取待反思的事件。

    注意查询里带了类型与重要度过滤：不合格的事件**根本不会被读出来**，
    也就没有机会因为某次改动漏进 Prompt。
    """
    return list(
        await db.scalars(
            select(CompanionPetEvent)
            .where(
                CompanionPetEvent.companion_id == companion_id,
                CompanionPetEvent.processed_at.is_(None),
                CompanionPetEvent.type.in_(MEANINGFUL_TYPES),
                CompanionPetEvent.importance >= IMPORTANCE_FLOOR,
            )
            .order_by(CompanionPetEvent.occurred_at)
            .limit(limit)
        )
    )


async def pending_count(db: AsyncSession, companion_id: str) -> int:
    """待反思事件的条数。过滤条件与 `pending_events` 必须一致——
    用不同的条件计数会让触发阈值和实际能消费的量对不上。
    """
    return (
        await db.scalar(
            select(func.count(CompanionPetEvent.id)).where(
                CompanionPetEvent.companion_id == companion_id,
                CompanionPetEvent.processed_at.is_(None),
                CompanionPetEvent.type.in_(MEANINGFUL_TYPES),
                CompanionPetEvent.importance >= IMPORTANCE_FLOOR,
            )
        )
    ) or 0


async def companions_with_pending(db: AsyncSession, limit: int = 200) -> list[str]:
    """有待反思事件的伴侣。每日兜底扫描用。"""
    return list(
        await db.scalars(
            select(CompanionPetEvent.companion_id)
            .where(
                CompanionPetEvent.processed_at.is_(None),
                CompanionPetEvent.type.in_(MEANINGFUL_TYPES),
                CompanionPetEvent.importance >= IMPORTANCE_FLOOR,
            )
            .group_by(CompanionPetEvent.companion_id)
            .limit(limit)
        )
    )


def _describe(event: CompanionPetEvent) -> str:
    when = event.occurred_at.strftime("%m-%d %H:%M") if event.occurred_at else "?"
    payload = json.dumps(event.payload, ensure_ascii=False)[:200]
    return f"[{when}] {event.type} (重要度 {event.importance}) {payload}"


def _clamp_importance(value) -> int:
    try:
        number = int(float(value))
    except (TypeError, ValueError):
        return 50
    return max(0, min(100, number))


class ReflectionAgent:
    def __init__(self, model, memory: MemoryService):
        self.model = model
        self.memory = memory
        self.spec = spec_for(AgentRole.REFLECTION)

    async def reflect(
        self,
        db: AsyncSession,
        companion: Companion,
    ) -> list[str]:
        """消费一批事件，返回写入的记忆内容。

        事件无论有没有产出记忆都会被标记为已处理——否则一条模型始终提炼不出
        东西的事件会被反复重读，每次都花一次调用。
        """
        events = await pending_events(db, companion.id)
        if not events:
            return []

        transcript = "\n".join(_describe(event) for event in events)
        try:
            response = await self.model.ainvoke(
                [
                    SystemMessage(content=SYSTEM_PROMPT),
                    HumanMessage(content=transcript),
                ]
            )
            candidates = json.loads(_strip_fence(_message_text(response)))
        except Exception:
            # 反思失败不该阻塞队列，但也不能把事件标记成已处理——
            # 那等于悄悄丢掉了它们。下次再试。
            logger.info("Reflection 调用或解析失败，事件保留待下次", exc_info=True)
            return []

        if not isinstance(candidates, list):
            candidates = []

        written: list[str] = []
        for candidate in candidates[:5]:
            if not isinstance(candidate, dict):
                continue
            content = str(candidate.get("content", "")).strip()
            if not content:
                continue
            item = await self.memory.create(
                db,
                companion.owner_id,
                MemoryCreate(
                    scope="companion",
                    companionId=companion.id,
                    kind=str(candidate.get("kind", "experience"))[:40],
                    content=content[:400],
                    importance=_clamp_importance(candidate.get("importance", 50)),
                ),
                embed=False,
            )
            try:
                await self.memory.embed_item(db, item)
            except Exception:
                # 向量化失败不该连累记忆本身：条目已经写进去了，检索退化成
                # 按重要度排序，下次 memory.embed 作业还能补上。
                logger.info("记忆向量化失败，条目已保留：%s", item.id)
            written.append(content)

        processed_at = utcnow()
        for event in events:
            event.processed_at = processed_at
        await db.commit()
        logger.info(
            "Reflection 消费 %s 条事件，写入 %s 条记忆", len(events), len(written)
        )
        return written


async def record_event(
    db: AsyncSession,
    companion_id: str,
    event_type: str,
    payload: dict,
    importance: int = 50,
    occurred_at: datetime | None = None,
) -> CompanionPetEvent:
    """写一条待反思事件。

    调用方不需要判断这条事件够不够格——过滤在读取端。写下来的好处是即使
    某类事件暂时不进记忆，它仍然留有痕迹，将来调门槛时可以回溯。
    """
    event = CompanionPetEvent(
        companion_id=companion_id,
        type=event_type,
        payload=payload,
        importance=max(0, min(100, importance)),
        occurred_at=occurred_at or utcnow(),
    )
    db.add(event)
    return event
