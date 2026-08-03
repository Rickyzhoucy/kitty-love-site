"""Conversation Agent —— 用户主动对话这一条路径（架构文档 §4.1）。

改造前这里是唯一的 Agent。P4 把它降级为三个角色之一：工具不设限，但
checkpoint 与预算都走 `roles.py` 里 CONVERSATION 那一档，与 Cognition /
Reflection 完全隔离。
"""

import asyncio
import base64
import json
import logging
import re
from typing import Any, Protocol

from langchain.agents import create_agent
from langchain.agents.middleware import (
    ModelRequest,
    SummarizationMiddleware,
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
from app.agent_tasks import (
    AgentTaskStatus,
    TaskStep,
    create_task,
    describe_step,
    task_event,
    update_task,
)
from app.agent_tools import build_domain_tools
from app.agents.reflection import record_event
from app.agents.roles import AgentRole, filter_tools, spec_for, thread_id
from app.config import Settings, get_settings
from app.context_assembler import ContextAssembler
from app.conversations import ConversationService
from app.doc_tools import build_document_tools
from app.embeddings import EmbeddingProvider
from app.ids import new_id
from app.local_tools import build_local_tools
from app.mcp_tools import build_mcp_tools
from app.memory import MemoryService
from app.models import Attachment, ChatMessage
from app.queue import JobQueue
from app.skill_runtime import SkillRegistry, skill_prompt
from app.skill_tools import build_skill_tools
from app.storage import ObjectStorage
from app.tool_audit import build_tool_audit_middleware
from app.web_search import build_search_provider
from app.web_tools import build_web_tools
from app.workspace_tools import build_workspace_tools

logger = logging.getLogger(__name__)

SUCCESS_CLAIM_PATTERN = re.compile(
    r"(?:已经|已|帮你|替你).{0,10}(?:记录|记下|存档|保存|创建|新增|修改|删除|发送|完成)"
)
NEGATED_CLAIM_PATTERN = re.compile(
    r"(?:没有|尚未|还没|不能|无法|未能).{0,12}(?:记录|记下|存档|保存|创建|新增|修改|删除|发送|完成)"
)


def guard_action_claims(answer: str, *, has_committed_receipt: bool) -> str:
    """没有数据库提交回执时，完成式文本不得离开服务端。"""

    if has_committed_receipt or not SUCCESS_CLAIM_PATTERN.search(answer):
        return answer
    if NEGATED_CLAIM_PATTERN.search(answer):
        return answer
    return "这次没有产生成功写入回执，所以我没有把它当成已完成。请确认后再试一次。"


@dynamic_prompt
def companion_prompt(request: ModelRequest) -> str:
    context: AgentContext = request.runtime.context
    profile = json.dumps(context.user_profile, ensure_ascii=False)
    page_context = json.dumps(context.page_context, ensure_ascii=False)
    base_prompt = (
        f"{context.persona_prompt}\n\n"
        f"你的名字：{context.persona_name}\n"
        f"用户画像：{profile}\n"
        f"此前对话滚动摘要：{context.conversation_summary or '暂无'}\n"
        f"可用长期记忆：\n{context.memory_context or '暂无'}\n\n"
        f"当前网站语义上下文：{page_context or '{}'}\n"
        f"当前任务：{context.active_task or '暂无'}\n"
        "长期记忆行里的 memory/source 标记是可追溯依据；不要编造不在其中的记忆。"
        "用户问为什么记得时，按 source 类型和日期说明，不暴露内部 ID。\n"
        "只在确实需要查询或修改站内数据时调用工具。"
        "只有工具结果包含 status=committed 的 ActionReceipt 时，才能说已经记录、"
        "已创建、已修改、已删除、已发送或已完成；没有回执就必须明确说尚未写入。"
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


def build_chat_model(
    settings: Settings | None = None,
    role: AgentRole | None = None,
) -> ChatOpenAI:
    """三个角色共用模型提供方，但温度与超时按角色取（架构文档 §4）。

    不传 role 时保持既有行为，用全局的 chat_temperature / chat_timeout。
    """
    config = settings or get_settings()
    if not config.chat_api_key:
        raise RuntimeError("CHAT_API_KEY 未配置")
    spec = spec_for(role) if role is not None else None
    return ChatOpenAI(
        model=config.chat_model,
        base_url=config.chat_base_url,
        api_key=config.chat_api_key,
        temperature=spec.temperature if spec else config.chat_temperature,
        timeout=spec.timeout_seconds if spec else config.chat_timeout,
        # SDK 级重试只发生在连接建立/首字节前，不会重复已流出的 token
        max_retries=3,
        streaming=True,
    )


class AgentGraph(Protocol):
    def astream_events(self, *args, **kwargs): ...


def build_compaction_middleware(
    model: BaseChatModel,
    settings: Settings | None = None,
) -> SummarizationMiddleware:
    """对话历史自动压缩。

    用 LangChain 自带的 `SummarizationMiddleware`，**不自己写**：这类东西的难点
    从来不是「摘要一下」，而是那些边角——工具调用消息必须和它的结果成对保留，
    否则模型会看到一个没有结果的调用；摘要本身也要计入预算；触发点要留余量，
    卡到 100% 再动手时那次压缩调用自己就超长了。这些它都处理过了。

    阈值取模型上下文的一个比例（默认 75%），而不是写死 token 数——换模型时只要
    改 `chat_context_tokens` 一个值，触发点自动跟着走。
    """
    config = settings or get_settings()
    budget = int(config.chat_context_tokens * config.chat_compact_at)
    return SummarizationMiddleware(
        model=model,
        trigger=("tokens", budget),
        keep=("messages", config.chat_compact_keep_messages),
    )


def build_agent(
    model: BaseChatModel,
    checkpointer,
    session_maker: async_sessionmaker[AsyncSession],
    role: AgentRole = AgentRole.CONVERSATION,
) -> AgentGraph:
    """按角色装配 Agent。

    工具白名单按角色过滤——见 `roles.py`。默认角色是 CONVERSATION，所以既有
    调用点不加参数也拿到和改造前完全一样的东西。
    """
    tools = filter_tools(
        role,
        [
            *build_domain_tools(session_maker),
            *build_skill_tools(session_maker),
            *build_web_tools(build_search_provider()),
            *build_document_tools(session_maker),
            *build_workspace_tools(get_settings()),
            # MCP 只注册稳定的 find/call 两级入口；第三方 Schema 按需从服务器目录取，
            # 不把全部 MCP 工具常驻塞进模型上下文。
            *build_mcp_tools(session_maker),
            # 读用户真实电脑上的文件。**只有 CONVERSATION 拿得到**——
            # 那一档 tool_names 是 None（不限制），其余三档都是显式白名单，
            # 名字不在里面就自动被 filter_tools 挡掉。理由见 roles.py 的
            # LOCAL_FILE_TOOLS 注释。
            *build_local_tools(session_maker),
        ],
    )
    return create_agent(
        model=model,
        tools=tools,
        middleware=[
            companion_prompt,
            validate_agent_context,
            log_agent_completion,
            build_tool_audit_middleware(session_maker),
            # 上下文压缩。放在最后：前面几个 middleware 还要看完整的消息列表。
            build_compaction_middleware(model),
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


def _produced_attachment_id(tool_name: str, output: Any) -> str | None:
    """从工具返回值里认出「生成了一个可下载的文件」。

    只认 create_document：其它工具的返回里出现 attachmentId 也可能只是引用了
    一个已有附件，重复挂到消息上会让同一个文件在历史里出现两次。
    """
    if tool_name != "create_document" or not isinstance(output, dict):
        return None
    attachment_id = output.get("attachmentId")
    return attachment_id if isinstance(attachment_id, str) and attachment_id else None


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
        self.context_assembler = ContextAssembler(self.memory)
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

    async def _record_high_risk(
        self,
        companion_id: str,
        summaries: list[str],
    ) -> None:
        """把高风险操作记成待反思事件（架构文档 §9）。

        删掉一批照片这种事，半年后回头看是值得记得的——普通的查询不是。
        只写语义摘要，不写 payload：这条记录最终会进模型的上下文。
        """
        try:
            async with self.session_maker() as db:
                await record_event(
                    db,
                    companion_id,
                    "task.highRisk",
                    {"steps": summaries[:5]},
                    importance=75,
                )
                await db.commit()
        except Exception:
            # 记不上就算了，回复本身不能因此失败。
            logger.info("高风险事件落库失败", exc_info=True)

    async def _persist_interrupted_reply(
        self,
        user_id: str,
        conversation_id: str,
        answer_parts: list[str],
        reason: str,
    ) -> None:
        answer = (
            guard_action_claims(
                "".join(answer_parts).strip(),
                has_committed_receipt=False,
            )
            or "回复生成中断，请重试。"
        )
        await self._persist_assistant(
            user_id,
            conversation_id,
            answer,
            metadata={"interrupted": True, "reason": reason},
        )

    async def _cancel_task(self, task_id: str) -> None:
        """流断开后仍把服务器任务置为 cancelled，避免留下永远 running 的假状态。"""
        async with self.session_maker() as db:
            await update_task(db, task_id, "cancelled", result_summary="客户端中断了任务流")

    async def stream(
        self,
        user_id: str,
        message: str,
        conversation_id: str | None = None,
        attachment_ids: list[str] | None = None,
    ):
        attachment_ids = list(dict.fromkeys(attachment_ids or []))
        # 一轮对话即一个语义任务；每次工具调用是它的一个步骤（对应 P3 的
        # AgentTask / AgentTaskStep）。任务 id 现在只在流内有意义，P3 落库后
        # 这里改为复用 AgentTask.id。
        task_id = new_id()
        async with self.session_maker() as db:
            if conversation_id:
                conversation = await self.conversations.get(db, user_id, conversation_id)
            else:
                conversation = await self.conversations.create(db, user_id)
            attachments = (
                list(
                    await db.scalars(
                        select(Attachment).where(
                            Attachment.id.in_(attachment_ids),
                            Attachment.owner_id == user_id,
                            Attachment.status == "ready",
                        )
                    )
                )
                if attachment_ids
                else []
            )
            if len(attachments) != len(attachment_ids):
                raise ValueError("附件不存在或不属于当前用户")
            user_message = await self.conversations.append_message(
                db,
                conversation,
                "user",
                message,
                metadata={"attachmentIds": attachment_ids},
            )
            persona, profile = await self.conversations.context(db, conversation)
            summary = await self.conversations.summary(db, conversation.id)
            try:
                assembled = await self.context_assembler.assemble(
                    db,
                    user_id,
                    conversation.companion_id,
                    query=message,
                    role="conversation",
                )
            except Exception:
                logger.info("上下文组装失败，降级为无长期记忆", exc_info=True)
                assembled = None
            skill_metadata = await SkillRegistry(self.storage).active_metadata(db)
            context = AgentContext(
                user_id=user_id,
                conversation_id=conversation.id,
                companion_id=conversation.companion_id,
                persona_name=persona.name,
                persona_prompt=persona.prompt,
                user_profile=profile,
                conversation_summary=summary.summary if summary else "",
                memory_context=assembled.memory_context if assembled else "",
                source_message_id=user_message.id,
                page_context=assembled.page_context if assembled else {},
                active_task=assembled.active_task if assembled else None,
                memory_ids=([item.id for item in assembled.memories] if assembled else []),
                skill_context=skill_prompt(skill_metadata),
                skill_versions={item["name"]: item["versionId"] for item in skill_metadata},
                task_id=task_id,
            )

        answer_parts: list[str] = []
        checkpoint_segment = summary.through_message_id if summary else "initial"
        config = {
            "configurable": {
                # 角色前缀不能省：三个角色共用一个 checkpointer，前缀相同
                # 就会读到彼此的历史。
                "thread_id": thread_id(AgentRole.CONVERSATION, conversation.id, checkpoint_segment),
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
                    blocks.append({"type": "text", "text": "附件过大，仅提供以上元数据。"})
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
                                "url": (f"data:{attachment.content_type};base64,{encoded}")
                            },
                        }
                    )
                elif attachment.content_type.startswith("text/"):
                    text_content = content[: self.settings.chat_text_attachment_bytes].decode(
                        "utf-8", errors="replace"
                    )
                    blocks.append(
                        {
                            "type": "text",
                            "text": f"文本附件内容：\n{text_content}",
                        }
                    )
                elif attachment.extracted_text:
                    extracted_content = attachment.extracted_text[
                        : self.settings.chat_text_attachment_bytes
                    ]
                    blocks.append(
                        {
                            "type": "text",
                            "text": (f"已解析附件内容：\n{extracted_content}"),
                        }
                    )
                else:
                    blocks.append(
                        {
                            "type": "text",
                            "text": (
                                f"附件解析状态：{attachment.parse_status}。如仍在处理，请稍后重试。"
                            ),
                        }
                    )
            model_content = blocks

        stream_completed = False
        interruption_reason = "client_disconnected"

        def task_sse(
            status: AgentTaskStatus,
            step: TaskStep | None = None,
            sequence: int | None = None,
        ) -> str:
            name, payload = task_event(status, task_id, step=step, sequence=sequence)
            return sse(name, payload)

        step_sequence = 0
        active_steps: dict[str, TaskStep] = {}
        high_risk_steps: list[str] = []
        # create_document 生成的文件。要挂到助手消息的 metadata 上，
        # 否则它只活在工具返回值里——前端翻历史时看不到，只能指望模型
        # 恰好把链接写进正文。
        produced_attachments: list[str] = []
        committed_receipt_ids: list[str] = []
        task_failed = False
        async with self.session_maker() as db:
            await create_task(
                db,
                task_id=task_id,
                user_id=user_id,
                companion_id=conversation.companion_id,
                conversation_id=conversation.id,
            )
        try:
            yield task_sse("created")
            async for event in self.agent.astream_events(
                {"messages": [{"role": "user", "content": model_content}]},
                config=config,
                context=context,
                version="v2",
            ):
                event_name = event.get("event")
                if event_name == "on_chat_model_start":
                    # 每次模型开始推理都是一次规划——首轮如此，工具返回后
                    # 决定下一步也如此。宠物据此在 thinking 与 working 之间往复。
                    async with self.session_maker() as db:
                        await update_task(db, task_id, "planning")
                    yield task_sse("planning")
                elif event_name == "on_chat_model_stream":
                    delta = _text_content(event.get("data", {}).get("chunk"))
                    if delta:
                        answer_parts.append(delta)
                elif event_name == "on_tool_start":
                    tool_name = event.get("name", "")
                    tool_input = event.get("data", {}).get("input")
                    yield sse(
                        "tool.started",
                        {"name": tool_name, "input": tool_input},
                    )
                    step = describe_step(tool_name, tool_input)
                    step_sequence += 1
                    active_steps[str(event.get("run_id", tool_name))] = step
                    # 执行体在站外的步骤报 waiting，本进程内跑完的报 running。
                    yield task_sse(step.running_status, step, step_sequence)
                elif event_name == "on_tool_end":
                    output = _tool_output(event.get("data", {}).get("output"))
                    tool_name = event.get("name", "")
                    yield sse("tool.completed", {"name": tool_name, "output": output})
                    if isinstance(output, dict):
                        receipt = output.get("actionReceipt")
                        if (
                            isinstance(receipt, dict)
                            and receipt.get("status") == "committed"
                            and isinstance(receipt.get("id"), str)
                        ):
                            committed_receipt_ids.append(receipt["id"])
                    step = active_steps.pop(str(event.get("run_id", tool_name)), None)
                    attachment_id = _produced_attachment_id(tool_name, output)
                    if attachment_id:
                        produced_attachments.append(attachment_id)
                        # 立刻推给前端：等消息落库再显示，用户会先看到一段
                        # 「我做好了」却没有可下载的东西。
                        yield sse(
                            "attachment.ready",
                            {"attachmentId": attachment_id},
                        )
                    yield task_sse("progress", step, step_sequence)
                    async with self.session_maker() as db:
                        await update_task(db, task_id, "progress")
                    if step is not None and step.risk_level == "high":
                        # 高风险操作真的执行完了，这是值得记住的经历
                        # （架构文档 §9）。只记语义摘要，不记 payload。
                        high_risk_steps.append(step.safe_summary)
            stream_completed = True
        except asyncio.CancelledError:
            interruption_reason = "client_disconnected"
            raise
        except GeneratorExit:
            interruption_reason = "client_disconnected"
            raise
        except Exception as error:
            interruption_reason = type(error).__name__
            task_failed = True
            async with self.session_maker() as db:
                await update_task(db, task_id, "failed", result_summary="任务执行失败")
            # 中断类异常（CancelledError / GeneratorExit）在上面先行拦下：那两种
            # 情况下消费端已经断开，再 yield 不会送达，只会污染关闭流程。
            yield task_sse("failed", sequence=step_sequence)
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
                if not task_failed:
                    try:
                        cancel_task = asyncio.create_task(self._cancel_task(task_id))
                    except RuntimeError:
                        cancel_task = None
                    if cancel_task is not None:
                        self._background_tasks.add(cancel_task)
                        cancel_task.add_done_callback(self._background_tasks.discard)
                        try:
                            await asyncio.shield(cancel_task)
                        except asyncio.CancelledError:
                            logger.info(
                                "Task cancellation persistence continues after disconnect",
                                extra={"task_id": task_id},
                            )

        answer = guard_action_claims(
            "".join(answer_parts).strip(),
            has_committed_receipt=bool(committed_receipt_ids),
        )
        if answer:
            yield sse("text.delta", {"delta": answer})
        assistant_message, message_count = await self._persist_assistant(
            user_id,
            conversation.id,
            answer,
            metadata=(
                {
                    **({"attachmentIds": produced_attachments} if produced_attachments else {}),
                    **(
                        {"actionReceiptIds": committed_receipt_ids} if committed_receipt_ids else {}
                    ),
                }
                if produced_attachments or committed_receipt_ids
                else None
            ),
        )
        if high_risk_steps:
            await self._record_high_risk(conversation.companion_id, high_risk_steps)
        if self.job_queue is not None:
            user_turn = (message_count + 1) // 2
            tasks = []
            tasks.append(("memory.extract", user_message.id))
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
        async with self.session_maker() as db:
            await update_task(
                db,
                task_id,
                "succeeded",
                result_summary=f"完成对话；执行 {step_sequence} 个工具步骤",
            )
        # 带上步骤数：只回了一句话（sequence == 0）和真的动了站内数据是两回事，
        # 前端据此决定要不要庆祝，避免每轮对话都放一次烟花。
        yield task_sse("succeeded", sequence=step_sequence)
        yield sse(
            "message.completed",
            {
                "conversationId": conversation.id,
                "messageId": assistant_message.id,
            },
        )
