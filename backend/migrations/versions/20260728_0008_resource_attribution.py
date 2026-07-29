"""Track whether a user or companion created shared resources."""

import sqlalchemy as sa
from alembic import op

revision = "20260728_0008"
down_revision = "20260728_0007"
branch_labels = None
depends_on = None

TABLES = ("Message", "Memo", "Photo", "Milestone", "EventTimer", "Reminder")


def upgrade() -> None:
    for table in TABLES:
        op.add_column(table, sa.Column("createdBy", sa.String(32), nullable=True))
        op.add_column(
            table, sa.Column("createdByCompanion", sa.String(32), nullable=True)
        )
        op.create_foreign_key(
            f"{table}_createdBy_fkey",
            table,
            "User",
            ["createdBy"],
            ["id"],
            ondelete="SET NULL",
        )
        op.create_foreign_key(
            f"{table}_createdByCompanion_fkey",
            table,
            "Companion",
            ["createdByCompanion"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    for table in reversed(TABLES):
        op.drop_constraint(
            f"{table}_createdByCompanion_fkey", table, type_="foreignkey"
        )
        op.drop_constraint(f"{table}_createdBy_fkey", table, type_="foreignkey")
        op.drop_column(table, "createdByCompanion")
        op.drop_column(table, "createdBy")
