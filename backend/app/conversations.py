from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    ChatMessage,
    Companion,
    CompanionPersona,
    Conversation,
    ConversationSummary,
    UserProfile,
    utcnow,
)

DEFAULT_PERSONA_PROMPT = (
    "你是用户稳定、亲密且尊重边界的生活伴侣。自然地使用已有记忆，"
    "不伪造经历；需要操作站内数据时使用工具。"
)


class ConversationService:
    async def ensure_companion(
        self,
        db: AsyncSession,
        user_id: str,
    ) -> tuple[Companion, CompanionPersona]:
        companion = await db.scalar(select(Companion).where(Companion.owner_id == user_id))
        if companion is None:
            companion = Companion(owner_id=user_id, name="Kitty")
            db.add(companion)
            await db.flush()
            persona = CompanionPersona(
                companion_id=companion.id,
                name="Kitty",
                prompt=DEFAULT_PERSONA_PROMPT,
            )
            db.add(persona)
            await db.flush()
            companion.active_persona_id = persona.id
            await db.commit()
            return companion, persona
        persona = None
        if companion.active_persona_id:
            persona = await db.get(CompanionPersona, companion.active_persona_id)
        if persona is None:
            persona = await db.scalar(
                select(CompanionPersona)
                .where(CompanionPersona.companion_id == companion.id)
                .order_by(CompanionPersona.version.desc())
            )
        if persona is None:
            persona = CompanionPersona(
                companion_id=companion.id,
                name=companion.name,
                prompt=DEFAULT_PERSONA_PROMPT,
            )
            db.add(persona)
            await db.flush()
            companion.active_persona_id = persona.id
            await db.commit()
        return companion, persona

    async def create(
        self,
        db: AsyncSession,
        user_id: str,
        companion_id: str | None = None,
        title: str | None = None,
    ) -> Conversation:
        if companion_id is None:
            companion, _ = await self.ensure_companion(db, user_id)
        else:
            companion = await db.get(Companion, companion_id)
            if companion is None or companion.owner_id != user_id:
                raise ValueError("Companion 不存在")
        conversation = Conversation(
            user_id=user_id,
            companion_id=companion.id,
            title=title,
        )
        db.add(conversation)
        await db.commit()
        await db.refresh(conversation)
        return conversation

    async def list(
        self,
        db: AsyncSession,
        user_id: str,
        limit: int = 200,
    ) -> list[Conversation]:
        return list(
            await db.scalars(
                select(Conversation)
                .where(Conversation.user_id == user_id)
                .order_by(Conversation.updated_at.desc())
                .limit(max(1, min(limit, 200)))
            )
        )

    async def get(
        self,
        db: AsyncSession,
        user_id: str,
        conversation_id: str,
    ) -> Conversation:
        conversation = await db.get(Conversation, conversation_id)
        if conversation is None or conversation.user_id != user_id:
            raise LookupError("Conversation 不存在")
        return conversation

    async def messages(
        self,
        db: AsyncSession,
        user_id: str,
        conversation_id: str,
        limit: int = 500,
    ) -> list[ChatMessage]:
        await self.get(db, user_id, conversation_id)
        return list(
            await db.scalars(
                select(ChatMessage)
                .where(ChatMessage.conversation_id == conversation_id)
                .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
                .limit(max(1, min(limit, 500)))
            )
        )[::-1]

    async def append_message(
        self,
        db: AsyncSession,
        conversation: Conversation,
        role: str,
        content: str,
        metadata: dict | None = None,
    ) -> ChatMessage:
        message = ChatMessage(
            conversation_id=conversation.id,
            role=role,
            content=content,
            metadata_=metadata or {},
        )
        conversation.updated_at = utcnow()
        db.add(message)
        await db.commit()
        await db.refresh(message)
        return message

    async def context(
        self,
        db: AsyncSession,
        conversation: Conversation,
    ) -> tuple[CompanionPersona, dict]:
        companion = await db.get(Companion, conversation.companion_id)
        if companion is None:
            raise LookupError("Companion 不存在")
        persona = (
            await db.get(CompanionPersona, companion.active_persona_id)
            if companion.active_persona_id
            else None
        )
        if persona is None:
            _, persona = await self.ensure_companion(db, conversation.user_id)
        profile = await db.scalar(
            select(UserProfile).where(UserProfile.user_id == conversation.user_id)
        )
        return persona, profile.profile if profile else {}

    async def summary(
        self,
        db: AsyncSession,
        conversation_id: str,
    ) -> ConversationSummary | None:
        return await db.scalar(
            select(ConversationSummary)
            .where(ConversationSummary.conversation_id == conversation_id)
            .order_by(ConversationSummary.created_at.desc())
            .limit(1)
        )

    async def get_or_create_profile(
        self,
        db: AsyncSession,
        user_id: str,
    ) -> UserProfile:
        profile = await db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
        if profile is None:
            profile = UserProfile(user_id=user_id, profile={})
            db.add(profile)
            await db.commit()
            await db.refresh(profile)
        return profile
