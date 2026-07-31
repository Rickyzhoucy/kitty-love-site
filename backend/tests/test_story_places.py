"""故事条目上的地点（原「恋爱地图」，计划文档 §2.5）。

`MapPin` 这张表已经并进 `Milestone`——同一件事的两种看法，分成两处的代价是
一次旅行要记两遍。所以这里测的是**故事条目的地点字段**，而不是一个独立资源。

普通 CRUD 走的是 `crud_router` 工厂，不重复测通用行为；这里只测地点特有的两
件事：坐标原样进出（GCJ-02，前后端都不转换），以及地点是**可选的**。
"""

import pytest


async def test_a_story_can_carry_coordinates(authenticated_client):
    """高德原生就是 GCJ-02，所以不做任何转换——存 116.397 就该读回 116.397。

    哪天有人在某一侧偷偷加了 WGS-84 转换，这条会立刻红。
    """
    created = await authenticated_client.post(
        "/api/v1/milestones",
        json={
            "date": "2025-11-30",
            "title": "第一次见面的咖啡馆",
            "description": "那天下雨",
            "lat": 39.908823,
            "lng": 116.397470,
        },
    )
    assert created.status_code == 201
    story = created.json()
    assert story["lat"] == 39.908823
    assert story["lng"] == 116.397470

    listed = await authenticated_client.get("/api/v1/milestones")
    assert listed.status_code == 200
    assert listed.json()[0]["lat"] == 39.908823


async def test_a_story_without_a_place_is_normal(authenticated_client):
    """**这是合并的全部意义**：不是每件值得记的事都发生在某个地方。

    合并前「故事」和「地图」是两张表，没地点的事进不了地图、有地点的事在故事
    线上又看不到坐标。现在两个视图看的是同一批数据。
    """
    created = await authenticated_client.post(
        "/api/v1/milestones",
        json={"date": "2026-01-01", "title": "决定养一只宠物", "description": ""},
    )
    assert created.status_code == 201
    story = created.json()
    assert story["lat"] is None
    assert story["lng"] is None
    assert story["photoIds"] == []


async def test_a_story_can_carry_photos(authenticated_client):
    created = await authenticated_client.post(
        "/api/v1/milestones",
        json={
            "date": "2026-02-14",
            "title": "海边",
            "description": "",
            "lat": 22.5,
            "lng": 114.0,
            "photoIds": ["att1", "att2"],
        },
    )
    assert created.status_code == 201
    assert created.json()["photoIds"] == ["att1", "att2"]


@pytest.mark.parametrize(
    ("lat", "lng"),
    [(91, 0), (-91, 0), (0, 181), (0, -181)],
)
async def test_impossible_coordinates_are_rejected(authenticated_client, lat, lng):
    response = await authenticated_client.post(
        "/api/v1/milestones",
        json={
            "date": "2026-01-01",
            "title": "不可能的地方",
            "description": "",
            "lat": lat,
            "lng": lng,
        },
    )
    assert response.status_code == 422


async def test_a_place_can_be_added_to_an_existing_story(authenticated_client):
    """先记下一件事、后来才想起在哪儿——这是合并之后才可能的操作。"""
    created = await authenticated_client.post(
        "/api/v1/milestones",
        json={"date": "2026-03-01", "title": "那顿火锅", "description": ""},
    )
    story_id = created.json()["id"]

    patched = await authenticated_client.patch(
        f"/api/v1/milestones/{story_id}",
        json={"lat": 30.66, "lng": 104.06},
    )
    assert patched.status_code == 200
    assert patched.json()["lat"] == 30.66
    # 没传的字段不该被清掉
    assert patched.json()["title"] == "那顿火锅"


async def test_milestones_require_authentication(client):
    response = await client.get("/api/v1/milestones")
    assert response.status_code == 401
