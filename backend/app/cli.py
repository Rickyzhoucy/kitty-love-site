import argparse
import asyncio

from sqlalchemy import func, select

from app.auth import hash_password
from app.db import session_factory
from app.models import User


async def create_user(username: str, display_name: str, password: str) -> None:
    async with session_factory() as db:
        exists = await db.scalar(select(User.id).where(User.username == username))
        if exists:
            raise SystemExit(f"用户 {username} 已存在")
        user_count = (await db.scalar(select(func.count(User.id)))) or 0
        if user_count >= 2:
            raise SystemExit("该私人服务最多创建两个用户")
        db.add(
            User(
                username=username,
                display_name=display_name,
                password_hash=hash_password(password),
            )
        )
        await db.commit()


def main() -> None:
    parser = argparse.ArgumentParser(description="Kitty Love backend administration")
    subparsers = parser.add_subparsers(dest="command", required=True)
    create = subparsers.add_parser("create-user")
    create.add_argument("username")
    create.add_argument("display_name")
    create.add_argument("--password", required=True)
    args = parser.parse_args()
    if args.command == "create-user":
        asyncio.run(create_user(args.username, args.display_name, args.password))


if __name__ == "__main__":
    main()
