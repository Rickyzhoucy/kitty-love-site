"""Daily question: one shared prompt per day, answers revealed once both answer.

计划文档 §2.1（S5 关系内容，第一个功能）。`DailyQuestion.date` 唯一——两人
共享同一道题；各自的回答存在 `DailyAnswer`，`(questionId, userId)` 唯一防止
重复提交。

Revision ID: 20260730_0017
Revises: 20260730_0016
Create Date: 2026-07-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260730_0017"
down_revision: str | Sequence[str] | None = "20260730_0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "DailyQuestion",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("date", sa.String(10), nullable=False, unique=True),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("category", sa.String(20), nullable=False),
        sa.Column(
            "createdAt",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    op.create_table(
        "DailyAnswer",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column(
            "createdAt",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "questionId",
            sa.String(32),
            sa.ForeignKey("DailyQuestion.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "userId",
            sa.String(32),
            sa.ForeignKey("User.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("body", sa.Text(), nullable=False),
        sa.UniqueConstraint("questionId", "userId", name="DailyAnswer_questionId_userId_key"),
    )


def downgrade() -> None:
    op.drop_table("DailyAnswer")
    op.drop_table("DailyQuestion")
