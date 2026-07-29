import subprocess

import psycopg

from app.config import get_settings

PRISMA_BASELINE_TABLES = {
    "Admin",
    "AuthAttempt",
    "EventTimer",
    "Memo",
    "Message",
    "Milestone",
    "Pet",
    "Photo",
    "Reminder",
    "SecurityQuestion",
    "SiteConfig",
    "SiteConfigHistory",
}
BASELINE_REVISION = "20260728_0001"


def bootstrap_action(tables: set[str]) -> str:
    if "alembic_version" in tables or not tables:
        return "upgrade"
    if "_prisma_migrations" in tables and PRISMA_BASELINE_TABLES.issubset(tables):
        return "stamp"
    unknown = ", ".join(sorted(tables))
    raise RuntimeError(
        "数据库已有表但无法识别为受支持的 Prisma 基线，拒绝自动 stamp："
        f"{unknown}"
    )


def public_tables(conninfo: str) -> set[str]:
    with psycopg.connect(conninfo) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT tablename
                FROM pg_catalog.pg_tables
                WHERE schemaname = 'public'
                """
            )
            return {row[0] for row in cursor.fetchall()}


def main() -> None:
    settings = get_settings()
    action = bootstrap_action(public_tables(settings.procrastinate_database_url))
    if action == "stamp":
        subprocess.run(
            ["alembic", "stamp", BASELINE_REVISION],
            check=True,
        )
        print(f"Detected Prisma baseline; stamped Alembic at {BASELINE_REVISION}.")
    else:
        print("Alembic bootstrap check passed; normal upgrade will continue.")


if __name__ == "__main__":
    main()
