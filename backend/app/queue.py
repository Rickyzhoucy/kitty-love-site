from collections.abc import Awaitable, Callable, Mapping
from typing import Any, Protocol

import procrastinate
from procrastinate import RetryStrategy
from procrastinate.exceptions import AlreadyEnqueued

from app.config import get_settings

settings = get_settings()
procrastinate_app = procrastinate.App(
    connector=procrastinate.PsycopgConnector(conninfo=settings.procrastinate_database_url)
)
JobHandler = Callable[[dict[str, Any]], Awaitable[None]]
job_handlers: dict[str, JobHandler] = {}


def register_job(name: str):
    def decorator(handler: JobHandler) -> JobHandler:
        job_handlers[name] = handler
        return handler

    return decorator


class JobQueue(Protocol):
    async def enqueue(
        self,
        task_name: str,
        payload: Mapping[str, Any],
        *,
        idempotency_key: str,
    ) -> None: ...


@procrastinate_app.task(
    name="companion.dispatch",
    queue="companion",
    retry=RetryStrategy(max_attempts=5, exponential_wait=2),
)
async def dispatch(task_name: str, payload: dict[str, Any], idempotency_key: str) -> None:
    """Stable queue entry point; concrete handlers are registered by worker modules."""
    del idempotency_key
    try:
        handler = job_handlers[task_name]
    except KeyError as error:
        raise ValueError(f"未注册任务处理器：{task_name}") from error
    await handler(payload)


class ProcrastinateJobQueue:
    async def enqueue(
        self,
        task_name: str,
        payload: Mapping[str, Any],
        *,
        idempotency_key: str,
    ) -> None:
        try:
            await dispatch.configure(
                queueing_lock=f"{task_name}:{idempotency_key}"
            ).defer_async(
                task_name=task_name,
                payload=dict(payload),
                idempotency_key=idempotency_key,
            )
        except AlreadyEnqueued:
            # Idempotent callers treat an existing pending job as success.
            return
