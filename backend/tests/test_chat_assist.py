"""在聊天里 @ 宠物帮忙。

两组重点：**认不认得出被 @ 了**（名字是用户能改的，还可能含正则元字符），
以及**给模型的记录能不能分清谁说的**——不区分说话人的话，模型会把两个人的
立场揉成一个人，在一段关系里张冠李戴比答不上来糟糕得多。
"""

import pytest
from sqlalchemy import select

from app.auth import hash_password
from app.chat_assist import (
    CONTEXT_MESSAGES,
    SYSTEM_PROMPT,
    build_transcript,
    mentions_pet,
    strip_mention,
)
from app.direct_messages import send_message
from app.models import User


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


# ---- 认出被 @ ----


@pytest.mark.parametrize(
    "body",
    [
        "@yo yo 那家店叫啥来着",
        "@YO YO 帮我看看",       # 大小写不敏感
        "@ yo yo 在吗",           # @ 和名字之间有空格
        "问一下 @yo yo 这个怎么办",  # 不在开头
        "@宠物 帮个忙",            # 通用叫法，不用打对名字
    ],
)
def test_recognises_a_mention(body):
    assert mentions_pet(body, "yo yo") is True


@pytest.mark.parametrize(
    "body",
    [
        "yo yo 今天好可爱",   # 没有 @ 就不是在叫它
        "邮箱是 a@b.com",     # @ 不是给它的
        "",
    ],
)
def test_ignores_non_mentions(body):
    assert mentions_pet(body, "yo yo") is False


def test_pet_name_with_regex_characters_does_not_break():
    """名字是用户随便改的。`.` `*` `(` 这些进了正则会炸或者乱匹配。"""
    assert mentions_pet("@a.b(c) 在吗", "a.b(c)") is True
    # `.` 不该被当成通配符去匹配别的字符
    assert mentions_pet("@axbxc 在吗", "a.b.c") is False


def test_strip_mention_leaves_the_actual_question():
    assert strip_mention("@yo yo 那家店叫啥来着", "yo yo") == "那家店叫啥来着"
    assert strip_mention("@宠物 帮个忙", "yo yo") == "帮个忙"


def test_strip_mention_can_end_up_empty():
    """只 @ 了一声没说事——调用方要能看出来，不能把空字符串当问题送进模型。"""
    assert strip_mention("@yo yo", "yo yo") == ""


# ---- 给模型的记录 ----


async def test_transcript_labels_who_said_what(session_maker):
    """**最重要的一条。** 不标名字，模型分不清立场，回答就会张冠李戴。"""
    me, partner_id = await _two_users(session_maker)
    async with session_maker() as db:
        await send_message(db, me, partner_id, "我想吃火锅", [])
        await send_message(db, partner_id, me, "我不想吃辣的", [])
        await db.commit()

        from app.direct_messages import list_thread

        messages = await list_thread(db, me, partner_id)

    transcript = build_transcript(messages, {me: "Ricky", partner_id: "宝贝"})
    assert "Ricky：我想吃火锅" in transcript
    assert "宝贝：我不想吃辣的" in transcript
    # 顺序也要对：谁先说的会改变意思
    assert transcript.index("Ricky") < transcript.index("宝贝")


async def test_transcript_is_capped(session_maker):
    """只给最近的一段。整段历史既贵又会淹掉刚才在说的事。"""
    me, partner_id = await _two_users(session_maker)
    async with session_maker() as db:
        for index in range(CONTEXT_MESSAGES + 8):
            await send_message(db, me, partner_id, f"第{index}条", [])
        await db.commit()

        from app.direct_messages import list_thread

        messages = await list_thread(db, me, partner_id)

    transcript = build_transcript(messages, {me: "Ricky", partner_id: "宝贝"})
    assert len(transcript.splitlines()) == CONTEXT_MESSAGES
    # 保留的是**最近**的，不是最早的
    assert "第0条" not in transcript
    assert f"第{CONTEXT_MESSAGES + 7}条" in transcript


async def test_attachment_only_message_still_appears(session_maker):
    """只发了图的那条不能凭空消失——否则记录里会出现莫名其妙的断层。"""
    me, partner_id = await _two_users(session_maker)
    async with session_maker() as db:
        await send_message(db, me, partner_id, "", ["att1"])
        await db.commit()

        from app.direct_messages import list_thread

        messages = await list_thread(db, me, partner_id)

    transcript = build_transcript(messages, {me: "Ricky", partner_id: "宝贝"})
    assert "Ricky：（发了一张图/一个文件）" in transcript


def test_unknown_sender_does_not_crash():
    """名字表里查不到的人（账号被删）也得能拼出记录。"""
    from app.models import DirectMessage

    message = DirectMessage(
        sender_id="ghost", recipient_id="x", body="还在吗", attachment_ids=[]
    )
    assert "某人：还在吗" in build_transcript([message], {})


# ---- 约束 ----


def test_prompt_forbids_making_things_up():
    """与 pet_mediation 同一条底线：不知道就说不知道，不能编。"""
    assert "不要编" in SYSTEM_PROMPT
    assert "不要推测原因" in SYSTEM_PROMPT


def test_prompt_keeps_the_pet_from_speaking_as_either_person():
    assert "不要以他们的名义表态" in SYSTEM_PROMPT
