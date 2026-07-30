"""Direct messages between the two users, plus the pet's interjections.

与 `Message`（留言板）分开建表：那个是按昵称署名的公开留言，这个是两个人
之间的私信，有明确的收发双方和已读状态。宠物的插话再单独一张
（计划文档 §3.3）。

Revision ID: 20260730_0016
Revises: 20260730_0015
Create Date: 2026-07-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "20260730_0016"
down_revision: str | Sequence[str] | None = "20260730_0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSON_TYPE = sa.JSON().with_variant(JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "DirectMessage",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column(
            "createdAt",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "senderId",
            sa.String(32),
            sa.ForeignKey("User.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "recipientId",
            sa.String(32),
            sa.ForeignKey("User.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("body", sa.Text(), nullable=False, server_default=""),
        sa.Column("attachmentIds", JSON_TYPE, nullable=False, server_default="[]"),
        sa.Column("readAt", sa.DateTime(timezone=True), nullable=True),
    )
    # 未读查询是最热的路径
    op.create_index(
        "DirectMessage_recipient_readAt_idx",
        "DirectMessage",
        ["recipientId", "readAt"],
    )
    op.create_index("DirectMessage_createdAt_idx", "DirectMessage", ["createdAt"])

    op.create_table(
        "PetInterjection",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column(
            "createdAt",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "audienceId",
            sa.String(32),
            sa.ForeignKey("User.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "messageId",
            sa.String(32),
            sa.ForeignKey("DirectMessage.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("kind", sa.String(30), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
    )
    op.create_index(
        "PetInterjection_audience_createdAt_idx",
        "PetInterjection",
        ["audienceId", "createdAt"],
    )


def downgrade() -> None:
    op.drop_index(
        "PetInterjection_audience_createdAt_idx", table_name="PetInterjection"
    )
    op.drop_table("PetInterjection")
    op.drop_index("DirectMessage_createdAt_idx", table_name="DirectMessage")
    op.drop_index("DirectMessage_recipient_readAt_idx", table_name="DirectMessage")
    op.drop_table("DirectMessage")
