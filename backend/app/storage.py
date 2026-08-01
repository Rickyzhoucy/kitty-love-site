import hashlib
from datetime import timedelta
from io import BytesIO
from pathlib import PurePath

import anyio
from minio import Minio

from app.config import Settings, get_settings
from app.ids import new_id


class ObjectStorage:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()
        self.client = Minio(
            self.settings.minio_endpoint,
            access_key=self.settings.minio_access_key,
            secret_key=self.settings.minio_secret_key,
            secure=self.settings.minio_secure,
        )
        # 签名用的客户端指向**浏览器能访问到的**地址，协议也单独一个开关。
        # 见 config 里 minio_public_secure 的注释。
        self.presign_client = Minio(
            self.settings.minio_public_endpoint,
            access_key=self.settings.minio_access_key,
            secret_key=self.settings.minio_secret_key,
            secure=self.settings.minio_public_secure,
            region=self.settings.minio_region,
        )

    def build_object_key(self, owner_id: str, filename: str) -> str:
        safe_name = PurePath(filename.replace("\\", "/")).name
        return f"{owner_id}/{new_id()}/{safe_name}"

    async def presign_put(self, bucket: str, object_key: str) -> str:
        return await anyio.to_thread.run_sync(
            lambda: self.presign_client.presigned_put_object(
                bucket,
                object_key,
                expires=timedelta(seconds=self.settings.minio_presign_seconds),
            )
        )

    async def presign_get(
        self,
        bucket: str,
        object_key: str,
        response_headers: dict[str, str] | None = None,
    ) -> str:
        return await anyio.to_thread.run_sync(
            lambda: self.presign_client.presigned_get_object(
                bucket,
                object_key,
                expires=timedelta(seconds=self.settings.minio_presign_seconds),
                response_headers=response_headers,
            )
        )

    async def stat(self, bucket: str, object_key: str):
        return await anyio.to_thread.run_sync(lambda: self.client.stat_object(bucket, object_key))

    async def put_bytes(
        self,
        bucket: str,
        object_key: str,
        content: bytes,
        content_type: str = "application/octet-stream",
    ) -> None:
        def upload() -> None:
            self.client.put_object(
                bucket,
                object_key,
                BytesIO(content),
                len(content),
                content_type=content_type,
            )

        await anyio.to_thread.run_sync(upload)

    async def get_bytes(self, bucket: str, object_key: str) -> bytes:
        def download() -> bytes:
            response = self.client.get_object(bucket, object_key)
            try:
                return response.read()
            finally:
                response.close()
                response.release_conn()

        return await anyio.to_thread.run_sync(download)

    async def sha256(self, bucket: str, object_key: str) -> str:
        def digest() -> str:
            response = self.client.get_object(bucket, object_key)
            checksum = hashlib.sha256()
            try:
                while chunk := response.read(1024 * 1024):
                    checksum.update(chunk)
            finally:
                response.close()
                response.release_conn()
            return checksum.hexdigest()

        return await anyio.to_thread.run_sync(digest)


def get_storage() -> ObjectStorage:
    return ObjectStorage()
