"""Passkey：一张凭据表 + 一张一次性挑战表。

密码登录**保留**，passkey 是加法。手机丢了、系统重装、换到没同步的设备上，
passkey 会把人直接锁在门外——这不是「稳妥起见」，是它的固有性质。

凭据表同时服务主站用户和后台管理员，靠两个可空外键加一条「恰好有一个非空」
的约束：外键完整性还在（删账号连带删凭据），而「把主站凭据当后台凭据用」
在数据库层面就写不进去。

Revision ID: 20260801_0021
Revises: 20260801_0020
Create Date: 2026-08-01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "20260801_0021"
down_revision: str | Sequence[str] | None = "20260801_0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "WebAuthnCredential",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column(
            "userId",
            sa.String(length=32),
            sa.ForeignKey("User.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "adminId",
            sa.String(length=32),
            sa.ForeignKey("Admin.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("credentialId", sa.LargeBinary(length=256), nullable=False, unique=True),
        sa.Column("publicKey", sa.LargeBinary(length=512), nullable=False),
        sa.Column("signCount", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "transports",
            sa.JSON().with_variant(JSONB(), "postgresql"),
            nullable=False,
            server_default="[]",
        ),
        sa.Column("label", sa.String(length=80), nullable=False, server_default=""),
        sa.Column("lastUsedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            '("userId" IS NULL) <> ("adminId" IS NULL)',
            name="WebAuthnCredential_exactly_one_owner",
        ),
    )
    op.create_index("WebAuthnCredential_userId_idx", "WebAuthnCredential", ["userId"])
    op.create_index("WebAuthnCredential_adminId_idx", "WebAuthnCredential", ["adminId"])

    op.create_table(
        "WebAuthnChallenge",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("challenge", sa.LargeBinary(length=64), nullable=False),
        sa.Column("purpose", sa.String(length=20), nullable=False),
        sa.Column("audience", sa.String(length=20), nullable=False),
        sa.Column("subjectId", sa.String(length=32), nullable=True),
        sa.Column("expiresAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("WebAuthnChallenge")
    op.drop_index("WebAuthnCredential_adminId_idx", table_name="WebAuthnCredential")
    op.drop_index("WebAuthnCredential_userId_idx", table_name="WebAuthnCredential")
    op.drop_table("WebAuthnCredential")
