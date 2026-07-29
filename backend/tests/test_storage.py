from dataclasses import dataclass

from app.storage import get_storage


@dataclass
class Stat:
    size: int


class FakeStorage:
    sha = "a" * 64

    def __init__(self) -> None:
        self.get_headers: list[dict[str, str] | None] = []

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
    }
