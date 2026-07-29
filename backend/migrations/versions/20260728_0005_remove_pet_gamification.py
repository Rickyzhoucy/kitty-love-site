"""Remove the retired pet gamification columns.

Revision ID: 20260728_0005
Revises: 20260728_0004
Create Date: 2026-07-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260728_0005"
down_revision: str | Sequence[str] | None = "20260728_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

LEGACY_COLUMNS = (
    "level",
    "experience",
    "happiness",
    "hunger",
    "evolution",
    "color",
    "mode",
    "accessories",
    "equippedItems",
    "customSprite",
    "lastFedAt",
    "lastPlayAt",
    "lastVisitAt",
    "dailyActions",
)


def upgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("Pet")}
    for column in LEGACY_COLUMNS:
        if column in columns:
            op.drop_column("Pet", column)


def downgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("Pet")}
    definitions = {
        "level": sa.Column("level", sa.Integer(), nullable=True),
        "experience": sa.Column("experience", sa.Integer(), nullable=True),
        "happiness": sa.Column("happiness", sa.Integer(), nullable=True),
        "hunger": sa.Column("hunger", sa.Integer(), nullable=True),
        "evolution": sa.Column("evolution", sa.Integer(), nullable=True),
        "color": sa.Column("color", sa.String(), nullable=True),
        "mode": sa.Column("mode", sa.String(), nullable=True),
        "accessories": sa.Column("accessories", sa.JSON(), nullable=True),
        "equippedItems": sa.Column("equippedItems", sa.JSON(), nullable=True),
        "customSprite": sa.Column("customSprite", sa.Text(), nullable=True),
        "lastFedAt": sa.Column("lastFedAt", sa.DateTime(timezone=True), nullable=True),
        "lastPlayAt": sa.Column("lastPlayAt", sa.DateTime(timezone=True), nullable=True),
        "lastVisitAt": sa.Column("lastVisitAt", sa.DateTime(timezone=True), nullable=True),
        "dailyActions": sa.Column("dailyActions", sa.JSON(), nullable=True),
    }
    for column in LEGACY_COLUMNS:
        if column not in columns:
            op.add_column("Pet", definitions[column])
