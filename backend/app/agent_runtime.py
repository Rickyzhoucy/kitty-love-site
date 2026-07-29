import asyncio
import base64
import json
import logging
from typing import Any, Protocol

from langchain.agents import create_agent
from langchain.agents.middleware import (
    ModelRequest,
    after_agent,
    before_model,
    dynamic_prompt,
)
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.agent_context import AgentContext
from app.agent_tools import build_domain_tools
from app.config import Settings, get_settings
from app.conversations import ConversationService
from app.embeddings import EmbeddingProvider
from app.memory import MemoryService
from app.models import Attachment, ChatMessage
from app.queue import JobQueue
from app.skill_runtime import SkillRegistry, skill_prompt
from app.skill_tools import build_skill_tools
from app.storage import ObjectStorage
from app.tool_audit import build_tool_audit_middleware

logger = logging.getLogger(__name__)


@dynamic_prompt
def companion_prompt(request: ModelRequest) -> str:
    context: AgentContext = request.runtime.context
    profile = json.dumps(context.user_profile, ensure_ascii=False)
    base_prompt = (
        f"{context.persona_prompt}\n\n"
        f"你的名字：{context.persona_name}\n"
        f"用户画像：{profile}\n"
        f"此前对话滚动摘要：{context.conversation_summary or '暂无'}\n"
        f"可用长期记忆：\n{context.memory_context or '暂无'}\n\n"
        "只在确实需要查询或修改站内数据时调用工具；工具成功后直接说明结果。"
    )
    return f"{base_prompt}{context.skill_context}"


@before_model
def validate_agent_context(state, runtime) -> None:
    del state
    context: AgentContext = runtime.context
    if not context.user_id or not context.companion_id:
        raise ValueError("Agent context 缺少用户或伴侣")
    return None


@after_agent
def log_agent_completion(state, runtime) -> None:
    context: AgentContext = runtime.context
    logger.info(
        "Agent completed conversation=%s user=%s messages=%s",
        context.conversation_id,
        context.user_id,
        len(state.get("messages", [])),
    )


def build_chat_model(settings: Settings | None = None) -> ChatOpenAI:
    config = settings or get_settings()
    if not config.chat_api_key:
        raise RuntimeError("CHAT_API_KEY 未配置")
    return ChatOpenAI(
        model=config.chat_model,
        base_url=config.chat_base_url,
        api_key=config.chat_api_key,
        temperature=config.chat_temperature,
        timeout=config.chat_timeout,
        # SDK 级重试只发生在连接建立/首字节前，不会重复已流出的 token
        max_retries=3,
        streaming=True,
    )


class AgentGraph(Protocol):
    def astream_events(self, *args, **kwargs): ...


def build_agent(
    model: BaseChatModel,
    checkpointer,
    session_maker: async_sessionmaker[AsyncSession],
) -> AgentGraph:
    return create_agent(
        model=model,
        tools=[*build_domain_tools(session_maker), *build_skill_tools(session_maker)],
        middleware=[
            companion_prompt,
            validate_agent_context,
            log_agent_completion,
            build_tool_audit_middleware(session_maker),
        ],
        context_schema=AgentContext,
        checkpointer=checkpointer,
    )


class CheckpointerLifecycle:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.checkpointer = None
        self._pool: AsyncConnectionPool | None = None

    async def start(self):
        if self.settings.database_url.startswith("sqlite"):
            self.checkpointer = InMemorySaver()
            return self.checkpointer
        self._pool = AsyncConnectionPool(
            conninfo=self.settings.procrastinate_database_url,
            kwargs={
                "autocommit": True,
                "prepare_threshold": 0,
                "row_factory": dict_row,
            },
            min_size=self.settings.checkpointer_pool_min_size,
            max_size=self.settings.checkpointer_pool_max_size,
            open=False,
        )
        await self._pool.open(wait=True)
        self.checkpointer = AsyncPostgresSaver(self._pool)
        await self.checkpointer.setup()
        return self.checkpointer

    async def stop(self) -> None:
        if self._pool is not None:
            await self._pool.close()


def _text_content(chunk: Any) -> str:
    content = getattr(chunk, "content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            block.get("text", "")
            for block in content
            if isinstance(block, dict) and block.get("type") in {"text", "output_text"}
        )
    return ""


def sse(event: str, data: dict[str, Any]) -> str:
    return (
        f"event: {event}\n"
        f"data: {json.dumps(data, ensure_ascii=False, default=str, separators=(',', ':'))}\n\n"
    )


def _tool_output(output: Any) -> Any:
    content = getattr(output, "content", output)
    if isinstance(content, str):
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            return content
    return content


class AgentRuntime:
    def __init__(
        self,
        agent: AgentGraph,
        session_maker: async_sessionmaker[AsyncSession],
        embedding_provider: EmbeddingProvider,
        job_queue: JobQueue | None = None,
        storage: ObjectStorage | None = None,
        settings: Settings | None = None,
        embedding_enabled: bool = True,
    ):
        self.agent = agent
        self.session_maker = session_maker
        self.memory = MemoryService(embedding_provider)
        self.conversations = ConversationService()
        self.job_queue = job_queue
        self.settings = settings or get_settings()
        self.storage = storage or ObjectStorage(self.settings)
        self.embedding_enabled = embedding_enabled
        # 后台持久化任务的强引用集合，防止 asyncio 弱引用导致 task 被 GC
        self._background_tasks: set[asyncio.Task] = set()

    async def _persist_assistant(
        self,
        user_id: str,
        conversation_id: str,
        answer: str,
        metadata: dict[str, Any] | None = None,
    ) -> tuple[Any, int]:
        async with self.session_maker() as db:
            conversation = await self.conversations.get(db, user_id, conversation_id)
            assistant_message = await self.conversations.append_message(
                db,
                conversation,
                "assistant",
                answer,
                metadata=metadata,
            )
            message_count = (
                await db.scalar(
                    select(func.count(ChatMessage.id)).where(
                        ChatMessage.conversation_id == conversation.id
                    )
                )
            ) or 0
        return assistant_message, message_count

    async def _persist_interrupted_reply(
        self,
        user_id: str,
        conversation_id: str,
        answer_parts: list[str],
        reason: str,
    ) -> None:
        answer = "".join(answer_parts).strip() or "回复生成中断，请重试。"
        await self._persist_assistant(
            user_id,
            conversation_id,
            answer,
            metadata={"interrupted": True, "reason": reason},
        )

    async def stream(
        self,
        user_id: str,
        message: str,
        conversation_id: str | None = None,
        attachment_ids: list[str] | None = None,
    ):
        attachment_ids = list(dict.fromkeys(attachment_ids or []))
        async with self.session_maker() as db:
            if conversation_id:
                conversation = await self.conversations.get(db, user_id, conversation_id)
            else:
                conversation = await self.conversations.create(db, user_id)
            attachments = list(
                await db.scalars(
                    select(Attachment).where(
                        Attachment.id.in_(attachment_ids),
                        Attachment.owner_id == user_id,
                        Attachment.status == "ready",
                    )
                )
            ) if attachment_ids else []
            if len(attachments) != len(attachment_ids):
                raise ValueError("附件不存在或不属于当前用户")
            await self.conversations.append_message(
                db,
                conversation,
                "user",
                message,
                metadata={"attachmentIds": attachment_ids},
            )
            persona, profile = await self.conversations.context(db, conversation)
            summary = await self.conversations.summary(db, conversation.id)
            try:
                memories = await self.memory.search(
                    db,
                    user_id,
                    message,
                    conversation.companion_id,
                )
            except Exception:
                memories = (await self.memory.list(
                    db, user_id, conversation.companion_id
                ))[:8]
            skill_metadata = await SkillRegistry(self.storage).active_metadata(db)
            context = AgentContext(
                user_id=user_id,
                conversation_id=conversation.id,
                companion_id=conversation.companion_id,
                persona_name=persona.name,
                persona_prompt=persona.prompt,
                user_profile=profile,
                conversation_summary=summary.summary if summary else "",
                memory_context="\n".join(f"- {item.content}" for item in memories),
                skill_context=skill_prompt(
                    skill_metadata
                ),
                skill_versions={
                    item["name"]: item["versionId"] for item in skill_metadata
                },
            )

        answer_parts: list[str] = []
        checkpoint_segment = summary.through_message_id if summary else "initial"
        config = {
            "configurable": {
                "thread_id": f"{conversation.id}:{checkpoint_segment}",
            }
        }
        model_content: str | list[dict[str, Any]] = message
        if attachments:
            blocks: list[dict[str, Any]] = [{"type": "text", "text": message}]
            for attachment in attachments:
                metadata_text = (
                    f"附件 ID: {attachment.id}\n"
                    f"文件名: {attachment.filename}\n"
                    f"类型: {attachment.content_type}\n"
                    f"大小: {attachment.size} bytes"
                )
                blocks.append({"type": "text", "text": metadata_text})
                if attachment.size > self.settings.chat_attachment_inline_bytes:
                    blocks.append(
                        {"type": "text", "text": "附件过大，仅提供以上元数据。"}
                    )
                    continue
                content = await self.storage.get_bytes(
                    attachment.bucket,
                    attachment.object_key,
                )
                if attachment.content_type.startswith("image/"):
                    encoded = base64.b64encode(content).decode("ascii")
                    blocks.append(
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": (
                                    f"data:{attachment.content_type};base64,{encoded}"
                                )
                            },
                        }
                    )
                elif attachment.content_type.startswith("text/"):
                    text_content = content[
                        : self.settings.chat_text_attachment_bytes
                    ].decode("utf-8", errors="replace")
                    blocks.append(
                        {
                            "type": "text",
                            "text": f"文本附件内容：\n{text_content}",
                        }
                    )
                elif attachment.extracted_text:
                    blocks.append(
                        {
                            "type": "text",
                            "text": (
                                "已解析附件内容：\n"
                                f"{attachment.extracted_text[:self.settings.chat_text_attachment_bytes]}"
                            ),
                        }
                    )
                else:
                    blocks.append(
                        {
                            "type": "text",
                            "text": (
                                f"附件解析状态：{attachment.parse_status}。"
                                "如仍在处理，请稍后重试。"
                            ),
                        }
                    )
            model_content = blocks

        stream_completed = False
        interruption_reason = "client_disconnected"
        try:
            async for event in self.agent.astream_events(
                {"messages": [{"role": "user", "content": model_content}]},
                config=config,
                context=context,
                version="v2",
            ):
                event_name = event.get("event")
                if event_name == "on_chat_model_stream":
                    delta = _text_content(event.get("data", {}).get("chunk"))
                    if delta:
                        answer_parts.append(delta)
                        yield sse("text.delta", {"delta": delta})
                elif event_name == "on_tool_start":
                    yield sse(
                        "tool.started",
                        {
                            "name": event.get("name", ""),
                            "input": event.get("data", {}).get("input"),
                        },
                    )
                elif event_name == "on_tool_end":
                    output = _tool_output(event.get("data", {}).get("output"))
                    tool_name = event.get("name", "")
                    yield sse("tool.completed", {"name": tool_name, "output": output})
            stream_completed = True
        except asyncio.CancelledError:
            interruption_reason = "client_disconnected"
            raise
        except GeneratorExit:
            interruption_reason = "client_disconnected"
            raise
        except Exception as error:
            interruption_reason = type(error).__name__
            raise
        finally:
            if not stream_completed:
                try:
                    persist_task = asyncio.create_task(
                        self._persist_interrupted_reply(
                            user_id,
                            conversation.id,
                            answer_parts,
                            interruption_reason,
                        )
                    )
                except RuntimeError:
                    # 事件循环关闭中（GeneratorExit 场景），无法再调度任务
                    persist_task = None
                if persist_task is not None:
                    self._background_tasks.add(persist_task)
                    persist_task.add_done_callback(self._background_tasks.discard)
                    try:
                        await asyncio.shield(persist_task)
                    except asyncio.CancelledError:
                        logger.info(
                            "Reply persistence continues after stream cancellation",
                            extra={"conversation_id": conversation.id},
                        )

        answer = "".join(answer_parts).strip()
        assistant_message, message_count = await self._persist_assistant(
            user_id,
            conversation.id,
            answer,
        )
        if self.job_queue is not None:
            user_turn = (message_count + 1) // 2
            tasks = []
            if self.embedding_enabled and (user_turn == 1 or user_turn % 5 == 0):
                tasks.append(("memory.extract", user_turn // 5))
            if user_turn % 20 == 0:
                tasks.extend(
                    [
                        ("conversation.summarize", user_turn // 20),
                        ("profile.refresh", user_turn // 20),
                    ]
                )
            for task_name, bucket in tasks:
                try:
                    await self.job_queue.enqueue(
                        task_name,
                        {"conversation_id": conversation.id, "user_id": user_id},
                        idempotency_key=f"{conversation.id}:{task_name}:{bucket}",
                    )
                except Exception:
                    # Persistence of the reply must not depend on queue availability.
                    pass
        yield sse(
            "message.completed",
            {
                "conversationId": conversation.id,
                "messageId": assistant_message.id,
            },
        )
