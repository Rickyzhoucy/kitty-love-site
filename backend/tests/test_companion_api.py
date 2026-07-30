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

    # /pet 现在投影自 Companion + CompanionPetProfile，不再有全站单例。
    # id 是 companionId——行为脑拿它当性格种子，所以必须是每用户唯一的。
    companions = await authenticated_client.get("/api/v1/conversations")
    assert companions.status_code == 200
    assert pet.json()["id"] == changed.json()["id"]
    # 改名走 Companion，Agent 与前端从此看到同一个名字。
    renamed = await authenticated_client.patch("/api/v1/pet", json={"name": "旺财"})
    assert renamed.json()["name"] == "旺财"
    persona_after = await authenticated_client.get("/api/v1/persona")
    assert persona_after.status_code == 200


async def test_conversation_list_carries_preview_and_count(
    authenticated_client,
    session_maker,
):
    """列表要能认出「上次聊蛋糕的那一次」，只给日期是没法用的。"""
    from sqlalchemy import select

    from app.conversations import ConversationService
    from app.models import User

    service = ConversationService()
    async with session_maker() as db:
        user_id = await db.scalar(select(User.id))
        conversation = await service.create(db, user_id, title=None)
        await service.append_message(db, conversation, "user", "我想吃草莓蛋糕")
        await service.append_message(db, conversation, "assistant", "记下了")
        await service.append_message(db, conversation, "user", "还有芒果的")
        empty = await service.create(db, user_id, title=None)

    listed = (await authenticated_client.get("/api/v1/conversations")).json()
    by_id = {item["id"]: item for item in listed}

    # 预览取**首条**用户发言，不是最后一条——回头找的时候记得的是开头。
    assert by_id[conversation.id]["preview"] == "我想吃草莓蛋糕"
    assert by_id[conversation.id]["messageCount"] == 3
    # 空对话不能因为没有消息就从列表里消失。
    assert by_id[empty.id]["preview"] is None
    assert by_id[empty.id]["messageCount"] == 0


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
