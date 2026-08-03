from dataclasses import dataclass

from app.models import Attachment, Photo
from app.storage import get_storage


@dataclass
class Stat:
    size: int


class FakeStorage:
    sha = "a" * 64

    def __init__(self) -> None:
        self.get_headers: list[dict[str, str] | None] = []
        self.payload = b"thumbnail-webp"

    def build_object_key(self, owner_id: str, filename: str) -> str:
        return f"{owner_id}/fixed/{filename}"

    async def presign_put(self, bucket: str, object_key: str) -> str:
        return f"https://upload.invalid/{bucket}/{object_key}"

    async def presign_get(
        self,
        bucket: str,
        object_key: str,
        response_headers: dict[str, str] | None = None,
    ) -> str:
        self.get_headers.append(response_headers)
        return f"https://download.invalid/{bucket}/{object_key}"

    async def stat(self, bucket: str, object_key: str) -> Stat:
        return Stat(size=12)

    async def sha256(self, bucket: str, object_key: str) -> str:
        return self.sha

    async def get_bytes(self, bucket: str, object_key: str) -> bytes:
        return self.payload


class FakeJobQueue:
    def __init__(self) -> None:
        self.jobs: list[tuple[str, dict, str]] = []

    async def enqueue(
        self,
        task_name: str,
        payload: dict,
        *,
        idempotency_key: str,
    ) -> None:
        self.jobs.append((task_name, payload, idempotency_key))


async def test_presign_and_complete_upload(authenticated_client):
    app = authenticated_client._transport.app
    app.dependency_overrides[get_storage] = lambda: FakeStorage()
    queue = FakeJobQueue()
    app.state.job_queue = queue
    sha = "a" * 64
    request = {
        "filename": "kitty.jpg",
        "contentType": "image/jpeg",
        "size": 12,
        "sha256": sha,
    }
    presigned = await authenticated_client.post("/api/v1/attachments/presign", json=request)
    assert presigned.status_code == 200
    body = presigned.json()
    assert body["objectKey"].endswith("/fixed/kitty.jpg")

    completed = await authenticated_client.post(
        "/api/v1/attachments/complete",
        json={
            **request,
            "bucket": body["bucket"],
            "objectKey": body["objectKey"],
        },
    )
    assert completed.status_code == 201, completed.text
    attachment = completed.json()
    assert attachment["downloadUrl"].endswith(f"/{attachment['id']}/content")
    assert queue.jobs == [
        (
            "attachment.process",
            {"attachment_id": attachment["id"]},
            attachment["id"],
        )
    ]

    duplicate = await authenticated_client.post(
        "/api/v1/attachments/complete",
        json={
            **request,
            "bucket": body["bucket"],
            "objectKey": body["objectKey"],
        },
    )
    assert duplicate.status_code == 201
    assert duplicate.json()["id"] == attachment["id"]

    photo = await authenticated_client.post(
        "/api/v1/photos",
        json={"attachmentId": attachment["id"], "caption": "together"},
    )
    assert photo.status_code == 201, photo.text
    assert photo.json()["url"].endswith(f"/{attachment['id']}/content")
    assert photo.json()["thumbnailUrl"].endswith(
        f"/photos/{photo.json()['id']}/thumbnail?v=1"
    )


async def test_complete_rejects_wrong_digest(authenticated_client):
    storage = FakeStorage()
    storage.sha = "b" * 64
    app = authenticated_client._transport.app
    app.dependency_overrides[get_storage] = lambda: storage
    app.state.job_queue = FakeJobQueue()
    presigned = await authenticated_client.post(
        "/api/v1/attachments/presign",
        json={
            "filename": "kitty.jpg",
            "contentType": "image/jpeg",
            "size": 12,
            "sha256": "a" * 64,
        },
    )
    body = presigned.json()
    completed = await authenticated_client.post(
        "/api/v1/attachments/complete",
        json={
            "filename": "kitty.jpg",
            "contentType": "image/jpeg",
            "size": 12,
            "sha256": "a" * 64,
            "bucket": body["bucket"],
            "objectKey": body["objectKey"],
        },
    )
    assert completed.status_code == 409


async def test_complete_infers_local_file_type_on_server(authenticated_client):
    """Tauri 上传不猜 MIME，但本机 PDF 仍必须进服务器文档与预览链。"""
    app = authenticated_client._transport.app
    app.dependency_overrides[get_storage] = lambda: FakeStorage()
    app.state.job_queue = FakeJobQueue()
    request = {
        "filename": "local-report.pdf",
        "contentType": "application/octet-stream",
        "size": 12,
        "sha256": "a" * 64,
    }
    presigned = await authenticated_client.post("/api/v1/attachments/presign", json=request)
    completed = await authenticated_client.post(
        "/api/v1/attachments/complete",
        json={
            **request,
            "bucket": presigned.json()["bucket"],
            "objectKey": presigned.json()["objectKey"],
        },
    )
    assert completed.status_code == 201, completed.text
    assert completed.json()["contentType"] == "application/pdf"
    assert completed.json()["previewUrl"].endswith("/preview")


async def test_attachment_download_forces_unsafe_types_to_download(
    authenticated_client,
):
    storage = FakeStorage()
    app = authenticated_client._transport.app
    app.dependency_overrides[get_storage] = lambda: storage
    app.state.job_queue = FakeJobQueue()
    request = {
        "filename": 'unsafe"\r\npage.svg',
        "contentType": "image/svg+xml",
        "size": 12,
        "sha256": "a" * 64,
    }
    presigned = await authenticated_client.post(
        "/api/v1/attachments/presign",
        json=request,
    )
    completed = await authenticated_client.post(
        "/api/v1/attachments/complete",
        json={
            **request,
            "bucket": presigned.json()["bucket"],
            "objectKey": presigned.json()["objectKey"],
        },
    )

    response = await authenticated_client.get(
        completed.json()["downloadUrl"],
        follow_redirects=False,
    )

    assert response.status_code == 307
    assert storage.get_headers[-1] == {
        "response-content-disposition": (
            "attachment; filename=\"unsafe'page.svg\""
        ),
        "response-content-type": "application/octet-stream",
        "response-cache-control": "private, max-age=86400, immutable",
    }
    assert response.headers["cache-control"] == "private, max-age=600"


async def test_photo_thumbnail_is_private_versioned_and_revalidates(
    authenticated_client,
    session_maker,
):
    storage = FakeStorage()
    app = authenticated_client._transport.app
    app.dependency_overrides[get_storage] = lambda: storage
    app.state.job_queue = FakeJobQueue()
    request = {
        "filename": "cached.jpg",
        "contentType": "image/jpeg",
        "size": 12,
        "sha256": "a" * 64,
    }
    presigned = await authenticated_client.post("/api/v1/attachments/presign", json=request)
    completed = await authenticated_client.post(
        "/api/v1/attachments/complete",
        json={
            **request,
            "bucket": presigned.json()["bucket"],
            "objectKey": presigned.json()["objectKey"],
        },
    )
    attachment_id = completed.json()["id"]
    photo = await authenticated_client.post(
        "/api/v1/photos",
        json={"attachmentId": attachment_id, "caption": "cached"},
    )
    thumbnail_url = photo.json()["thumbnailUrl"]

    async with session_maker() as db:
        attachment = await db.get(Attachment, attachment_id)
        assert attachment is not None
        attachment.derived_bucket = "derived-assets"
        attachment.thumbnail_key = f"owner/{attachment.id}/thumbnail.webp"
        await db.commit()

    first = await authenticated_client.get(thumbnail_url)
    assert first.status_code == 200
    assert first.content == storage.payload
    assert first.headers["content-type"] == "image/webp"
    assert first.headers["cache-control"] == "private, max-age=86400, immutable"
    assert first.headers["etag"].startswith('"')

    cached = await authenticated_client.get(
        thumbnail_url,
        headers={"If-None-Match": first.headers["etag"]},
    )
    assert cached.status_code == 304
    assert cached.content == b""


async def test_legacy_photo_uses_the_same_thumbnail_contract(
    authenticated_client,
    session_maker,
):
    storage = FakeStorage()
    app = authenticated_client._transport.app
    app.dependency_overrides[get_storage] = lambda: storage
    async with session_maker() as db:
        legacy = Photo(legacy_url="/uploads/old.jpg", caption="old")
        db.add(legacy)
        await db.commit()
        await db.refresh(legacy)
        photo_id = legacy.id

    listed = await authenticated_client.get("/api/v1/photos")
    body = next(item for item in listed.json() if item["id"] == photo_id)
    assert body["url"] == "/uploads/old.jpg"
    assert body["thumbnailUrl"] == f"/api/v1/photos/{photo_id}/thumbnail?v=1"

    thumbnail = await authenticated_client.get(body["thumbnailUrl"])
    assert thumbnail.status_code == 200
    assert thumbnail.content == storage.payload
