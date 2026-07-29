async def test_profile_persona_conversation_and_pet_api(authenticated_client):
    profile = await authenticated_client.patch(
        "/api/v1/profile",
        json={"profile": {"favorite": "strawberry"}},
    )
    assert profile.status_code == 200
    assert profile.json()["profile"]["favorite"] == "strawberry"

    persona = await authenticated_client.patch(
        "/api/v1/persona",
        json={"name": "Mimi", "prompt": "温柔而诚实"},
    )
    assert persona.status_code == 200
    assert persona.json()["name"] == "Mimi"
    assert persona.json()["version"] == 2

    conversation = await authenticated_client.post(
        "/api/v1/conversations",
        json={"title": "晚间聊天"},
    )
    assert conversation.status_code == 201
    assert conversation.json()["title"] == "晚间聊天"

    pet = await authenticated_client.get("/api/v1/pet")
    assert pet.status_code == 200
    assert pet.json()["assetId"] == "kitty"
    changed = await authenticated_client.patch(
        "/api/v1/pet",
        json={"assetId": "shiba"},
    )
    assert changed.json()["assetId"] == "shiba"
    assert changed.json()["assetId"] == "shiba"

    action = await authenticated_client.post("/api/v1/pet/actions/walk")
    assert action.status_code == 200
    assert action.json() == {
        "action": "walk",
        "animation": "walk",
        "assetId": "shiba",
        "message": None,
        "duration": 1800,
    }


async def test_config_update_history_reset_and_rollback(authenticated_client):
    updated = await authenticated_client.put(
        "/api/v1/config",
        json={"letter_title": "我们的信"},
    )
    assert updated.status_code == 200

    history = await authenticated_client.get("/api/v1/config/history")
    assert history.status_code == 200
    entry = history.json()[0]
    assert entry["value"] == "我们的信"

    reset = await authenticated_client.post(
        "/api/v1/config/reset",
        json=["letter_title"],
    )
    assert reset.status_code == 204
    assert (await authenticated_client.get("/api/v1/config")).json() == {}

    rollback = await authenticated_client.post(
        f"/api/v1/config/history/{entry['id']}/rollback"
    )
    assert rollback.status_code == 200
    assert rollback.json() == {"letter_title": "我们的信"}
