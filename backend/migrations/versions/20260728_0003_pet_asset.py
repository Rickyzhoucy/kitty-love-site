"""Add selected animation asset to Pet.

Revision ID: 20260728_0003
Revises: 20260728_0002
Create Date: 2026-07-28
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260728_0003"
down_revision: str | Sequence[str] | None = "20260728_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("Pet")}
    if "assetId" not in columns:
        op.add_column("Pet", sa.Column("assetId", sa.String(length=120), nullable=True))


def downgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("Pet")}
    if "assetId" in columns:
        op.drop_column("Pet", "assetId")
