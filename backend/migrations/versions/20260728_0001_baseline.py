"""Prisma schema compatibility baseline.

Revision ID: 20260728_0001
Revises:
Create Date: 2026-07-28
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260728_0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    def entity_table(name: str, *columns: sa.Column) -> None:
        op.create_table(
            name,
            *columns,
            sa.Column("id", sa.String(32), primary_key=True),
            sa.Column(
                "createdAt",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
        )

    entity_table(
        "Message",
        sa.Column("nickname", sa.String(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
    )
    entity_table(
        "Memo",
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("completed", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    entity_table(
        "Photo",
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("caption", sa.String(), nullable=False),
        sa.Column("date", sa.String(), nullable=True),
    )
    entity_table(
        "Milestone",
        sa.Column("date", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
    )
    entity_table(
        "Admin",
        sa.Column("username", sa.String(), nullable=False, unique=True),
        sa.Column("password", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
    )
    entity_table(
        "SecurityQuestion",
        sa.Column("question", sa.String(), nullable=False),
        sa.Column("answer", sa.String(), nullable=False),
        sa.Column("hint", sa.String(), nullable=True),
    )
    entity_table(
        "AuthAttempt",
        sa.Column("ip", sa.String(), nullable=False),
        sa.Column("success", sa.Boolean(), nullable=False),
    )
    op.create_index(
        "AuthAttempt_ip_createdAt_idx",
        "AuthAttempt",
        ["ip", "createdAt"],
    )
    op.create_table(
        "SiteConfig",
        sa.Column("key", sa.String(), primary_key=True),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column(
            "updatedAt",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    entity_table(
        "EventTimer",
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("date", sa.String(), nullable=False),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
    )
    entity_table(
        "SiteConfigHistory",
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
    )
    entity_table(
        "Pet",
        sa.Column("name", sa.String(), nullable=False, server_default="小猫咪"),
        sa.Column("level", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("experience", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("happiness", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("hunger", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("evolution", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("color", sa.String(), nullable=False, server_default="pink"),
        sa.Column("mode", sa.String(), nullable=False, server_default="live2d"),
        sa.Column("accessories", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("equippedItems", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("customSprite", sa.Text(), nullable=True),
        sa.Column(
            "lastFedAt",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "lastPlayAt",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "lastVisitAt",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("dailyActions", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column(
            "updatedAt",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    entity_table(
        "Reminder",
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("dueDate", sa.String(), nullable=False),
        sa.Column("completed", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_table("Reminder")
    op.drop_table("Pet")
    op.drop_table("SiteConfigHistory")
    op.drop_table("EventTimer")
    op.drop_table("SiteConfig")
    op.drop_index("AuthAttempt_ip_createdAt_idx", table_name="AuthAttempt")
    op.drop_table("AuthAttempt")
    op.drop_table("SecurityQuestion")
    op.drop_table("Admin")
    op.drop_table("Milestone")
    op.drop_table("Photo")
    op.drop_table("Memo")
    op.drop_table("Message")
