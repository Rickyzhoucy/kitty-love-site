"""私信可以引用另一条私信。

**SET NULL 而不是 CASCADE**：被引用的那条哪天没了，这条回复本身还是说过的话，
不该跟着消失。前端遇到空引用显示「原消息已不在」。
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260803_0028"
down_revision: str | Sequence[str] | None = "20260803_0027"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "DirectMessage",
        sa.Column("replyToId", sa.String(length=32), nullable=True),
    )
    op.create_foreign_key(
        "DirectMessage_replyToId_fkey",
        "DirectMessage",
        "DirectMessage",
        ["replyToId"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("DirectMessage_replyToId_fkey", "DirectMessage", type_="foreignkey")
    op.drop_column("DirectMessage", "replyToId")
