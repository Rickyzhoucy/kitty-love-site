"""桌面本地执行器：一张机器表 + 一张调用表。

宠物的大脑在云端，但「读这台电脑上的文件」只能发生在用户自己的机器上。
这两张表是那条通路：云端把工具调用挂在这里，桌面端认领、执行、回填。

`LocalToolCall.state` 上的 CHECK 不是装饰：认领走的是一条原子的
`UPDATE ... WHERE state='pending'`，状态值写错（比如手滑写成 'claim'）
会让那条 UPDATE 永远匹配不到行，表现是「派发了但没人执行」，
而这种失败在日志里什么都不留。约束住之后写错会当场报错。

Revision ID: 20260803_0022
Revises: 20260801_0021
Create Date: 2026-08-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "20260803_0022"
down_revision: str | Sequence[str] | None = "20260801_0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "DesktopExecutor",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "userId",
            sa.String(length=32),
            sa.ForeignKey("User.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("lastSeenAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "allowedRoots",
            JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
    )
    op.create_index(
        "DesktopExecutor_userId_lastSeenAt_idx",
        "DesktopExecutor",
        ["userId", "lastSeenAt"],
    )

    op.create_table(
        "LocalToolCall",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "executorId",
            sa.String(length=32),
            sa.ForeignKey("DesktopExecutor.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("tool", sa.String(length=80), nullable=False),
        sa.Column(
            "arguments",
            JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "state",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
        sa.Column("result", JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("claimedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolvedAt", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "state IN ('pending', 'claimed', 'done', 'failed')",
            name="LocalToolCall_state_check",
        ),
    )
    op.create_index(
        "LocalToolCall_executorId_state_idx",
        "LocalToolCall",
        ["executorId", "state"],
    )


def downgrade() -> None:
    op.drop_index("LocalToolCall_executorId_state_idx", table_name="LocalToolCall")
    op.drop_table("LocalToolCall")
    op.drop_index("DesktopExecutor_userId_lastSeenAt_idx", table_name="DesktopExecutor")
    op.drop_table("DesktopExecutor")
