from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Attachment, OutboxEvent, Photo
from app.schemas import PhotoCreate, PhotoRead, PhotoUpdate

# 相册允许展示的图片类型（与附件内联白名单一致；SVG 因 XSS 风险不放行）
ALLOWED_PHOTO_TYPES = frozenset({"image/gif", "image/jpeg", "image/png", "image/webp"})

# 缩略图 URL 带显式版本。缩略图响应可以放心标 immutable；以后调整尺寸、质量或
# 旋转算法时只要升这个版本，浏览器会请求新 URL，不需要让用户手工清缓存。
PHOTO_THUMBNAIL_VERSION = 1


def photo_thumbnail_url(photo_id: str) -> str:
    return f"/api/v1/photos/{photo_id}/thumbnail?v={PHOTO_THUMBNAIL_VERSION}"


def legacy_photo_thumbnail_key(photo_id: str) -> str:
    return f"legacy-photo/{photo_id}/thumbnail-v{PHOTO_THUMBNAIL_VERSION}.webp"


class PhotoService:
    @staticmethod
    def response(photo: Photo) -> PhotoRead:
        return PhotoRead(
            id=photo.id,
            created_at=photo.created_at,
            attachment_id=photo.attachment_id or "",
            caption=photo.caption,
            date=photo.date,
            url=(
                f"/api/v1/attachments/{photo.attachment_id}/content"
                if photo.attachment_id
                else photo.legacy_url or ""
            ),
            thumbnail_url=photo_thumbnail_url(photo.id),
        )

    async def list(self, db: AsyncSession, limit: int = 500) -> list[PhotoRead]:
        rows = list(
            await db.scalars(
                select(Photo)
                .order_by(Photo.created_at.desc())
                .limit(max(1, min(limit, 500)))
            )
        )
        return [self.response(photo) for photo in rows]

    async def create(
        self, db: AsyncSession, owner_id: str, data: PhotoCreate
    ) -> PhotoRead:
        attachment = await db.get(Attachment, data.attachment_id)
        if (
            attachment is None
            or attachment.owner_id != owner_id
            or attachment.status != "ready"
        ):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "附件不存在")
        if attachment.content_type.lower() not in ALLOWED_PHOTO_TYPES:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "仅支持 JPG/PNG/WebP/GIF 图片",
            )
        existing = await db.scalar(
            select(Photo).where(Photo.attachment_id == attachment.id)
        )
        if existing is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "附件已加入相册")
        photo = Photo(
            attachment_id=attachment.id,
            caption=data.caption,
            date=data.date,
            created_by=owner_id,
        )
        db.add(photo)
        await db.flush()
        await self._event(db, photo.id, "created")
        await db.commit()
        await db.refresh(photo)
        return self.response(photo)

    async def update(
        self, db: AsyncSession, photo_id: str, data: PhotoUpdate
    ) -> PhotoRead:
        photo = await self._get(db, photo_id)
        for field, value in data.model_dump(exclude_unset=True).items():
            setattr(photo, field, value)
        await self._event(db, photo.id, "updated")
        await db.commit()
        await db.refresh(photo)
        return self.response(photo)

    async def delete(self, db: AsyncSession, photo_id: str) -> None:
        photo = await self._get(db, photo_id)
        await db.delete(photo)
        await self._event(db, photo_id, "deleted")
        await db.commit()

    @staticmethod
    async def _get(db: AsyncSession, photo_id: str) -> Photo:
        photo = await db.get(Photo, photo_id)
        if photo is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "照片不存在")
        return photo

    @staticmethod
    async def _event(db: AsyncSession, photo_id: str, action: str) -> None:
        db.add(
            OutboxEvent(
                topic="resource.changed",
                aggregate_type="photo",
                aggregate_id=photo_id,
                payload={"resource": "photo", "action": action, "id": photo_id},
            )
        )
        await db.flush()
