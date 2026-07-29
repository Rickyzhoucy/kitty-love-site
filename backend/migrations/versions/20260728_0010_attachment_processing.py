"""Store attachment derivatives and memory provenance."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "20260728_0010"
down_revision = "20260728_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    memory_columns = {
        column["name"] for column in inspector.get_columns("MemoryItem")
    }
    if "sourceMessageIds" not in memory_columns:
        op.add_column(
            "MemoryItem",
            sa.Column(
                "sourceMessageIds",
                sa.JSON().with_variant(JSONB(), "postgresql"),
                nullable=False,
                server_default="[]",
            ),
        )
    attachment_columns = {
        column["name"] for column in inspector.get_columns("Attachment")
    }
    definitions = {
        "parseStatus": sa.Column(
            "parseStatus",
            sa.String(20),
            nullable=False,
            server_default="pending",
        ),
        "extractedText": sa.Column("extractedText", sa.Text(), nullable=True),
        "parseError": sa.Column("parseError", sa.Text(), nullable=True),
        "derivedBucket": sa.Column("derivedBucket", sa.String(80), nullable=True),
        "thumbnailKey": sa.Column("thumbnailKey", sa.Text(), nullable=True),
    }
    for name, definition in definitions.items():
        if name not in attachment_columns:
            op.add_column("Attachment", definition)


def downgrade() -> None:
    op.drop_column("Attachment", "thumbnailKey")
    op.drop_column("Attachment", "derivedBucket")
    op.drop_column("Attachment", "extractedText")
    op.drop_column("Attachment", "parseError")
    op.drop_column("Attachment", "parseStatus")
    op.drop_column("MemoryItem", "sourceMessageIds")
