"""服务器文档理解与渲染适配器。

正式部署走独立 Docling Serve 和 Gotenberg；API/Agent 进程不加载 OCR 模型，也不
在客户端运行任何文档 Agent。内置解析器只用于单测和极简开发环境，并在结果里
明确标记 ``builtin-degraded``，避免把浅解析伪装成完整理解。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import httpx

from app.attachment_processing import extract_text
from app.config import Settings

OFFICE_EXTENSIONS = {"doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp"}


def _suffix(filename: str) -> str:
    return filename.lower().rsplit(".", 1)[-1] if "." in filename else ""


@dataclass(frozen=True)
class DocumentUnderstanding:
    text: str | None
    document_ir: dict[str, Any] | None
    parser: str
    processing_metadata: dict[str, Any] = field(default_factory=dict)


async def understand_document(
    content: bytes,
    content_type: str,
    filename: str,
    settings: Settings,
) -> DocumentUnderstanding:
    if settings.document_parser_url:
        return await _docling_understand(content, content_type, filename, settings)
    text = extract_text(
        content,
        content_type,
        filename,
        max_chars=settings.attachment_extracted_text_chars,
        max_pdf_pages=settings.attachment_max_pdf_pages,
        max_office_uncompressed_bytes=settings.attachment_max_office_uncompressed_bytes,
        max_workbook_sheets=settings.attachment_max_workbook_sheets,
        max_workbook_rows=settings.attachment_max_workbook_rows,
        max_workbook_cells=settings.attachment_max_workbook_cells,
    )
    return DocumentUnderstanding(
        text=text,
        document_ir=(
            {
                "schemaVersion": "1.0",
                "format": _suffix(filename) or content_type,
                "parser": "builtin-degraded",
                "text": text,
            }
            if text is not None
            else None
        ),
        parser="builtin-degraded",
        processing_metadata={"degraded": True},
    )


async def _docling_understand(
    content: bytes,
    content_type: str,
    filename: str,
    settings: Settings,
) -> DocumentUnderstanding:
    url = f"{settings.document_parser_url.rstrip('/')}/v1/convert/file"
    headers = {}
    if settings.document_parser_api_key:
        headers["X-Api-Key"] = settings.document_parser_api_key
    form = {
        "to_formats": ["md", "json", "text"],
        "image_export_mode": "placeholder",
        "do_ocr": "true",
        "do_table_structure": "true",
        "table_mode": "accurate",
        "include_images": "true",
        "include_page_images": "false",
        "abort_on_error": "false",
    }
    async with httpx.AsyncClient(timeout=settings.document_parser_timeout) as client:
        response = await client.post(
            url,
            headers=headers,
            data=form,
            files={"files": (filename, content, content_type)},
        )
    response.raise_for_status()
    payload = response.json()
    status_value = payload.get("status")
    if status_value not in {"success", "partial_success"}:
        errors = payload.get("errors") or []
        raise ValueError(f"Docling 解析失败：{str(errors)[:1000]}")
    document = payload.get("document")
    if not isinstance(document, dict):
        raise ValueError("Docling 响应缺少 document")
    document_ir = document.get("json_content")
    if not isinstance(document_ir, dict):
        document_ir = None
    text = document.get("text_content") or document.get("md_content")
    if not isinstance(text, str):
        text = None
    if text is not None:
        text = text[: settings.attachment_extracted_text_chars]
    if text is None and document_ir is None:
        raise ValueError("Docling 没有返回可用文本或 Document IR")
    return DocumentUnderstanding(
        text=text,
        document_ir=document_ir,
        parser="docling-v1",
        processing_metadata={
            "status": status_value,
            "processingTime": payload.get("processing_time"),
            "timings": payload.get("timings") or {},
            "errors": payload.get("errors") or [],
        },
    )


async def render_preview_pdf(
    content: bytes,
    content_type: str,
    filename: str,
    settings: Settings,
) -> bytes | None:
    """用服务器 Gotenberg 将 Office Artifact 渲染为 PDF；其它格式不重复转换。"""
    if not settings.document_renderer_url or _suffix(filename) not in OFFICE_EXTENSIONS:
        return None
    url = f"{settings.document_renderer_url.rstrip('/')}/forms/libreoffice/convert"
    async with httpx.AsyncClient(timeout=settings.document_renderer_timeout) as client:
        response = await client.post(
            url,
            files={"files": (filename, content, content_type)},
            data={"exportNotes": "true", "exportHiddenSlides": "true"},
        )
    response.raise_for_status()
    if response.headers.get("content-type", "").split(";", 1)[0] != "application/pdf":
        raise ValueError("Gotenberg 没有返回 PDF 预览")
    return response.content
