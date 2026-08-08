from __future__ import annotations

import re
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from google.cloud import storage

from app.config import settings


@dataclass(frozen=True)
class StoredAsset:
    object_key: str
    generation: str
    size: int
    content_type: str
    has_audio: bool | None


@dataclass(frozen=True)
class AssetStream:
    body: Iterator[bytes]
    content_type: str
    end: int
    generation: str
    size: int
    start: int


def create_upload_session(
    *,
    project_id: str,
    asset_id: str,
    file_name: str,
    content_type: str,
    size: int,
    origin: str | None,
) -> tuple[str, str]:
    object_key = asset_object_key(project_id, asset_id, file_name)
    blob = storage.Client(project=settings.google_cloud_project).bucket(settings.gcs_bucket).blob(object_key)
    blob.metadata = {"project_id": project_id, "asset_id": asset_id, "original_name": file_name}
    upload_url = blob.create_resumable_upload_session(
        content_type=content_type,
        size=size,
        origin=origin,
        if_generation_match=0,
    )
    return upload_url, object_key


def verify_uploaded_asset(*, project_id: str, asset_id: str, file_name: str, expected_size: int) -> StoredAsset:
    object_key = asset_object_key(project_id, asset_id, file_name)
    blob = storage.Client(project=settings.google_cloud_project).bucket(settings.gcs_bucket).blob(object_key)
    blob.reload()
    if blob.size != expected_size:
        raise ValueError(f"Uploaded object size is {blob.size}; expected {expected_size}")
    content_type = blob.content_type or "application/octet-stream"
    return StoredAsset(
        object_key=object_key,
        generation=str(blob.generation or ""),
        size=int(blob.size or 0),
        content_type=content_type,
        has_audio=_probe_audio_stream(blob) if content_type.startswith("video/") else None,
    )


def _probe_audio_stream(blob: storage.Blob) -> bool:
    with tempfile.NamedTemporaryFile(prefix="amplifier-upload-probe-", suffix=Path(blob.name).suffix, delete=False) as temporary:
        source = Path(temporary.name)
    try:
        blob.download_to_filename(source)
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=index", "-of", "csv=p=0", str(source)],
            capture_output=True,
            text=True,
            timeout=90,
            check=False,
        )
        if result.returncode:
            raise RuntimeError((result.stderr or "FFprobe could not inspect uploaded video").strip()[-400:])
        return bool(result.stdout.strip())
    finally:
        source.unlink(missing_ok=True)


def asset_object_key(project_id: str, asset_id: str, file_name: str) -> str:
    safe_name = re.sub(r"[^a-zA-Z0-9._-]+", "-", file_name).strip("-.")[:180]
    if not safe_name:
        raise ValueError("File name is invalid")
    return f"projects/{project_id}/assets/{asset_id}/{safe_name}"


def open_asset_stream(*, project_id: str, object_key: str, range_header: str | None) -> AssetStream:
    if not object_key.startswith((f"projects/{project_id}/assets/", f"projects/{project_id}/search/")):
        raise ValueError("Asset does not belong to this project")
    blob = storage.Client(project=settings.google_cloud_project).bucket(settings.gcs_bucket).blob(object_key)
    blob.reload()
    size = int(blob.size or 0)
    start, end = byte_range(range_header, size)

    def chunks() -> Iterator[bytes]:
        remaining = end - start + 1
        with blob.open("rb", chunk_size=4 * 1024 * 1024) as source:
            source.seek(start)
            while remaining > 0:
                chunk = source.read(min(4 * 1024 * 1024, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

    return AssetStream(
        body=chunks(),
        content_type=blob.content_type or "application/octet-stream",
        end=end,
        generation=str(blob.generation or ""),
        size=size,
        start=start,
    )


def delete_asset(*, project_id: str, object_key: str) -> None:
    if not object_key.startswith(f"projects/{project_id}/assets/"):
        raise ValueError("Asset does not belong to this project")
    storage.Client(project=settings.google_cloud_project).bucket(settings.gcs_bucket).blob(object_key).delete()


def byte_range(value: str | None, size: int) -> tuple[int, int]:
    if size < 1:
        raise ValueError("Asset is empty")
    if not value:
        return 0, size - 1
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", value.strip())
    if not match:
        raise ValueError("Invalid byte range")
    first, last = match.groups()
    if not first:
        length = int(last)
        if length < 1:
            raise ValueError("Invalid byte range")
        return max(0, size - length), size - 1
    start = int(first)
    end = min(int(last) if last else size - 1, size - 1)
    if start >= size or end < start:
        raise ValueError("Byte range is outside the asset")
    return start, end
