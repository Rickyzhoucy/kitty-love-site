import pytest

from app.migration_bootstrap import PRISMA_BASELINE_TABLES, bootstrap_action


def test_empty_database_runs_normal_upgrade():
    assert bootstrap_action(set()) == "upgrade"


def test_existing_alembic_database_runs_normal_upgrade():
    assert bootstrap_action({"alembic_version", "User"}) == "upgrade"


def test_prisma_database_is_stamped():
    tables = {"_prisma_migrations", *PRISMA_BASELINE_TABLES}
    assert bootstrap_action(tables) == "stamp"


def test_unknown_nonempty_database_is_rejected():
    with pytest.raises(RuntimeError, match="拒绝自动 stamp"):
        bootstrap_action({"unrelated_table"})
