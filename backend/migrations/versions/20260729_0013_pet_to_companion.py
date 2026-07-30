"""Fold the legacy singleton `Pet` into Companion + CompanionPetProfile.

改造前有两套宠物真相：全站单例的 `Pet`（名字 + 外观）和每用户的 `Companion`
（名字 + 人格）。前端显示 `Pet.name`，Agent 用 `Companion.name`，同一只宠物
两个名字。这个迁移把身份统一到 Companion。

搬运规则：

- 每个 Companion 建一条 CompanionPetProfile，`bodyAssetId` 取自 Pet 单例。
- 只有当 Companion 还叫默认的 "Kitty"、而 Pet 被改过名时，才把 Pet 的名字
  搬过去——用户改过 Companion 名字就是明确表态，不能被单例覆盖。
- 搬完删除 `Pet`。留着它就等于留着第二份真相，正是这个迁移要消灭的东西。

`downgrade()` 会重建 `Pet` 并从最早的 profile 还原一行。

Revision ID: 20260729_0013
Revises: 20260729_0012
Create Date: 2026-07-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260729_0013"
down_revision: str | Sequence[str] | None = "20260729_0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DEFAULT_COMPANION_NAME = "Kitty"
DEFAULT_PET_NAME = "小猫咪"
DEFAULT_ASSET = "kitty"

#: 资源 id → 物种。宠物脑用它决定叫声、动作库这类与外观绑定的东西。
SPECIES_BY_ASSET = {
    "shiba": "dog",
    "bichon": "dog",
    "kitty": "cat",
    "hello-kitty": "cat",
    "momo": "cat",
    "snoopy": "dog",
}


def _new_id(connection: sa.Connection) -> str:
    """迁移里不引 app.ids——迁移必须能脱离应用代码独立跑。"""
    return connection.execute(
        sa.text("SELECT replace(cast(gen_random_uuid() as text), '-', '')")
    ).scalar_one()[:32]


def upgrade() -> None:
    connection = op.get_bind()
    is_postgres = connection.dialect.name == "postgresql"

    pet = connection.execute(
        sa.text('SELECT name, "assetId" FROM "Pet" ORDER BY "createdAt" LIMIT 1')
    ).first()
    pet_name = pet[0] if pet else None
    asset_id = (pet[1] if pet else None) or DEFAULT_ASSET
    species = SPECIES_BY_ASSET.get(asset_id, "cat")

    companions = connection.execute(
        sa.text('SELECT id, name FROM "Companion"')
    ).fetchall()

    for index, (companion_id, companion_name) in enumerate(companions):
        if is_postgres:
            profile_id = _new_id(connection)
        else:
            profile_id = f"migrated{index:024d}"
        connection.execute(
            sa.text(
                'INSERT INTO "CompanionPetProfile"'
                ' (id, "companionId", species, "bodyAssetId")'
                " VALUES (:id, :companion_id, :species, :asset_id)"
            ),
            {
                "id": profile_id,
                "companion_id": companion_id,
                "species": species,
                "asset_id": asset_id,
            },
        )
        adopt_pet_name = (
            pet_name
            and pet_name != DEFAULT_PET_NAME
            and companion_name == DEFAULT_COMPANION_NAME
        )
        if adopt_pet_name:
            connection.execute(
                sa.text('UPDATE "Companion" SET name = :name WHERE id = :id'),
                {"name": pet_name, "id": companion_id},
            )

    op.drop_table("Pet")


def downgrade() -> None:
    op.create_table(
        "Pet",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column(
            "createdAt",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("name", sa.String(), nullable=False, server_default=DEFAULT_PET_NAME),
        sa.Column("assetId", sa.String(120), nullable=True),
        sa.Column(
            "updatedAt",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    connection = op.get_bind()
    restored = connection.execute(
        sa.text(
            'SELECT p."bodyAssetId", c.name FROM "CompanionPetProfile" p'
            ' JOIN "Companion" c ON c.id = p."companionId"'
            ' ORDER BY p."createdAt" LIMIT 1'
        )
    ).first()
    connection.execute(
        sa.text(
            'INSERT INTO "Pet" (id, name, "assetId")'
            " VALUES (:id, :name, :asset_id)"
        ),
        {
            "id": "restoredpet00000000000000000000",
            "name": restored[1] if restored else DEFAULT_PET_NAME,
            "asset_id": restored[0] if restored else DEFAULT_ASSET,
        },
    )
