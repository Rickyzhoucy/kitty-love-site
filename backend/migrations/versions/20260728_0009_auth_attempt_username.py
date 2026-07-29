"""Rate-limit login attempts by both IP and username."""

import sqlalchemy as sa
from alembic import op

revision = "20260728_0009"
down_revision = "20260728_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "AuthAttempt", sa.Column("username", sa.String(80), nullable=True)
    )
    op.create_index(
        "AuthAttempt_username_createdAt_idx",
        "AuthAttempt",
        ["username", "createdAt"],
    )


def downgrade() -> None:
    op.drop_index(
        "AuthAttempt_username_createdAt_idx", table_name="AuthAttempt"
    )
    op.drop_column("AuthAttempt", "username")
