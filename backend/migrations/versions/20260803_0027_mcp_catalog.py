"""Server-side MCP connection and reviewed tool catalog.

Revision ID: 20260803_0027
Revises: 20260803_0026
Create Date: 2026-08-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "20260803_0027"
down_revision: str | Sequence[str] | None = "20260803_0026"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSON_TYPE = sa.JSON().with_variant(JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "McpServer",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("name", sa.String(120), nullable=False, unique=True),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column(
            "transport", sa.String(32), nullable=False, server_default="streamable_http"
        ),
        sa.Column("authHeadersCiphertext", sa.Text(), nullable=False, server_default=""),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("status", sa.String(24), nullable=False, server_default="unverified"),
        sa.Column("lastError", sa.Text(), nullable=True),
        sa.Column("lastSyncedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("metadata", JSON_TYPE, nullable=False, server_default="{}"),
    )
    op.create_table(
        "McpTool",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "serverId",
            sa.String(32),
            sa.ForeignKey("McpServer.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("inputSchema", JSON_TYPE, nullable=False, server_default="{}"),
        sa.Column("outputSchema", JSON_TYPE, nullable=True),
        sa.Column("annotations", JSON_TYPE, nullable=False, server_default="{}"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("riskLevel", sa.String(10), nullable=False, server_default="high"),
        sa.UniqueConstraint("serverId", "name"),
    )


def downgrade() -> None:
    op.drop_table("McpTool")
    op.drop_table("McpServer")
