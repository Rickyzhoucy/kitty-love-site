"""Associate photos with durable attachments.

Revision ID: 20260728_0006
Revises: 20260728_0005
Create Date: 2026-07-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260728_0006"
down_revision: str | Sequence[str] | None = "20260728_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("Photo")}
    if "attachmentId" not in columns:
        op.add_column("Photo", sa.Column("attachmentId", sa.String(length=32), nullable=True))
        op.create_foreign_key(
            "Photo_attachmentId_fkey",
            "Photo",
            "Attachment",
            ["attachmentId"],
            ["id"],
            ondelete="RESTRICT",
        )
        op.create_unique_constraint("Photo_attachmentId_key", "Photo", ["attachmentId"])
    if "url" in columns:
        op.alter_column("Photo", "url", existing_type=sa.Text(), nullable=True)


def downgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("Photo")}
    if "attachmentId" in columns:
        op.drop_constraint("Photo_attachmentId_key", "Photo", type_="unique")
        op.drop_constraint("Photo_attachmentId_fkey", "Photo", type_="foreignkey")
        op.drop_column("Photo", "attachmentId")
