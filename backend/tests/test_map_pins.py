"""恋爱地图（计划文档 §2.5）。

普通 CRUD，走的是 `crud_router` 那个工厂，所以不重复测通用行为。这里只测这个
资源特有的两件事：**坐标存进去什么样取出来就什么样**（GCJ-02，前后端都不转换，
一转就迟早漏一处），以及经纬度的取值范围校验。
"""

import pytest


async def test_pin_roundtrips_coordinates_exactly(authenticated_client):
    """高德原生就是 GCJ-02，所以这里不做任何转换——存 116.397 就该读回 116.397。

    如果哪天有人在某一侧偷偷加了 WGS-84 转换，这条会立刻红。
    """
    created = await authenticated_client.post(
        "/api/v1/map-pins",
        json={
            "title": "第一次见面的咖啡馆",
            "lat": 39.908823,
            "lng": 116.397470,
            "note": "那天下雨",
            "date": "2025-11-30",
        },
    )
    assert created.status_code == 201
    pin = created.json()
    assert pin["lat"] == 39.908823
    assert pin["lng"] == 116.397470

    listed = await authenticated_client.get("/api/v1/map-pins")
    assert listed.status_code == 200
    assert listed.json()[0]["lat"] == 39.908823


async def test_pin_carries_photos_and_note(authenticated_client):
    created = await authenticated_client.post(
        "/api/v1/map-pins",
        json={
            "title": "海边",
            "lat": 22.5,
            "lng": 114.0,
            "photoIds": ["att1", "att2"],
        },
    )
    assert created.status_code == 201
    assert created.json()["photoIds"] == ["att1", "att2"]


async def test_pin_defaults_are_empty_not_null(authenticated_client):
    created = await authenticated_client.post(
        "/api/v1/map-pins",
        json={"title": "只有标题", "lat": 0, "lng": 0},
    )
    assert created.status_code == 201
    pin = created.json()
    assert pin["photoIds"] == []
    assert pin["note"] is None
    assert pin["date"] is None


@pytest.mark.parametrize(
    ("lat", "lng"),
    [(91, 0), (-91, 0), (0, 181), (0, -181)],
)
async def test_pin_rejects_impossible_coordinates(authenticated_client, lat, lng):
    response = await authenticated_client.post(
        "/api/v1/map-pins",
        json={"title": "不可能的地方", "lat": lat, "lng": lng},
    )
    assert response.status_code == 422


async def test_pin_can_be_updated_and_deleted(authenticated_client):
    created = await authenticated_client.post(
        "/api/v1/map-pins",
        json={"title": "写错了", "lat": 31.2, "lng": 121.4},
    )
    pin_id = created.json()["id"]

    patched = await authenticated_client.patch(
        f"/api/v1/map-pins/{pin_id}", json={"title": "改对了"}
    )
    assert patched.status_code == 200
    assert patched.json()["title"] == "改对了"
    # 没传的字段不该被清掉
    assert patched.json()["lat"] == 31.2

    deleted = await authenticated_client.delete(f"/api/v1/map-pins/{pin_id}")
    assert deleted.status_code == 204

    listed = await authenticated_client.get("/api/v1/map-pins")
    assert listed.json() == []


async def test_pin_requires_authentication(client):
    response = await client.get("/api/v1/map-pins")
    assert response.status_code == 401
