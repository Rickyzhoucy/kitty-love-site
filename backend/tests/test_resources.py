import pytest


@pytest.mark.parametrize(
    ("path", "payload", "changed"),
    [
        ("memos", {"category": "life", "text": "buy milk"}, {"completed": True}),
        (
            "reminders",
            {"content": "call", "dueDate": "2026-08-01T12:00:00+08:00"},
            {"completed": True},
        ),
        (
            "milestones",
            {"date": "2026-07-28", "title": "day", "description": "memory"},
            {"title": "our day"},
        ),
        ("messages", {"nickname": "Kitty", "content": "hello"}, {"content": "hi"}),
        (
            "timers",
            {"title": "anniversary", "date": "2027-01-01", "type": "countdown"},
            {"description": "days"},
        ),
    ],
)
async def test_resource_crud(authenticated_client, path, payload, changed):
    created = await authenticated_client.post(f"/api/v1/{path}", json=payload)
    assert created.status_code == 201, created.text
    entity_id = created.json()["id"]

    listed = await authenticated_client.get(f"/api/v1/{path}")
    assert [item["id"] for item in listed.json()] == [entity_id]

    updated = await authenticated_client.patch(
        f"/api/v1/{path}/{entity_id}",
        json=changed,
    )
    assert updated.status_code == 200
    for key, value in changed.items():
        assert updated.json()[key] == value

    assert (await authenticated_client.delete(f"/api/v1/{path}/{entity_id}")).status_code == 204
    assert (await authenticated_client.get(f"/api/v1/{path}/{entity_id}")).status_code == 404


async def test_crud_requires_authentication(client):
    assert (await client.get("/api/v1/memos")).status_code == 401
