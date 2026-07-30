"""Create Plan / Wish and extend EventTimer with recurrence.

只建表、加字段，不搬数据——搬数据在 0015。拆开的理由与 0012/0013 相同：
建表和搬数据要能分别回滚。

Revision ID: 20260730_0014
Revises: 20260729_0013
Create Date: 2026-07-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "20260730_0014"
down_revision: str | Sequence[str] | None = "20260729_0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSON_TYPE = sa.JSON().with_variant(JSONB(), "postgresql")


def _common_columns() -> list[sa.Column]:
    """id / createdAt / 归属人，与站内其它资源表保持一致。"""
    return [
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column(
            "createdAt",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "createdBy",
            sa.String(32),
            sa.ForeignKey("User.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "createdByCompanion",
            sa.String(32),
            sa.ForeignKey("Companion.id", ondelete="SET NULL"),
            nullable=True,
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "Plan",
        *_common_columns(),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("dueAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completedAt", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("Plan_dueAt_idx", "Plan", ["dueAt"])

    op.create_table(
        "Wish",
        *_common_columns(),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("category", sa.String(40), nullable=False),
        sa.Column("completedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "completionPhotoId",
            sa.String(32),
            sa.ForeignKey("Attachment.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    op.add_column(
        "EventTimer",
        sa.Column("recurrence", sa.String(16), nullable=False, server_default="none"),
    )
    op.add_column(
        "EventTimer",
        sa.Column(
            "remindDaysBefore", JSON_TYPE, nullable=False, server_default="[]"
        ),
    )


def downgrade() -> None:
    op.drop_column("EventTimer", "remindDaysBefore")
    op.drop_column("EventTimer", "recurrence")
    op.drop_index("Plan_dueAt_idx", table_name="Plan")
    op.drop_table("Wish")
    op.drop_table("Plan")
