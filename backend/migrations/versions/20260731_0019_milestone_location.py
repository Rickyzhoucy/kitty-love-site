"""Fold map pins into milestones: a story entry may now carry a location.

「故事」和「地图」本来就是同一件事的两种看法——发生过的事，有时间，有时候还有
地点。分成两张表两个页面的代价是同一次旅行要记两遍，而且两边都不完整。

`MapPin` 的数据搬进 `Milestone` 后删表。搬的时候 `note` 进 `description`、
`date` 缺失时用 createdAt 兜底（Milestone.date 非空）。

Revision ID: 20260731_0019
Revises: 20260730_0018
Create Date: 2026-07-31
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "20260731_0019"
down_revision: str | Sequence[str] | None = "20260730_0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSON_TYPE = sa.JSON().with_variant(JSONB(), "postgresql")


def upgrade() -> None:
    op.add_column("Milestone", sa.Column("lat", sa.Float(), nullable=True))
    op.add_column("Milestone", sa.Column("lng", sa.Float(), nullable=True))
    op.add_column(
        "Milestone",
        sa.Column("photoIds", JSON_TYPE, nullable=False, server_default="[]"),
    )

    # 搬数据。用 SQL 而不是 ORM：迁移不该依赖模型的当前形状，那个还会再变。
    op.execute(
        """
        INSERT INTO "Milestone" (
            id, "createdAt", "createdBy", "createdByCompanion",
            date, title, description, lat, lng, "photoIds"
        )
        SELECT
            id,
            "createdAt",
            "createdBy",
            "createdByCompanion",
            COALESCE(NULLIF(date, ''), to_char("createdAt", 'YYYY-MM-DD')),
            title,
            COALESCE(note, ''),
            lat,
            lng,
            "photoIds"
        FROM "MapPin"
        """
    )
    op.drop_table("MapPin")


def downgrade() -> None:
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
    # 把有坐标的故事还原成地图点。没坐标的留在 Milestone——它们本来就不是点。
    op.execute(
        """
        INSERT INTO "MapPin" (
            id, "createdAt", "createdBy", "createdByCompanion",
            title, lat, lng, note, date, "photoIds"
        )
        SELECT
            id, "createdAt", "createdBy", "createdByCompanion",
            title, lat, lng, description, date, "photoIds"
        FROM "Milestone"
        WHERE lat IS NOT NULL AND lng IS NOT NULL
        """
    )
    op.execute('DELETE FROM "Milestone" WHERE lat IS NOT NULL AND lng IS NOT NULL')
    op.drop_column("Milestone", "photoIds")
    op.drop_column("Milestone", "lng")
    op.drop_column("Milestone", "lat")
