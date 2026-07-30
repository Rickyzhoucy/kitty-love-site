"""Mood check-in, future letters, love map (计划文档 §2.4 / §2.6 / §2.5).

三张互不相关的表放在同一个迁移里：它们是 S5 同一批落地的功能，一起上一起回滚
比拆成三个版本号好管。

- `MoodEntry`：一人一天一条，`(userId, date)` 唯一 → 重复打卡是更新
- `FutureLetter`：`unlockAt` 之前服务端不返回正文，锁在 API 层
- `MapPin`：坐标 GCJ-02（高德原生），前后端都不转换

Revision ID: 20260730_0018
Revises: 20260730_0017
Create Date: 2026-07-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "20260730_0018"
down_revision: str | Sequence[str] | None = "20260730_0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSON_TYPE = sa.JSON().with_variant(JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "MoodEntry",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column(
            "createdAt",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "userId",
            sa.String(32),
            sa.ForeignKey("User.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("date", sa.String(10), nullable=False),
        sa.Column("mood", sa.Integer(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.UniqueConstraint("userId", "date", name="MoodEntry_userId_date_key"),
    )
    op.create_index("MoodEntry_date_idx", "MoodEntry", ["date"])

    op.create_table(
        "FutureLetter",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column(
            "createdAt",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "authorId",
            sa.String(32),
            sa.ForeignKey("User.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("attachmentIds", JSON_TYPE, nullable=False, server_default="[]"),
        sa.Column("unlockAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("openedAt", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("FutureLetter_unlockAt_idx", "FutureLetter", ["unlockAt"])

    op.create_table(
        "MapPin",
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
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lng", sa.Float(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("date", sa.String(80), nullable=True),
        sa.Column("photoIds", JSON_TYPE, nullable=False, server_default="[]"),
    )


def downgrade() -> None:
    op.drop_table("MapPin")
    op.drop_index("FutureLetter_unlockAt_idx", table_name="FutureLetter")
    op.drop_table("FutureLetter")
    op.drop_index("MoodEntry_date_idx", table_name="MoodEntry")
    op.drop_table("MoodEntry")
