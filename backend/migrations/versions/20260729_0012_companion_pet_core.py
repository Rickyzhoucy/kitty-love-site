"""Companion pet core tables (架构文档 §11).

只建新表，不动既有数据。`Pet` → `Companion` 的数据迁移刻意拆成下一个迁移
（0013），这样建表和搬数据可以分别回滚。

Revision ID: 20260729_0012
Revises: 20260728_0011
Create Date: 2026-07-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "20260729_0012"
down_revision: str | Sequence[str] | None = "20260728_0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSON_TYPE = sa.JSON().with_variant(JSONB(), "postgresql")


def _id() -> sa.Column:
    return sa.Column("id", sa.String(32), primary_key=True)


def _created_at() -> sa.Column:
    return sa.Column(
        "createdAt",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    )


def upgrade() -> None:
    op.create_table(
        "CompanionPetProfile",
        _id(),
        _created_at(),
        sa.Column(
            "companionId",
            sa.String(32),
            sa.ForeignKey("Companion.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("species", sa.String(40), nullable=False, server_default="dog"),
        sa.Column("bodyAssetId", sa.String(120), nullable=False, server_default="kitty"),
        sa.Column("traits", JSON_TYPE, nullable=False, server_default="{}"),
        sa.Column(
            "birthday",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("relationshipLevel", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "updatedAt",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    op.create_table(
        "CompanionPetState",
        _id(),
        _created_at(),
        sa.Column(
            "companionId",
            sa.String(32),
            sa.ForeignKey("Companion.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("needs", JSON_TYPE, nullable=False, server_default="{}"),
        sa.Column("mood", JSON_TYPE, nullable=False, server_default="{}"),
        sa.Column("relationship", JSON_TYPE, nullable=False, server_default="{}"),
        sa.Column("activeGoal", sa.String(40), nullable=False, server_default="idle"),
        sa.Column(
            "evaluatedAt",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    op.create_table(
        "CompanionPetEvent",
        _id(),
        sa.Column(
            "companionId",
            sa.String(32),
            sa.ForeignKey("Companion.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("type", sa.String(60), nullable=False),
        sa.Column("payload", JSON_TYPE, nullable=False, server_default="{}"),
        sa.Column("importance", sa.Integer(), nullable=False, server_default="50"),
        sa.Column(
            "occurredAt",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("processedAt", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "CompanionPetEvent_pending_idx",
        "CompanionPetEvent",
        ["companionId", "processedAt", "importance"],
    )

    op.create_table(
        "AgentTask",
        _id(),
        _created_at(),
        sa.Column(
            "userId",
            sa.String(32),
            sa.ForeignKey("User.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "companionId",
            sa.String(32),
            sa.ForeignKey("Companion.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "conversationId",
            sa.String(32),
            sa.ForeignKey("Conversation.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("capability", sa.String(60), nullable=False),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("riskLevel", sa.String(10), nullable=False, server_default="none"),
        sa.Column("safeSummary", sa.Text(), nullable=False, server_default=""),
        sa.Column("resultSummary", sa.Text(), nullable=True),
        sa.Column("completedAt", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "AgentTask_userId_createdAt_idx", "AgentTask", ["userId", "createdAt"]
    )

    op.create_table(
        "AgentTaskStep",
        _id(),
        _created_at(),
        sa.Column(
            "taskId",
            sa.String(32),
            sa.ForeignKey("AgentTask.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "toolRunId",
            sa.String(32),
            sa.ForeignKey("ToolRun.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("sequence", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("capability", sa.String(60), nullable=False, server_default=""),
        sa.Column("safeSummary", sa.Text(), nullable=False, server_default=""),
        sa.UniqueConstraint("taskId", "sequence"),
    )


def downgrade() -> None:
    op.drop_table("AgentTaskStep")
    op.drop_index("AgentTask_userId_createdAt_idx", table_name="AgentTask")
    op.drop_table("AgentTask")
    op.drop_index("CompanionPetEvent_pending_idx", table_name="CompanionPetEvent")
    op.drop_table("CompanionPetEvent")
    op.drop_table("CompanionPetState")
    op.drop_table("CompanionPetProfile")
