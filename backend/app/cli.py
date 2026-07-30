import argparse
import asyncio
import os

from sqlalchemy import func, select

from app.auth import hash_password
from app.db import session_factory
from app.models import User

#: 这个站就是给两个人用的，不是可配置项。
MAX_USERS = 2


async def create_user(username: str, display_name: str, password: str) -> None:
    async with session_factory() as db:
        exists = await db.scalar(select(User.id).where(User.username == username))
        if exists:
            raise SystemExit(f"用户 {username} 已存在")
        user_count = (await db.scalar(select(func.count(User.id)))) or 0
        if user_count >= MAX_USERS:
            raise SystemExit("该私人服务最多创建两个用户")
        db.add(
            User(
                username=username,
                display_name=display_name,
                password_hash=hash_password(password),
            )
        )
        await db.commit()


async def seed_users() -> None:
    """把两个账号补齐。

    幂等：已存在的跳过，**不改密码**——重跑 seed 不该把你改过的密码冲掉。

    「对方」在这个站里的定义是「另一个 enabled 用户」（见
    docs/couple-site-feature-plan.md §0.3）。聊天、每日一问这些双人功能的
    前置条件就是这两条记录存在，所以 seed 是它们的开工前提。

    只在开发环境自动跑（compose 的 migrate 步骤按 APP_ENV 判断），
    生产靠 `create-user` 手工建，避免默认密码流到线上。
    """
    defaults = [
        (
            os.getenv("SEED_USER_A", "ricky"),
            os.getenv("SEED_USER_A_NAME", "Ricky"),
            os.getenv("SEED_USER_A_PASSWORD", "kitty-dev-password"),
        ),
        (
            os.getenv("SEED_USER_B", "honey"),
            os.getenv("SEED_USER_B_NAME", "宝贝"),
            os.getenv("SEED_USER_B_PASSWORD", "kitty-dev-password"),
        ),
    ]
    async with session_factory() as db:
        created: list[str] = []
        for username, display_name, password in defaults:
            if await db.scalar(select(User.id).where(User.username == username)):
                continue
            if ((await db.scalar(select(func.count(User.id)))) or 0) >= MAX_USERS:
                break
            db.add(
                User(
                    username=username,
                    display_name=display_name,
                    password_hash=hash_password(password),
                )
            )
            await db.flush()
            created.append(username)
        await db.commit()
    print(f"seed-users: 新建 {created if created else '（无，都已存在）'}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Kitty Love backend administration")
    subparsers = parser.add_subparsers(dest="command", required=True)
    create = subparsers.add_parser("create-user")
    create.add_argument("username")
    create.add_argument("display_name")
    create.add_argument("--password", required=True)
    subparsers.add_parser("seed-users", help="补齐两个开发用账号（幂等）")
    args = parser.parse_args()
    if args.command == "create-user":
        asyncio.run(create_user(args.username, args.display_name, args.password))
    elif args.command == "seed-users":
        asyncio.run(seed_users())


if __name__ == "__main__":
    main()
