"""Add hybrid memory retrieval indexes.

Revision ID: 20260728_0004
Revises: 20260728_0003
Create Date: 2026-07-28
"""
from collections.abc import Sequence

from alembic import op

revision: str = "20260728_0004"
down_revision: str | Sequence[str] | None = "20260728_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute(
        'CREATE INDEX IF NOT EXISTS "MemoryItem_content_trgm_idx" '
        'ON "MemoryItem" USING gin ("content" gin_trgm_ops)'
    )
    op.execute(
        'CREATE INDEX IF NOT EXISTS "MemoryEmbedding_embedding_hnsw_idx" '
        'ON "MemoryEmbedding" USING hnsw ("embedding" vector_cosine_ops)'
    )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute('DROP INDEX IF EXISTS "MemoryEmbedding_embedding_hnsw_idx"')
    op.execute('DROP INDEX IF EXISTS "MemoryItem_content_trgm_idx"')
