"""Add user-level memory reference consent.

Revision ID: 20260803_0024
Revises: 20260803_0023
Create Date: 2026-08-03
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260803_0024"
down_revision: str | Sequence[str] | None = "20260803_0023"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "MemoryPreference",
        sa.Column(
            "referenceEnabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )


def downgrade() -> None:
    op.drop_column("MemoryPreference", "referenceEnabled")
