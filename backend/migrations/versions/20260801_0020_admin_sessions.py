"""后台独立会话表。

在这之前 `/admin` 走的是主站账号（登录页上写着「与主站使用同一个账号」），
任何能看照片的人也能改模型配置、翻全部记忆。这一版把后台拆成独立的一套：
账号复用一直空着的 `Admin` 表，会话另开这张 `AdminSession`。

**刻意不与 `UserSession` 合表。** 合表就得靠一个 kind 字段区分，而那种设计
里一次写错的查询就能让主站会话被当成后台会话使用。分开之后，「后台权限」
在类型层面就拿不到。

Revision ID: 20260801_0020
Revises: 20260731_0019
Create Date: 2026-08-01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260801_0020"
down_revision: str | Sequence[str] | None = "20260731_0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "AdminSession",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column(
            "adminId",
            sa.String(length=32),
            sa.ForeignKey("Admin.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("tokenHash", sa.LargeBinary(length=32), nullable=False, unique=True),
        sa.Column("expiresAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("lastSeenAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revokedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deviceName", sa.String(length=120), nullable=True),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "AdminSession_adminId_expiresAt_idx", "AdminSession", ["adminId", "expiresAt"]
    )


def downgrade() -> None:
    op.drop_index("AdminSession_adminId_expiresAt_idx", table_name="AdminSession")
    op.drop_table("AdminSession")
