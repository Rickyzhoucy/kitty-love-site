async def test_browser_login_sets_http_only_cookie_and_me(client):
    response = await client.post(
        "/api/v1/auth/login",
        json={"username": "daniela", "password": "secret-password"},
    )
    assert response.status_code == 200
    assert response.json()["token"] is None
    assert "HttpOnly" in response.headers["set-cookie"]

    me = await client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json() == {
        "id": me.json()["id"],
        "username": "daniela",
        "displayName": "Daniela",
    }


async def test_device_login_returns_bearer_token(client):
    response = await client.post(
        "/api/v1/auth/login",
        json={
            "username": "daniela",
            "password": "secret-password",
            "client": "device",
            "deviceName": "Windows",
        },
    )
    token = response.json()["token"]
    assert token

    me = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert me.status_code == 200


async def test_sessions_can_be_listed_and_revoked(client):
    first = await client.post(
        "/api/v1/auth/login",
        json={
            "username": "daniela",
            "password": "secret-password",
            "client": "device",
            "deviceName": "Windows",
        },
    )
    second = await client.post(
        "/api/v1/auth/login",
        json={
            "username": "daniela",
            "password": "secret-password",
            "client": "device",
            "deviceName": "Mac",
        },
    )
    first_token = first.json()["token"]
    second_token = second.json()["token"]
    sessions = await client.get(
        "/api/v1/auth/sessions",
        headers={"Authorization": f"Bearer {first_token}"},
    )
    mac_session = next(
        item for item in sessions.json() if item["deviceName"] == "Mac"
    )

    revoked = await client.delete(
        f"/api/v1/auth/sessions/{mac_session['id']}",
        headers={"Authorization": f"Bearer {first_token}"},
    )

    assert sessions.status_code == 200
    assert revoked.status_code == 204
    assert (
        await client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {second_token}"},
        )
    ).status_code == 401


async def test_logout_revokes_session(authenticated_client):
    assert (await authenticated_client.post("/api/v1/auth/logout")).status_code == 204
    assert (await authenticated_client.get("/api/v1/auth/me")).status_code == 401


async def test_login_is_rate_limited_by_username_or_ip(client):
    for _ in range(10):
        response = await client.post(
            "/api/v1/auth/login",
            json={"username": "daniela", "password": "wrong-password"},
        )
        assert response.status_code == 401
    blocked = await client.post(
        "/api/v1/auth/login",
        json={"username": "daniela", "password": "secret-password"},
    )
    assert blocked.status_code == 429
