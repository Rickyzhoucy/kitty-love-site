"""宠物能读到多少站内内容，以及**读不到什么**。

`site_resource_list` 是宠物看世界的窗口，所以这里既测覆盖面（新加的地图/心情/
情书/每日一问都能查到），也测那两道锁没有被这个窗口绕过去——未解锁的信和没
揭晓的答案，从这条路也必须拿不到。锁写在服务层，但工具是另一条调用路径，
**规则不会自己跟过来**。
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.agent_tools import (
    LISTABLE_RESOURCES,
    READ_ONLY_RESOURCES,
    RESOURCE_DEFINITIONS,
    read_only_resource,
)
from app.agents.roles import ASSIST_TOOLS, AgentRole, filter_tools, spec_for
from app.auth import hash_password
from app.daily_questions import ensure_today, submit_answer
from app.future_letters import create as create_letter
from app.models import User
from app.moods import upsert as upsert_mood


class _FakeTool:
    def __init__(self, name: str) -> None:
        self.name = name


async def _two_users(session_maker) -> tuple[str, str]:
    async with session_maker() as db:
        me = await db.scalar(select(User).limit(1))
        partner = User(
            username="honey",
            display_name="宝贝",
            password_hash=hash_password("x" * 12),
        )
        db.add(partner)
        await db.commit()
        return me.id, partner.id


# ---- 覆盖面 ----


def test_every_site_feature_is_reachable():
    """S5 那四个功能当初一个都不在工具里，宠物问什么都答不上来。"""
    for resource in ("mapPin", "mood", "letter", "dailyQuestion"):
        assert resource in LISTABLE_RESOURCES


def test_locked_resources_have_no_write_path():
    """只读资源不进 RESOURCE_DEFINITIONS，create/update/delete 就够不到它们。"""
    for resource in READ_ONLY_RESOURCES:
        assert resource not in RESOURCE_DEFINITIONS


# ---- 锁没有被绕过 ----


async def test_tool_does_not_leak_a_locked_letter(session_maker):
    """**最重要的一条。** 工具是另一条调用路径，锁必须在这里重新执行一遍。"""
    me, _ = await _two_users(session_maker)
    async with session_maker() as db:
        await create_letter(
            db, me, "锁着的秘密", [], datetime.now(UTC) + timedelta(days=30)
        )
        await db.commit()

        rows = await read_only_resource(db, "letter")

    assert len(rows) == 1
    assert rows[0]["unlocked"] is False
    assert rows[0]["body"] is None
    assert "锁着的秘密" not in str(rows)


async def test_tool_reveals_an_unlocked_letter(session_maker):
    me, _ = await _two_users(session_maker)
    async with session_maker() as db:
        await create_letter(
            db, me, "到点了", [], datetime.now(UTC) - timedelta(minutes=1)
        )
        await db.commit()

        rows = await read_only_resource(db, "letter")

    assert rows[0]["unlocked"] is True
    assert rows[0]["body"] == "到点了"


async def test_tool_hides_answers_until_both_answered(session_maker):
    me, partner_id = await _two_users(session_maker)
    async with session_maker() as db:
        question = await ensure_today(db)
        await submit_answer(db, question.id, me, "只有我答了")
        await db.commit()

        rows = await read_only_resource(db, "dailyQuestion")

    assert rows[0]["bothAnswered"] is False
    assert rows[0]["answers"] == []
    # 题目本身可以看，答案不行
    assert rows[0]["prompt"]
    assert "只有我答了" not in str(rows)


async def test_tool_shows_answers_once_both_answered(session_maker):
    me, partner_id = await _two_users(session_maker)
    async with session_maker() as db:
        question = await ensure_today(db)
        await submit_answer(db, question.id, me, "我的答案")
        await submit_answer(db, question.id, partner_id, "对方的答案")
        await db.commit()

        rows = await read_only_resource(db, "dailyQuestion")

    assert rows[0]["bothAnswered"] is True
    bodies = {answer["body"] for answer in rows[0]["answers"]}
    assert bodies == {"我的答案", "对方的答案"}


async def test_mood_comes_back_with_a_readable_label(session_maker):
    """给模型「2」它不知道好坏，所以顺带给人话。"""
    me, _ = await _two_users(session_maker)
    async with session_maker() as db:
        await upsert_mood(db, me, 2, "没睡好")
        await db.commit()

        rows = await read_only_resource(db, "mood")

    assert rows[0]["mood"] == 2
    assert rows[0]["moodLabel"] == "有点低落"
    assert rows[0]["note"] == "没睡好"


# ---- 被 @ 时的工具白名单 ----


def test_assist_role_has_no_write_tools():
    """输入是另一个人写的自由文本，给了写工具就等于把注入接到真实写操作上。"""
    granted = filter_tools(
        AgentRole.ASSIST,
        [
            _FakeTool("site_resource_list"),
            _FakeTool("site_resource_create"),
            _FakeTool("site_resource_update"),
            _FakeTool("site_resource_delete"),
            _FakeTool("site_pet_action"),
            _FakeTool("web_search"),
        ],
    )
    names = {tool.name for tool in granted}
    assert names == {"site_resource_list", "web_search"}
    assert not any("create" in name or "update" in name or "delete" in name
                   for name in names)


def test_assist_can_search_the_web_but_cognition_cannot():
    """两档的区别：被 @ 是用户明确叫它（该能查），自己想事情时不该顺手上网。"""
    assert "web_search" in ASSIST_TOOLS
    assert "web_search" not in spec_for(AgentRole.COGNITION).tool_names


def test_assist_role_is_isolated_from_other_checkpoints():
    """三个角色共用一个 checkpointer，前缀撞了就会读到彼此的历史。"""
    prefixes = {
        spec_for(role).checkpoint_prefix
        for role in AgentRole
    }
    assert len(prefixes) == len(list(AgentRole))
