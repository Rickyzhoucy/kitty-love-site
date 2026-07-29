from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

import pytest

from app.attachment_processing import extract_text

LIMITS = {
    "max_chars": 20,
    "max_pdf_pages": 5,
    "max_office_uncompressed_bytes": 100,
    "max_workbook_sheets": 2,
    "max_workbook_rows": 10,
    "max_workbook_cells": 100,
}


def test_text_extraction_stops_at_character_limit() -> None:
    result = extract_text(
        "这是一个很长的附件内容，用来验证字符截断。".encode(),
        "text/plain",
        "note.txt",
        **LIMITS,
    )
    assert result is not None
    assert len(result) <= LIMITS["max_chars"]


def test_office_archive_rejects_excessive_expanded_size() -> None:
    archive_bytes = BytesIO()
    with ZipFile(archive_bytes, "w", ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", "x" * 101)

    with pytest.raises(ValueError, match="解压后超过处理上限"):
        extract_text(
            archive_bytes.getvalue(),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "oversized.docx",
            **LIMITS,
        )
