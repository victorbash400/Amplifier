from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
import mimetypes
from pathlib import Path
import subprocess
import tempfile
from collections.abc import Awaitable, Callable

from google import genai
from google.genai import types
from google.cloud import storage
from pydantic import BaseModel, Field

from app.clickhouse import clickhouse_client
from app.config import settings


SEARCH_SCHEMA_VERSION = 2
SEARCH_EMBEDDING_MODEL = "gemini-embedding-2"
SEARCH_ANALYSIS_MODEL = "gemini-3-flash-preview"
SEARCH_VECTOR_DIMENSIONS = 768
STALE_INDEX_AFTER = timedelta(minutes=10)

_schema_lock = asyncio.Lock()
_schema_ready = False
_asset_locks: dict[tuple[str, str], asyncio.Lock] = {}


class MomentDraft(BaseModel):
    start: float = Field(ge=0)
    end: float = Field(ge=0)
    description: str = Field(min_length=1, max_length=3000)
    transcript: str = Field(default="", max_length=3000)


class MomentAnalysis(BaseModel):
    moments: list[MomentDraft] = Field(min_length=1, max_length=80)


ProgressCallback = Callable[[dict[str, object]], Awaitable[None]]


async def index_asset(*, project_id: str, asset_id: str, object_key: str, name: str, content_type: str, folder_id: str, duration: float | None = None, force: bool = False, on_progress: ProgressCallback | None = None) -> dict[str, object]:
    _validate_asset(project_id, asset_id, object_key, content_type)
    lock = _asset_locks.setdefault((project_id, asset_id), asyncio.Lock())
    async with lock:
        return await _index_asset_locked(project_id=project_id, asset_id=asset_id, object_key=object_key, name=name, content_type=content_type, folder_id=folder_id, duration=duration, force=force, on_progress=on_progress)


async def _index_asset_locked(*, project_id: str, asset_id: str, object_key: str, name: str, content_type: str, folder_id: str, duration: float | None, force: bool, on_progress: ProgressCallback | None) -> dict[str, object]:
    existing = await _asset_index_state(project_id, asset_id)
    if existing and not force and existing[0] in {"ready", "indexing", "failed"}:
        return {"asset_id": asset_id, "status": existing[0], "stage": existing[1], "error": existing[2], "reused": True}
    await _write_index_row(project_id=project_id, asset_id=asset_id, object_key=object_key, name=name, content_type=content_type, folder_id=folder_id, status="indexing", stage="Analyzing moments")
    await _progress(on_progress, asset_id, "indexing", "Analyzing moments", 0)
    try:
        moments = await _analyze_moments(object_key, name, content_type, duration)
        document = " ".join(moment.description for moment in moments)[:6000]
        await _write_index_row(project_id=project_id, asset_id=asset_id, object_key=object_key, name=name, content_type=content_type, folder_id=folder_id, status="indexing", stage="Creating moment embeddings", document=document)
        await _progress(on_progress, asset_id, "indexing", "Creating moment embeddings", 25)
        embeddings = await _embed_documents([f"{name}. {moment.description}. {moment.transcript}" for moment in moments])
        await _write_index_row(project_id=project_id, asset_id=asset_id, object_key=object_key, name=name, content_type=content_type, folder_id=folder_id, status="indexing", stage="Rendering previews", document=document)
        await _progress(on_progress, asset_id, "indexing", "Rendering previews", 50)
        thumbnail_keys = await asyncio.to_thread(_render_moment_previews, project_id, asset_id, object_key, content_type, moments)
        await _progress(on_progress, asset_id, "indexing", "Saving searchable moments", 75)
        await _replace_moments(project_id=project_id, asset_id=asset_id, object_key=object_key, name=name, content_type=content_type, folder_id=folder_id, moments=moments, embeddings=embeddings, thumbnail_keys=thumbnail_keys)
        await _write_index_row(project_id=project_id, asset_id=asset_id, object_key=object_key, name=name, content_type=content_type, folder_id=folder_id, status="ready", stage=f"Ready · {len(moments)} moments", document=document)
        result = {"asset_id": asset_id, "status": "ready", "stage": f"Ready · {len(moments)} moments", "progress": 100, "moments": len(moments)}
        await _progress(on_progress, asset_id, "ready", result["stage"], 100)
        return result
    except Exception as error:
        await _write_index_row(project_id=project_id, asset_id=asset_id, object_key=object_key, name=name, content_type=content_type, folder_id=folder_id, status="failed", stage="Failed", error=str(error)[:500])
        raise


async def _progress(callback: ProgressCallback | None, asset_id: str, status: str, stage: object, progress: int) -> None:
    if callback:
        await callback({"asset_id": asset_id, "status": status, "stage": str(stage), "progress": progress})


async def index_status(project_id: str) -> list[dict[str, object]]:
    client = await clickhouse_client()
    try:
        await _ensure_schema(client)
        result = await client.query(
            "SELECT asset_id, asset_name, status, stage, error, updated_at FROM asset_search_index FINAL WHERE project_id = {project_id:String} AND schema_version = {schema_version:UInt16}",
            parameters={"project_id": project_id, "schema_version": SEARCH_SCHEMA_VERSION},
        )
        now = datetime.now(timezone.utc)
        states = []
        for row in result.result_rows:
            updated_at = row[5].replace(tzinfo=timezone.utc) if row[5].tzinfo is None else row[5]
            stale = row[2] == "indexing" and now - updated_at > STALE_INDEX_AFTER
            states.append({"asset_id": row[0], "name": row[1], "status": "failed" if stale else row[2], "stage": "Interrupted" if stale else row[3], "updated_at": updated_at.isoformat(), **({"error": "Indexing was interrupted; retry this file"} if stale else ({"error": row[4]} if row[4] else {}))})
        return states
    finally:
        await client.close()


async def search_assets(project_id: str, query: str, limit: int = 18) -> list[dict[str, object]]:
    clean_query = " ".join(query.split())
    if len(clean_query) < 2 or len(clean_query) > 240:
        raise ValueError("Media search query must be between 2 and 240 characters")
    embedding = await embed_query(clean_query)
    client = await clickhouse_client()
    try:
        await _ensure_schema(client)
        result = await client.query(
            """
            SELECT moment_id, asset_id, asset_name, object_key, content_type, folder_id, thumbnail_key,
                   start, end, description, transcript,
                   1 - cosineDistance(embedding, {embedding:Array(Float32)}) AS score
            FROM asset_search_moments FINAL
            WHERE project_id = {project_id:String} AND schema_version = {schema_version:UInt16}
              AND length(embedding) = {dimensions:UInt16}
              AND asset_id IN (
                SELECT asset_id FROM asset_search_index FINAL
                WHERE project_id = {project_id:String} AND status = 'ready' AND schema_version = {schema_version:UInt16}
              )
            ORDER BY score DESC
            LIMIT {limit:UInt16}
            """,
            parameters={"embedding": embedding, "project_id": project_id, "schema_version": SEARCH_SCHEMA_VERSION, "dimensions": SEARCH_VECTOR_DIMENSIONS, "limit": limit},
        )
        return [{"moment_id": row[0], "asset_id": row[1], "asset_name": row[2], "object_key": row[3], "content_type": row[4], "folder_id": row[5], "thumbnail_key": row[6], "start": float(row[7]), "end": float(row[8]), "description": row[9], "transcript": row[10], "score": round(float(row[11]), 4)} for row in result.result_rows]
    finally:
        await client.close()


async def remove_asset_index(*, project_id: str, asset_id: str) -> None:
    client = await clickhouse_client()
    try:
        await _ensure_schema(client)
        parameters = {"project_id": project_id, "asset_id": asset_id}
        await client.command("DELETE FROM asset_search_moments WHERE project_id = {project_id:String} AND asset_id = {asset_id:String}", parameters=parameters)
        await client.command("DELETE FROM asset_search_index WHERE project_id = {project_id:String} AND asset_id = {asset_id:String}", parameters=parameters)
    finally:
        await client.close()


async def embed_query(value: str) -> list[float]:
    return (await _embed_contents([f"media search query: {value}"]))[0]


async def _embed_documents(documents: list[str]) -> list[list[float]]:
    return await _embed_contents([f"searchable media moment: {document}" for document in documents])


async def _embed_contents(contents: list[str]) -> list[list[float]]:
    client = genai.Client(vertexai=True, project=settings.google_cloud_project, location=settings.google_cloud_location)
    semaphore = asyncio.Semaphore(4)
    async def embed(content: str) -> list[float]:
        async with semaphore:
            response = await client.aio.models.embed_content(model=SEARCH_EMBEDDING_MODEL, contents=content, config=types.EmbedContentConfig(output_dimensionality=SEARCH_VECTOR_DIMENSIONS))
        values = response.embeddings[0].values if response.embeddings else None
        return _normalized_vector(values)
    try:
        embeddings = await asyncio.gather(*(embed(content) for content in contents))
    finally:
        await client.aio.aclose()
    return embeddings


async def _analyze_moments(object_key: str, name: str, content_type: str, duration: float | None) -> list[MomentDraft]:
    client = genai.Client(vertexai=True, project=settings.google_cloud_project, location=settings.google_cloud_location)
    duration_note = f"The media duration is {duration:.3f} seconds." if duration and math.isfinite(duration) else "Infer the media duration."
    prompt = (
        "Divide this media into precise, searchable timestamped moments. Each moment should cover one distinct visible action, scene, spoken passage, sound, or music event. "
        "Use seconds for start and end. Include visible subjects, actions, setting, on-screen text, sounds, music, and accessibility-relevant details. "
        "For every moment containing speech or lyrics, put the exact spoken or sung words in transcript, including a speaker label when identifiable. Leave transcript empty only when no words are audible. "
        "Keep each description concise. For an image return one moment with start and end both zero. Do not invent content. Return at most 40 moments. "
        "Return one JSON object with a moments array. Every moment must contain numeric start and end values plus string description and transcript values. "
        f"The file is named {name}. {duration_note}"
    )
    try:
        response = await client.aio.models.generate_content(
            model=SEARCH_ANALYSIS_MODEL,
            contents=[types.Part.from_uri(file_uri=f"gs://{settings.gcs_bucket}/{object_key}", mime_type=content_type), types.Part.from_text(text=prompt)],
            config=types.GenerateContentConfig(temperature=0.1, max_output_tokens=8192, response_mime_type="application/json"),
        )
    finally:
        await client.aio.aclose()
    try:
        value = json.loads(_json_text(response.text or ""))
        payload = _normalize_moment_payload(value, duration)
        analysis = MomentAnalysis.model_validate(payload)
    except (json.JSONDecodeError, ValueError) as error:
        detail = str(error).replace("\n", " ")[:350]
        raise RuntimeError(f"Gemini returned invalid timestamped moments: {detail}") from error
    moments = []
    for moment in analysis.moments:
        if content_type.startswith("image/"):
            moments.append(moment.model_copy(update={"start": 0.0, "end": 0.0}))
            continue
        if moment.end <= moment.start:
            continue
        end = min(moment.end, duration) if duration and math.isfinite(duration) else moment.end
        if end > moment.start:
            moments.append(moment.model_copy(update={"end": end}))
    if not moments:
        raise RuntimeError("Gemini returned no valid searchable moments")
    return moments[:80]


def _json_text(value: str) -> str:
    clean = value.strip()
    if clean.startswith("```"):
        clean = clean.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    return clean


def _normalize_moment_payload(value: object, duration: float | None) -> dict[str, object]:
    if isinstance(value, list):
        raw_moments = value
    elif isinstance(value, dict):
        raw_moments = next((value[key] for key in ("moments", "segments", "scenes") if isinstance(value.get(key), list)), None)
    else:
        raw_moments = None
    if not isinstance(raw_moments, list):
        raise ValueError("response has no moments array")
    normalized: list[dict[str, object]] = []
    for index, item in enumerate(raw_moments):
        if not isinstance(item, dict):
            continue
        start = _seconds(_first(item, "start", "start_time", "startTime", "begin", "begin_time"))
        end = _seconds(_first(item, "end", "end_time", "endTime", "finish", "finish_time"))
        if start is None:
            continue
        if end is None:
            next_start = _next_start(raw_moments, index + 1)
            end = next_start if next_start is not None else duration if duration and math.isfinite(duration) else start
        transcript = _text(_first(item, "transcript", "speech", "dialogue", "caption"))
        description = _text(_first(item, "description", "summary", "scene_description", "sceneDescription", "content", "text")) or transcript
        if not description:
            continue
        normalized.append({"start": start, "end": end, "description": description, "transcript": transcript})
    if not normalized:
        raise ValueError("response contains no usable moments")
    return {"moments": normalized}


def _first(item: dict[object, object], *keys: str) -> object | None:
    return next((item[key] for key in keys if key in item), None)


def _next_start(items: list[object], index: int) -> float | None:
    for item in items[index:]:
        if isinstance(item, dict):
            value = _seconds(_first(item, "start", "start_time", "startTime", "begin", "begin_time"))
            if value is not None:
                return value
    return None


def _seconds(value: object) -> float | None:
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return max(0.0, float(value))
    if not isinstance(value, str):
        return None
    clean = value.strip().lower().removesuffix("s")
    try:
        parts = [float(part) for part in clean.split(":")]
    except ValueError:
        return None
    if len(parts) == 1:
        return max(0.0, parts[0])
    if len(parts) > 3:
        return None
    return max(0.0, sum(part * (60 ** position) for position, part in enumerate(reversed(parts))))


def _text(value: object) -> str:
    if isinstance(value, str):
        return value.strip()[:3000]
    if isinstance(value, list):
        return " ".join(str(part).strip() for part in value if str(part).strip())[:3000]
    return ""


async def _replace_moments(*, project_id: str, asset_id: str, object_key: str, name: str, content_type: str, folder_id: str, moments: list[MomentDraft], embeddings: list[list[float]], thumbnail_keys: list[str]) -> None:
    client = await clickhouse_client()
    try:
        await _ensure_schema(client)
        await client.command("DELETE FROM asset_search_moments WHERE project_id = {project_id:String} AND asset_id = {asset_id:String}", parameters={"project_id": project_id, "asset_id": asset_id})
        now = datetime.now(timezone.utc)
        rows = []
        for moment, embedding, thumbnail_key in zip(moments, embeddings, thumbnail_keys, strict=True):
            moment_id = hashlib.sha256(f"{asset_id}:{moment.start:.3f}:{moment.end:.3f}:{SEARCH_SCHEMA_VERSION}".encode()).hexdigest()
            rows.append([project_id, asset_id, moment_id, object_key, name, content_type, folder_id, thumbnail_key, moment.start, moment.end, moment.description, moment.transcript, embedding, SEARCH_EMBEDDING_MODEL, SEARCH_ANALYSIS_MODEL, SEARCH_SCHEMA_VERSION, now])
        await client.insert("asset_search_moments", rows, column_names=["project_id", "asset_id", "moment_id", "object_key", "asset_name", "content_type", "folder_id", "thumbnail_key", "start", "end", "description", "transcript", "embedding", "embedding_model", "analysis_model", "schema_version", "updated_at"])
    finally:
        await client.close()


async def _asset_index_state(project_id: str, asset_id: str) -> tuple[str, str, str] | None:
    client = await clickhouse_client()
    try:
        await _ensure_schema(client)
        result = await client.query("SELECT status, stage, error FROM asset_search_index FINAL WHERE project_id = {project_id:String} AND asset_id = {asset_id:String} AND schema_version = {schema_version:UInt16} LIMIT 1", parameters={"project_id": project_id, "asset_id": asset_id, "schema_version": SEARCH_SCHEMA_VERSION})
        return tuple(str(value) for value in result.result_rows[0]) if result.result_rows else None
    finally:
        await client.close()


async def _write_index_row(*, project_id: str, asset_id: str, object_key: str, name: str, content_type: str, folder_id: str, status: str, stage: str = "", document: str = "", error: str = "") -> None:
    client = await clickhouse_client()
    try:
        await _ensure_schema(client)
        await client.insert("asset_search_index", [[project_id, asset_id, object_key, name, content_type, folder_id, status, stage, document, [], SEARCH_EMBEDDING_MODEL, SEARCH_ANALYSIS_MODEL, SEARCH_SCHEMA_VERSION, error, datetime.now(timezone.utc)]], column_names=["project_id", "asset_id", "object_key", "asset_name", "content_type", "folder_id", "status", "stage", "document", "embedding", "embedding_model", "analysis_model", "schema_version", "error", "updated_at"])
    finally:
        await client.close()


async def _ensure_schema(client) -> None:
    global _schema_ready
    if _schema_ready:
        return
    async with _schema_lock:
        if _schema_ready:
            return
        await client.command("""CREATE TABLE IF NOT EXISTS asset_search_index (project_id String, asset_id String, object_key String, asset_name String, content_type LowCardinality(String), folder_id String, status LowCardinality(String), stage LowCardinality(String), document String, embedding Array(Float32), embedding_model LowCardinality(String), analysis_model LowCardinality(String), schema_version UInt16, error String, updated_at DateTime64(3, 'UTC'), INDEX status_values status TYPE set(16) GRANULARITY 1, INDEX document_tokens document TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 1) ENGINE = ReplacingMergeTree(updated_at) ORDER BY (project_id, asset_id)""")
        await client.command("ALTER TABLE asset_search_index ADD COLUMN IF NOT EXISTS stage LowCardinality(String) AFTER status")
        await client.command("ALTER TABLE asset_search_index ADD INDEX IF NOT EXISTS status_values status TYPE set(16) GRANULARITY 1")
        await client.command("""CREATE TABLE IF NOT EXISTS asset_search_moments (project_id String, asset_id String, moment_id String, object_key String, asset_name String, content_type LowCardinality(String), folder_id String, thumbnail_key String, start Float64, end Float64, description String, transcript String, embedding Array(Float32), embedding_model LowCardinality(String), analysis_model LowCardinality(String), schema_version UInt16, updated_at DateTime64(3, 'UTC'), INDEX content_type_values content_type TYPE set(16) GRANULARITY 1, INDEX moment_text_tokens description TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 1, INDEX transcript_tokens transcript TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 1) ENGINE = ReplacingMergeTree(updated_at) ORDER BY (project_id, asset_id, moment_id)""")
        await client.command("ALTER TABLE asset_search_moments ADD COLUMN IF NOT EXISTS thumbnail_key String AFTER folder_id")
        await client.command("ALTER TABLE asset_search_moments ADD INDEX IF NOT EXISTS content_type_values content_type TYPE set(16) GRANULARITY 1")
        await client.command("ALTER TABLE asset_search_moments ADD INDEX IF NOT EXISTS transcript_tokens transcript TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 1")
        _schema_ready = True


def _render_moment_previews(project_id: str, asset_id: str, object_key: str, content_type: str, moments: list[MomentDraft]) -> list[str]:
    suffix = mimetypes.guess_extension(content_type) or ".media"
    storage_client = storage.Client(project=settings.google_cloud_project)
    bucket = storage_client.bucket(settings.gcs_bucket)
    with tempfile.NamedTemporaryFile(prefix="amplifier-search-source-", suffix=suffix, delete=False) as temporary:
        source = Path(temporary.name)
    try:
        bucket.blob(object_key).download_to_filename(source)
        keys = []
        for index, moment in enumerate(moments, start=1):
            digest = hashlib.sha256(f"{asset_id}:{moment.start:.3f}:{moment.end:.3f}:{SEARCH_SCHEMA_VERSION}".encode()).hexdigest()
            key = f"projects/{project_id}/search/moments/v{SEARCH_SCHEMA_VERSION}/{asset_id}/{index:04d}-{digest[:12]}.jpg"
            preview = _render_preview(source, content_type, moment.start, moment.end)
            bucket.blob(key).upload_from_string(preview, content_type="image/jpeg")
            keys.append(key)
        return keys
    finally:
        source.unlink(missing_ok=True)


def _render_preview(source: Path, content_type: str, start: float, end: float) -> bytes:
    with tempfile.NamedTemporaryFile(prefix="amplifier-search-preview-", suffix=".jpg", delete=False) as temporary:
        output = Path(temporary.name)
    try:
        if content_type.startswith("video/"):
            time = start if end <= start else start + (end - start) / 2
            command = ["ffmpeg", "-v", "error", "-ss", f"{time:.3f}", "-i", str(source), "-frames:v", "1", "-vf", "scale=320:-2", "-c:v", "mjpeg", "-q:v", "5", "-y", str(output)]
        elif content_type.startswith("audio/"):
            command = ["ffmpeg", "-v", "error", "-ss", f"{start:.3f}", "-t", f"{max(.25, end - start):.3f}", "-i", str(source), "-filter_complex", "showwavespic=s=320x96:colors=white,negate", "-frames:v", "1", "-c:v", "mjpeg", "-q:v", "5", "-y", str(output)]
        else:
            command = ["ffmpeg", "-v", "error", "-i", str(source), "-frames:v", "1", "-vf", "scale=320:-2", "-c:v", "mjpeg", "-q:v", "5", "-y", str(output)]
        result = subprocess.run(command, capture_output=True, text=True, timeout=45, check=False)
        if result.returncode or not output.exists() or output.stat().st_size < 1:
            raise RuntimeError((result.stderr or "Could not render moment preview").strip()[-400:])
        return output.read_bytes()
    finally:
        output.unlink(missing_ok=True)


def _normalized_vector(values: list[float] | None) -> list[float]:
    if not values or len(values) != SEARCH_VECTOR_DIMENSIONS or not all(math.isfinite(number) for number in values):
        raise RuntimeError("Gemini returned an invalid moment embedding")
    magnitude = math.sqrt(sum(number * number for number in values))
    if magnitude <= 0:
        raise RuntimeError("Gemini returned an empty moment embedding")
    return [round(number / magnitude, 8) for number in values]


def _validate_asset(project_id: str, asset_id: str, object_key: str, content_type: str) -> None:
    if not object_key.startswith(f"projects/{project_id}/assets/{asset_id}/"):
        raise ValueError("Media search asset does not belong to this project")
    if not content_type.startswith(("video/", "audio/", "image/")):
        raise ValueError("Media search supports video, audio, and images")
