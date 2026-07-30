import pytest


@pytest.mark.parametrize(
    ("path", "payload", "changed"),
    [
        ("plans", {"title": "买牛奶"}, {"title": "买两盒牛奶"}),
        (
            "plans",
            {"title": "打电话", "dueAt": "2026-08-01T12:00:00+08:00"},
            {"note": "晚饭后"},
        ),
        (
            "wishes",
            {"title": "草莓蛋糕", "category": "to-eat"},
            {"category": "to-go"},
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
    assert (await client.get("/api/v1/plans")).status_code == 401


async def test_completed_at_records_when_not_just_whether(authenticated_client):
    """`completedAt` 取代旧的 `completed: bool`。

    心愿页要显示「我们在某月某日做到了这件事」，布尔值给不出这个信息。
    这里比较的是**时刻**而不是字符串——SQLite 不保留时区偏移，
    Postgres 的 timestamptz 会归一化到 UTC，两边的字面量本来就不同。
    """
    from datetime import datetime

    created = await authenticated_client.post(
        "/api/v1/wishes",
        json={"title": "一起看日出", "category": "to-go"},
    )
    assert created.json()["completedAt"] is None

    done_at = "2026-08-01T12:00:00+08:00"
    updated = await authenticated_client.patch(
        f"/api/v1/wishes/{created.json()['id']}",
        json={"completedAt": done_at},
    )
    assert updated.status_code == 200
    stored = datetime.fromisoformat(updated.json()["completedAt"])
    expected = datetime.fromisoformat(done_at)
    # 两边都带时区才谈得上比较绝对时刻；SQLite 丢了偏移就只比较墙上时间。
    if stored.tzinfo and expected.tzinfo:
        assert stored == expected
    else:
        assert stored.replace(tzinfo=None) == expected.replace(tzinfo=None)
