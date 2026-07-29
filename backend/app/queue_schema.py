import asyncio

from app.queue import procrastinate_app


async def ensure_queue_schema() -> None:
    async with procrastinate_app.open_async():
        row = await procrastinate_app.connector.execute_query_one_async(
            query="SELECT to_regclass('public.procrastinate_jobs') AS table_name"
        )
        if row["table_name"] is None:
            await procrastinate_app.schema_manager.apply_schema_async()


if __name__ == "__main__":
    asyncio.run(ensure_queue_schema())
