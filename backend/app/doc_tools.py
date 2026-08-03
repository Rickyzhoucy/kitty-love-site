"""把生成的文档落库成附件，交给用户下载。

生成逻辑在 `document_builder`，这里只负责持久化与登记——两者分开是为了让
生成部分可以脱离数据库和对象存储单测。
"""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Any

from langchain.tools import ToolRuntime, tool
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings, get_settings
from app.document_builder import DocumentSpecError, build_document
from app.document_services import render_preview_pdf
from app.models import Attachment
from app.storage import ObjectStorage

logger = logging.getLogger(__name__)

SPEC_HELP = """按结构化规格生成 Word / PPT / Excel 文件，返回下载链接。

kind: docx | pptx | xlsx
title: 文档标题
blocks: 内容块数组，结构随 kind 变化——
  docx: {"type":"heading","level":1,"text":""} / {"type":"paragraph","text":""}
        / {"type":"bullets","items":[]} / {"type":"numbers","items":[]}
        / {"type":"quote","text":""} / {"type":"table","rows":[[]]}
  pptx: 每个块是一页 {"title":"","bullets":[],"notes":"备注"}
  xlsx: 每个块是一张表 {"sheet":"表名","rows":[["表头"],["数据"]]}
        第一行会被加粗当表头。
"""


async def persist_document(
    db: AsyncSession,
    storage: ObjectStorage,
    settings: Settings,
    user_id: str,
    filename: str,
    content_type: str,
    content: bytes,
    document_ir: dict[str, Any] | None = None,
) -> Attachment:
    """写进对象存储并登记为附件。

    直接建 Attachment 记录而不走 presign + complete 那套：那套是给**浏览器
    直传**用的，服务端自己生成的字节没必要绕一圈出去再回来。
    """
    object_key = storage.build_object_key(user_id, filename)
    await storage.put_bytes(
        settings.minio_user_bucket, object_key, content, content_type
    )
    attachment = Attachment(
        owner_id=user_id,
        bucket=settings.minio_user_bucket,
        object_key=object_key,
        filename=filename,
        content_type=content_type,
        size=len(content),
        sha256=hashlib.sha256(content).hexdigest(),
        status="ready",
        artifact_kind="generated",
        parser="kitty-ooxml-v1",
        processing_metadata={"generator": "kitty-ooxml-v1"},
        # 自己生成的文件不需要再解析一遍取文本——内容本来就是我们写进去的。
        parse_status="ready",
    )
    if document_ir is not None:
        encoded_ir = json.dumps(document_ir, ensure_ascii=False, separators=(",", ":")).encode()
        if len(encoded_ir) > settings.document_ir_max_bytes:
            raise ValueError("生成文档的 Document IR 超过存储上限")
        attachment.derived_bucket = settings.minio_derived_bucket
        attachment.document_ir_key = f"{user_id}/{attachment.id}/document-ir.json"
        await storage.put_bytes(
            attachment.derived_bucket,
            attachment.document_ir_key,
            encoded_ir,
            "application/json",
        )
    try:
        preview = await render_preview_pdf(content, content_type, filename, settings)
    except Exception as error:
        logger.warning("生成文档预览失败：%s", error)
        preview = None
        attachment.processing_metadata = {
            **attachment.processing_metadata,
            "renderer": {"status": "failed", "error": str(error)[:1000]},
        }
    if preview is not None:
        attachment.derived_bucket = settings.minio_derived_bucket
        attachment.preview_key = f"{user_id}/{attachment.id}/preview.pdf"
        await storage.put_bytes(
            attachment.derived_bucket,
            attachment.preview_key,
            preview,
            "application/pdf",
        )
        attachment.processing_metadata = {
            **attachment.processing_metadata,
            "renderer": {"status": "ready", "engine": "gotenberg"},
        }
    db.add(attachment)
    await db.commit()
    await db.refresh(attachment)
    return attachment


def build_document_tools(
    session_maker: async_sessionmaker[AsyncSession],
    storage: ObjectStorage | None = None,
    settings: Settings | None = None,
) -> list:
    config = settings or get_settings()
    object_storage = storage or ObjectStorage(config)

    @tool("create_document", description=SPEC_HELP)
    async def create_document(
        runtime: ToolRuntime,
        kind: str,
        title: str,
        blocks: list[dict[str, Any]],
        filename: str | None = None,
    ) -> str:
        try:
            built = build_document(kind, title, blocks, filename)
        except DocumentSpecError as error:
            # 规格问题原样告诉模型，让它自己改一版重试，而不是抛异常中断整轮。
            return f"规格有问题：{error}"
        except Exception:
            logger.exception("文档生成失败 kind=%s", kind)
            return "文档生成失败了。"

        if len(built.content) > config.max_upload_bytes:
            return "生成的文件太大了，把内容拆成几份再试。"

        async with session_maker() as db:
            attachment = await persist_document(
                db,
                object_storage,
                config,
                runtime.context.user_id,
                built.filename,
                built.content_type,
                built.content,
                {
                    "schemaVersion": "1.0",
                    "format": kind,
                    "title": title,
                    "blocks": blocks,
                    "generator": "kitty-ooxml-v1",
                },
            )
        return json.dumps(
            {
                "attachmentId": attachment.id,
                "filename": attachment.filename,
                "size": attachment.size,
                "downloadUrl": f"/api/v1/attachments/{attachment.id}/content",
            },
            ensure_ascii=False,
        )

    return [create_document]
