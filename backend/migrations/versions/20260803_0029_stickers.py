"""表情包：各存各的，但同一个空间里能互相看到。

`ownerId` 管归属（删除只能删自己的），`spaceId` 管租户边界（别的空间的表情
不能出现在这儿）。两件事不是一回事，所以是两个字段。

`sortOrder` 越小越靠前。排序交互抄微信的「移到最前」而不是拖拽——几百个表情
拖拽排序是灾难，而人真正想要的只是把常用的顶上来。
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260803_0029"
down_revision: str | Sequence[str] | None = "20260803_0028"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 「这条是表情」必须显式标。靠「单张图片且没正文」去猜的话，
    # 普通照片会被渲染成表情（无气泡、固定尺寸）。
    op.add_column(
        "DirectMessage",
        sa.Column("sticker", sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    op.create_table(
        "Sticker",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("spaceId", sa.String(length=32), nullable=False),
        sa.Column("ownerId", sa.String(length=32), nullable=False),
        sa.Column("attachmentId", sa.String(length=32), nullable=False),
        sa.Column("sortOrder", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["spaceId"], ["CoupleSpace.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["ownerId"], ["User.id"], ondelete="CASCADE"),
        # RESTRICT：附件还被表情引用着就不该被清理掉
        sa.ForeignKeyConstraint(["attachmentId"], ["Attachment.id"], ondelete="RESTRICT"),
        # 同一张图在同一个人的库里只存一份
        sa.UniqueConstraint("ownerId", "attachmentId"),
    )
    op.create_index("Sticker_owner_sort_idx", "Sticker", ["ownerId", "sortOrder"])


def downgrade() -> None:
    op.drop_index("Sticker_owner_sort_idx", table_name="Sticker")
    op.drop_table("Sticker")
    op.drop_column("DirectMessage", "sticker")
