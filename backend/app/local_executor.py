"""把工具调用派发到用户自己的电脑上，并等它回来。

## 为什么需要这一层

宠物的大脑在云端（腾讯云），而「读这台电脑上的文件」只能发生在用户的机器上，
那台机器在 NAT 后面，云端拨不进去。所以方向反过来：桌面端**保持一条出站长连接**
（复用现有的 SSE），云端把活儿挂在 `LocalToolCall` 上，桌面端认领并回填。

## 三个关键决定

**一、SSE 只发通知，不发参数。**
`stream_outbox` 是全局广播，没有按用户过滤——每个连接都收到每一条事件。
把文件路径放进 payload，等于对方的浏览器也会收到「正在读 ~/Documents/xxx」。
所以事件里只有 `callId` + `executorId`，参数由桌面端带着鉴权来取。

**二、认领即租约，而且是原子的。**
一个人可能有好几台电脑。光在派发端「挑一台」是不够的——那只是选了个收件人，
拦不住另一台也去执行。真正的互斥在认领那条
`UPDATE ... WHERE state='pending'` 上：抢到行的才拿得到参数。

**三、超时要给 agent 一个明确的错误。**
桌面端没开、睡着了、网断了都是常态。干等只会让整轮对话卡死，
不如告诉模型「那台电脑没响应」，它至少能换个说法回复用户。
"""

from __future__ import annotations

import asyncio
from datetime import timedelta
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import DesktopExecutor, LocalToolCall, OutboxEvent, utcnow

#: 超过这么久没心跳就当这台机器不在线。
#: 桌面端每 30 秒报一次，留两次的余量——一次网络抖动不该让宠物说「电脑没开」。
ONLINE_WINDOW = timedelta(seconds=90)

#: 等桌面端执行的上限。读文件很快，留这么久是给「用户正在看审批弹窗」的余地；
#: 二期只读没有审批，但三期会有，接口形状先按那个来。
CALL_TIMEOUT_SECONDS = 60.0

#: 轮询回填结果的间隔。本地操作通常几十毫秒就回来，密一点体感更好。
POLL_INTERVAL_SECONDS = 0.4


class NoExecutorError(RuntimeError):
    """没有在线的电脑。这是常态，不是异常——文案要能直接给模型看。"""


async def online_executor(db: AsyncSession, user_id: str) -> DesktopExecutor | None:
    """挑一台在线的电脑。多台时取最近有心跳的那台。"""
    return await db.scalar(
        select(DesktopExecutor)
        .where(
            DesktopExecutor.user_id == user_id,
            DesktopExecutor.enabled.is_(True),
            DesktopExecutor.last_seen_at >= utcnow() - ONLINE_WINDOW,
        )
        .order_by(DesktopExecutor.last_seen_at.desc())
        .limit(1)
    )


async def claim_next(
    db: AsyncSession, executor_id: str
) -> LocalToolCall | None:
    """认领一条待办。**这条 UPDATE 就是租约。**

    `WHERE state='pending'` 加上 `RETURNING` 让「读到」和「占住」变成一步。
    先 SELECT 再 UPDATE 的写法在两台机器同时轮询时会双双通过检查，
    然后各执行一遍——而这种并发问题平时根本复现不出来，
    只在两台电脑都开着的那天出错。
    """
    row = await db.execute(
        update(LocalToolCall)
        .where(
            LocalToolCall.id.in_(
                select(LocalToolCall.id)
                .where(
                    LocalToolCall.executor_id == executor_id,
                    LocalToolCall.state == "pending",
                )
                .order_by(LocalToolCall.created_at)
                .limit(1)
                .scalar_subquery()
            )
        )
        .values(state="claimed", claimed_at=utcnow())
        .returning(LocalToolCall)
    )
    claimed = row.scalar_one_or_none()
    await db.commit()
    return claimed


async def resolve(
    db: AsyncSession,
    executor_id: str,
    call_id: str,
    result: dict[str, Any] | None,
    error: str | None,
) -> bool:
    """回填结果。只有认领它的那台机器能回填。"""
    outcome = await db.execute(
        update(LocalToolCall)
        .where(
            LocalToolCall.id == call_id,
            LocalToolCall.executor_id == executor_id,
            LocalToolCall.state == "claimed",
        )
        .values(
            state="failed" if error else "done",
            result={"error": error} if error else (result or {}),
            resolved_at=utcnow(),
        )
    )
    await db.commit()
    return outcome.rowcount > 0


async def dispatch(
    session_maker: async_sessionmaker[AsyncSession],
    user_id: str,
    tool: str,
    arguments: dict[str, Any],
) -> dict[str, Any]:
    """派一个活儿给用户的电脑，等结果回来。

    返回的永远是「可以直接交给模型」的东西：成功是结果本身，
    失败是一句人话——不抛异常给上层去猜。
    """
    async with session_maker() as db:
        executor = await online_executor(db, user_id)
        if executor is None:
            raise NoExecutorError(
                "现在没有在线的电脑。要用这个功能，得先在那台电脑上打开桌面版。"
            )
        call = LocalToolCall(
            executor_id=executor.id, tool=tool, arguments=arguments, state="pending"
        )
        db.add(call)
        await db.flush()
        call_id = call.id
        # **事件里只有 id，没有参数。** 见模块顶部第一条。
        db.add(
            OutboxEvent(
                topic="local_tool_call",
                aggregate_type="desktop_executor",
                aggregate_id=executor.id,
                payload={"callId": call_id, "executorId": executor.id},
            )
        )
        await db.commit()

    deadline = asyncio.get_running_loop().time() + CALL_TIMEOUT_SECONDS
    while asyncio.get_running_loop().time() < deadline:
        await asyncio.sleep(POLL_INTERVAL_SECONDS)
        async with session_maker() as db:
            current = await db.get(LocalToolCall, call_id)
            if current is None:
                raise NoExecutorError("这次调用不见了，请重试")
            if current.state == "done":
                return current.result or {}
            if current.state == "failed":
                raise NoExecutorError(
                    (current.result or {}).get("error") or "那台电脑执行失败了"
                )

    # 超时也要落库，否则桌面端晚一步回来还会去改一条早已放弃的调用。
    async with session_maker() as db:
        await db.execute(
            update(LocalToolCall)
            .where(LocalToolCall.id == call_id, LocalToolCall.state != "done")
            .values(
                state="failed",
                result={"error": "超时"},
                resolved_at=utcnow(),
            )
        )
        await db.commit()
    raise NoExecutorError("那台电脑没有响应，可能是睡着了或者没开着。")
