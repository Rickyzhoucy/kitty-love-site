"""Align legacy text columns with the frozen ORM schema."""

import sqlalchemy as sa
from alembic import op

revision = "20260728_0011"
down_revision = "20260728_0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "Photo",
        "caption",
        existing_type=sa.String(),
        type_=sa.Text(),
        existing_nullable=False,
    )
    op.alter_column(
        "SecurityQuestion",
        "question",
        existing_type=sa.String(),
        type_=sa.Text(),
        existing_nullable=False,
    )
    op.alter_column(
        "SecurityQuestion",
        "hint",
        existing_type=sa.String(),
        type_=sa.Text(),
        existing_nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "SecurityQuestion",
        "hint",
        existing_type=sa.Text(),
        type_=sa.String(),
        existing_nullable=True,
    )
    op.alter_column(
        "SecurityQuestion",
        "question",
        existing_type=sa.Text(),
        type_=sa.String(),
        existing_nullable=False,
    )
    op.alter_column(
        "Photo",
        "caption",
        existing_type=sa.Text(),
        type_=sa.String(),
        existing_nullable=False,
    )
