# Kitty Love Python Backend

Private two-user companion service backend. The API and agent tools will share the same domain
services; this package establishes the database, session, resource, object storage, outbox/SSE and
PostgreSQL job-queue boundaries.

The companion runtime uses one globally compiled LangChain `create_agent`, LangGraph PostgreSQL
checkpoints, OpenAI-compatible chat/embedding endpoints, versioned 1024-dimensional memory vectors,
and `pg_trgm + pgvector` reciprocal-rank fusion. SQLite tests use `InMemorySaver` and a deterministic
Python retrieval fallback.

## Development

```powershell
uv sync
Copy-Item ".env.example" ".env"
uv run alembic upgrade head
uv run python -m app.cli create-user daniela "Daniela" --password "replace-me"
uv run uvicorn app.main:app --reload
```

Set `CHAT_BASE_URL`, `CHAT_API_KEY`, `CHAT_MODEL`, `EMBEDDING_BASE_URL`,
`EMBEDDING_API_KEY`, and `EMBEDDING_MODEL` before using `/api/v1/chat/stream`.
`EMBEDDING_DIMENSIONS` is intentionally fixed at `1024` to match the database schema.

For an existing Prisma-managed database, inspect the database first and stamp the baseline instead:

```powershell
uv run alembic stamp 20260728_0001
uv run alembic upgrade head
```

After stamping, Alembic is the only schema owner. Do not run `prisma migrate`.

Procrastinate owns its own tables and is initialized separately:

```powershell
uv run procrastinate --app=app.queue.procrastinate_app schema --apply
```

Run checks:

```powershell
uv run ruff check .
uv run pytest
```
