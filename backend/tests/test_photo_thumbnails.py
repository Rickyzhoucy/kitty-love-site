from pathlib import Path

import pytest

from app.cli import legacy_photo_path
from app.photo_service import legacy_photo_thumbnail_key, photo_thumbnail_url


def test_photo_thumbnail_paths_are_versioned(tmp_path: Path):
    source = tmp_path / "dated photo.jpg"
    source.write_bytes(b"photo")

    assert legacy_photo_path(tmp_path, "/uploads/dated%20photo.jpg") == source
    assert photo_thumbnail_url("photo-1") == "/api/v1/photos/photo-1/thumbnail?v=1"
    assert legacy_photo_thumbnail_key("photo-1") == (
        "legacy-photo/photo-1/thumbnail-v1.webp"
    )


def test_legacy_photo_path_rejects_escape(tmp_path: Path):
    with pytest.raises(ValueError, match="越过"):
        legacy_photo_path(tmp_path, "/uploads/../secret.jpg")
