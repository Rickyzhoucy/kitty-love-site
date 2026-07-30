"""Fold Memo / Reminder into Plan / Wish, then drop the old tables.

搬运规则（详见 docs/couple-site-feature-plan.md §0.1）：

    Memo(category='todo')                 → Plan（无期限）
    Reminder                              → Plan（dueAt = dueDate）
    Memo(to-eat / to-go / to-buy)          → Wish
    其它未知 category 的 Memo               → Plan（保底，不丢数据）

`completed: bool` → `completedAt: datetime`。**布尔值里没有时间信息**，
只能用 `createdAt` 近似——这是有损的，且补记的唯一时机就是现在。

`dueDate` 是自由文本（旧表用 String 存），格式不保证。解析不出来的落 NULL
并把原文塞进 note，总比让整条迁移炸掉好。

Revision ID: 20260730_0015
Revises: 20260730_0014
Create Date: 2026-07-30
"""

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision: str = "20260730_0015"
down_revision: str | Sequence[str] | None = "20260730_0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

WISH_CATEGORIES = {"to-eat", "to-go", "to-buy"}


def _new_id(connection: sa.Connection, index: int, prefix: str) -> str:
    """迁移里不引 app.ids——迁移必须能脱离应用代码独立跑。"""
    if connection.dialect.name == "postgresql":
        return connection.execute(
            sa.text("SELECT replace(cast(gen_random_uuid() as text), '-', '')")
        ).scalar_one()[:32]
    return f"{prefix}{index:026d}"


def _parse_due(raw) -> datetime | None:
    """旧 dueDate 是自由文本，尽力而为地解析。"""
    if isinstance(raw, datetime):
        return raw
    if not isinstance(raw, str) or not raw.strip():
        return None
    text = raw.strip().replace("/", "-").replace("Z", "+00:00")
    for candidate in (text, text.replace(" ", "T")):
        try:
            return datetime.fromisoformat(candidate)
        except ValueError:
            continue
    for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def upgrade() -> None:
    connection = op.get_bind()
    counter = 0

    memos = connection.execute(
        sa.text(
            'SELECT id, category, text, completed, "createdAt", "createdBy",'
            ' "createdByCompanion" FROM "Memo"'
        )
    ).fetchall()
    for memo in memos:
        completed_at = memo.createdAt if memo.completed else None
        if memo.category in WISH_CATEGORIES:
            connection.execute(
                sa.text(
                    'INSERT INTO "Wish"'
                    ' (id, "createdAt", "createdBy", "createdByCompanion",'
                    '  title, category, "completedAt")'
                    " VALUES (:id, :created_at, :created_by, :companion,"
                    "         :title, :category, :completed_at)"
                ),
                {
                    "id": _new_id(connection, counter, "wishmigrated"),
                    "created_at": memo.createdAt,
                    "created_by": memo.createdBy,
                    "companion": memo.createdByCompanion,
                    "title": memo.text,
                    "category": memo.category,
                    "completed_at": completed_at,
                },
            )
        else:
            # 未知 category 也走 Plan：宁可分错类，不能丢数据。
            connection.execute(
                sa.text(
                    'INSERT INTO "Plan"'
                    ' (id, "createdAt", "createdBy", "createdByCompanion",'
                    '  title, "completedAt")'
                    " VALUES (:id, :created_at, :created_by, :companion,"
                    "         :title, :completed_at)"
                ),
                {
                    "id": _new_id(connection, counter, "planmigrated"),
                    "created_at": memo.createdAt,
                    "created_by": memo.createdBy,
                    "companion": memo.createdByCompanion,
                    "title": memo.text,
                    "completed_at": completed_at,
                },
            )
        counter += 1

    reminders = connection.execute(
        sa.text(
            'SELECT id, content, "dueDate", completed, "createdAt", "createdBy",'
            ' "createdByCompanion" FROM "Reminder"'
        )
    ).fetchall()
    for reminder in reminders:
        due_at = _parse_due(reminder.dueDate)
        connection.execute(
            sa.text(
                'INSERT INTO "Plan"'
                ' (id, "createdAt", "createdBy", "createdByCompanion",'
                '  title, note, "dueAt", "completedAt")'
                " VALUES (:id, :created_at, :created_by, :companion,"
                "         :title, :note, :due_at, :completed_at)"
            ),
            {
                "id": _new_id(connection, counter, "planmigrated"),
                "created_at": reminder.createdAt,
                "created_by": reminder.createdBy,
                "companion": reminder.createdByCompanion,
                "title": reminder.content,
                # 解析不出来就把原文留在 note 里，人还能看到本来写的是什么
                "note": None if due_at else f"原提醒时间：{reminder.dueDate}",
                "due_at": due_at,
                "completed_at": reminder.createdAt if reminder.completed else None,
            },
        )
        counter += 1

    op.drop_table("Memo")
    op.drop_table("Reminder")


def downgrade() -> None:
    op.create_table(
        "Memo",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column(
            "createdAt",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "createdBy",
            sa.String(32),
            sa.ForeignKey("User.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "createdByCompanion",
            sa.String(32),
            sa.ForeignKey("Companion.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("completed", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_table(
        "Reminder",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column(
            "createdAt",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "createdBy",
            sa.String(32),
            sa.ForeignKey("User.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "createdByCompanion",
            sa.String(32),
            sa.ForeignKey("Companion.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("dueDate", sa.String(), nullable=False),
        sa.Column("completed", sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    connection = op.get_bind()
    counter = 0
    # 有 dueAt 的回 Reminder，没有的回 Memo(todo)——与 upgrade 的分流反过来。
    for row in connection.execute(
        sa.text(
            'SELECT id, title, "dueAt", "completedAt", "createdAt", "createdBy",'
            ' "createdByCompanion" FROM "Plan"'
        )
    ).fetchall():
        target = "Reminder" if row.dueAt else "Memo"
        if target == "Reminder":
            connection.execute(
                sa.text(
                    'INSERT INTO "Reminder"'
                    ' (id, "createdAt", "createdBy", "createdByCompanion",'
                    '  content, "dueDate", completed)'
                    " VALUES (:id, :created_at, :created_by, :companion,"
                    "         :content, :due, :completed)"
                ),
                {
                    "id": _new_id(connection, counter, "remindrollback"),
                    "created_at": row.createdAt,
                    "created_by": row.createdBy,
                    "companion": row.createdByCompanion,
                    "content": row.title,
                    "due": row.dueAt.isoformat(),
                    "completed": row.completedAt is not None,
                },
            )
        else:
            connection.execute(
                sa.text(
                    'INSERT INTO "Memo"'
                    ' (id, "createdAt", "createdBy", "createdByCompanion",'
                    '  category, text, completed)'
                    " VALUES (:id, :created_at, :created_by, :companion,"
                    "         'todo', :text, :completed)"
                ),
                {
                    "id": _new_id(connection, counter, "memorollback"),
                    "created_at": row.createdAt,
                    "created_by": row.createdBy,
                    "companion": row.createdByCompanion,
                    "text": row.title,
                    "completed": row.completedAt is not None,
                },
            )
        counter += 1

    for row in connection.execute(
        sa.text(
            'SELECT id, title, category, "completedAt", "createdAt", "createdBy",'
            ' "createdByCompanion" FROM "Wish"'
        )
    ).fetchall():
        connection.execute(
            sa.text(
                'INSERT INTO "Memo"'
                ' (id, "createdAt", "createdBy", "createdByCompanion",'
                '  category, text, completed)'
                " VALUES (:id, :created_at, :created_by, :companion,"
                "         :category, :text, :completed)"
            ),
            {
                "id": _new_id(connection, counter, "memorollback"),
                "created_at": row.createdAt,
                "created_by": row.createdBy,
                "companion": row.createdByCompanion,
                "category": row.category,
                "text": row.title,
                "completed": row.completedAt is not None,
            },
        )
        counter += 1
