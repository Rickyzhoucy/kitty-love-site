"""Promote attachments to versioned artifacts with server document derivatives.

Revision ID: 20260803_0026
Revises: 20260803_0025
Create Date: 2026-08-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "20260803_0026"
down_revision: str | Sequence[str] | None = "20260803_0025"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSON_TYPE = sa.JSON().with_variant(JSONB(), "postgresql")


def upgrade() -> None:
    op.add_column("Attachment", sa.Column("documentIrKey", sa.Text(), nullable=True))
    op.add_column("Attachment", sa.Column("previewKey", sa.Text(), nullable=True))
    op.add_column("Attachment", sa.Column("parser", sa.String(80), nullable=True))
    op.add_column(
        "Attachment",
        sa.Column("artifactKind", sa.String(32), nullable=False, server_default="upload"),
    )
    op.add_column(
        "Attachment",
        sa.Column("artifactVersion", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column("Attachment", sa.Column("parentId", sa.String(32), nullable=True))
    op.add_column("Attachment", sa.Column("sourceToolRunId", sa.String(32), nullable=True))
    op.add_column(
        "Attachment",
        sa.Column("processingMetadata", JSON_TYPE, nullable=False, server_default="{}"),
    )
    op.create_foreign_key(
        "Attachment_parentId_fkey",
        "Attachment",
        "Attachment",
        ["parentId"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "Attachment_sourceToolRunId_fkey",
        "Attachment",
        "ToolRun",
        ["sourceToolRunId"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("Attachment_sourceToolRunId_fkey", "Attachment", type_="foreignkey")
    op.drop_constraint("Attachment_parentId_fkey", "Attachment", type_="foreignkey")
    op.drop_column("Attachment", "processingMetadata")
    op.drop_column("Attachment", "sourceToolRunId")
    op.drop_column("Attachment", "parentId")
    op.drop_column("Attachment", "artifactVersion")
    op.drop_column("Attachment", "artifactKind")
    op.drop_column("Attachment", "parser")
    op.drop_column("Attachment", "previewKey")
    op.drop_column("Attachment", "documentIrKey")
