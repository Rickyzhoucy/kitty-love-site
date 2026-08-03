"""插话记下「是哪只宠物说的」。

少了这一列，归属在落库时就丢了：前端只能拿本地那只宠物顶上去，于是同一条插话
在两个人屏幕上挂着不同的名字。@ 谁就该是谁在答，而这个信息只有写入那一刻知道。

可空，并且外键用 SET NULL：
- 旧数据没有这个归属，猜一个不如老实留空，前端对空值回退到中性称呼；
- 宠物被删掉时插话本身还是聊天记录的一部分，不该跟着消失。
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260803_0025"
down_revision: str | Sequence[str] | None = "20260803_0024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "PetInterjection",
        sa.Column("companionId", sa.String(length=32), nullable=True),
    )
    op.create_foreign_key(
        "PetInterjection_companionId_fkey",
        "PetInterjection",
        "Companion",
        ["companionId"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "PetInterjection_companionId_fkey", "PetInterjection", type_="foreignkey"
    )
    op.drop_column("PetInterjection", "companionId")
