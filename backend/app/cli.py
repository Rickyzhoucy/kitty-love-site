import argparse
import asyncio
import hashlib
import os
from pathlib import Path
from urllib.parse import unquote, urlsplit

from sqlalchemy import func, select

from app.attachment_processing import thumbnail_webp
from app.auth import hash_password
from app.config import get_settings
from app.db import session_factory
from app.models import Attachment, Photo, User
from app.photo_service import legacy_photo_thumbnail_key
from app.storage import ObjectStorage

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


async def create_admin(username: str, password: str) -> None:
    """建一个后台管理员。**与主站账号是两套东西**（见 app/admin_auth.py）。

    幂等：同名已存在就只重设密码——这条命令同时也是「后台密码忘了」的出路，
    而那时候你不希望它报一句「已存在」就退出。
    """
    from app.admin_auth import set_admin_password
    from app.models import Admin

    async with session_factory() as db:
        admin = await db.scalar(select(Admin).where(Admin.username == username))
        if admin is None:
            admin = Admin(username=username, password="", status="active")
            db.add(admin)
            action = "已创建"
        else:
            action = "已重设密码"
        set_admin_password(admin, password)
        await db.commit()
    print(f"后台账号 {username} {action}")


def legacy_photo_path(legacy_root: Path, legacy_url: str) -> Path:
    """把旧 `/uploads/...` URL 安全地限定在只读历史目录内。"""
    url_path = unquote(urlsplit(legacy_url).path)
    prefix = "/uploads/"
    if not url_path.startswith(prefix):
        raise ValueError("旧照片 URL 不在 /uploads/ 下")
    root = legacy_root.resolve()
    candidate = (root / url_path.removeprefix(prefix)).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as error:
        raise ValueError("旧照片 URL 越过历史目录") from error
    if not candidate.is_file():
        raise FileNotFoundError("旧照片原图不存在")
    return candidate


async def backfill_photo_thumbnails(legacy_root: Path) -> None:
    """为全部相册照片重建 v1 缩略图；幂等且绝不修改原图。"""
    settings = get_settings()
    storage = ObjectStorage(settings)
    written = 0
    failed = 0
    async with session_factory() as db:
        photos = list(await db.scalars(select(Photo).order_by(Photo.created_at)))
        for photo in photos:
            try:
                attachment_to_update: Attachment | None = None
                if photo.attachment_id:
                    attachment = await db.get(Attachment, photo.attachment_id)
                    if attachment is None:
                        raise ValueError("照片引用的附件不存在")
                    content = await storage.get_bytes(
                        attachment.bucket,
                        attachment.object_key,
                    )
                    content_type = attachment.content_type
                    bucket = attachment.derived_bucket or settings.minio_derived_bucket
                    object_key = attachment.thumbnail_key or (
                        f"{attachment.owner_id}/{attachment.id}/thumbnail.webp"
                    )
                    attachment_to_update = attachment
                else:
                    if not photo.legacy_url:
                        raise ValueError("旧照片没有原图 URL")
                    source = legacy_photo_path(legacy_root, photo.legacy_url)
                    content = await asyncio.to_thread(source.read_bytes)
                    content_type = "image/legacy"
                    bucket = settings.minio_derived_bucket
                    object_key = legacy_photo_thumbnail_key(photo.id)

                thumbnail = thumbnail_webp(content, content_type)
                if thumbnail is None:
                    raise ValueError("不是支持的图片格式")
                await storage.put_bytes(bucket, object_key, thumbnail, "image/webp")
                stored_sha256 = await storage.sha256(bucket, object_key)
                expected_sha256 = hashlib.sha256(thumbnail).hexdigest()
                if stored_sha256.lower() != expected_sha256:
                    raise ValueError("写入后的缩略图摘要不一致")
                if attachment_to_update is not None:
                    attachment_to_update.derived_bucket = bucket
                    attachment_to_update.thumbnail_key = object_key
                written += 1
                print(f"photo-thumbnail: ready photo_id={photo.id} bytes={len(thumbnail)}")
            except Exception as error:
                failed += 1
                print(f"photo-thumbnail: failed photo_id={photo.id} error={error}")
        await db.commit()

    print(
        f"photo-thumbnail: complete total={len(photos)} ready={written} failed={failed}"
    )
    if failed:
        raise SystemExit(1)


def main() -> None:
    parser = argparse.ArgumentParser(description="Kitty Love backend administration")
    subparsers = parser.add_subparsers(dest="command", required=True)
    create = subparsers.add_parser("create-user")
    create.add_argument("username")
    create.add_argument("display_name")
    create.add_argument("--password", required=True)
    subparsers.add_parser("seed-users", help="补齐两个开发用账号（幂等）")
    admin = subparsers.add_parser(
        "create-admin", help="建后台管理员，或重设它的密码（幂等）"
    )
    admin.add_argument("username")
    admin.add_argument("--password", required=True)
    thumbnails = subparsers.add_parser(
        "backfill-photo-thumbnails",
        help="重建新旧相册照片的 512px WebP 缩略图（不修改原图）",
    )
    thumbnails.add_argument(
        "--legacy-root",
        type=Path,
        default=Path(os.getenv("LEGACY_UPLOADS_ROOT", "/legacy-uploads")),
    )
    args = parser.parse_args()
    if args.command == "create-user":
        asyncio.run(create_user(args.username, args.display_name, args.password))
    elif args.command == "seed-users":
        asyncio.run(seed_users())
    elif args.command == "create-admin":
        asyncio.run(create_admin(args.username, args.password))
    elif args.command == "backfill-photo-thumbnails":
        asyncio.run(backfill_photo_thumbnails(args.legacy_root))


if __name__ == "__main__":
    main()
