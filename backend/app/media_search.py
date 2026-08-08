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

from app.clickhouse import clickhouse_client
from app.config import settings
from app.media_indexing import INDEX_ANALYSIS_MODEL, IndexedMoment, build_local_index


SEARCH_SCHEMA_VERSION = 3
SEARCH_EMBEDDING_MODEL = "gemini-embedding-2"
SEARCH_ANALYSIS_MODEL = INDEX_ANALYSIS_MODEL
SEARCH_VECTOR_DIMENSIONS = 768
STALE_INDEX_AFTER = timedelta(minutes=10)

_schema_lock = asyncio.Lock()
_schema_ready = False
_asset_locks: dict[tuple[str, str], asyncio.Lock] = {}


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
    await _write_index_row(project_id=project_id, asset_id=asset_id, object_key=object_key, name=name, content_type=content_type, folder_id=folder_id, status="indexing", stage="Downloading source")
    await _progress(on_progress, asset_id, "indexing", "Downloading source", 0)
    source = await asyncio.to_thread(_download_source, object_key, content_type)
    try:
        stage = "Describing image" if content_type.startswith("image/") else "Transcribing and describing"
        await _write_index_row(project_id=project_id, asset_id=asset_id, object_key=object_key, name=name, content_type=content_type, folder_id=folder_id, status="indexing", stage=stage)
        await _progress(on_progress, asset_id, "indexing", stage, 15)
        media_index = await build_local_index(source, content_type, duration)
        moments = media_index.moments
        document = media_index.summary[:6000]
        silence_ranges = json.dumps([item.__dict__ for item in media_index.silence], separators=(",", ":"))
        await _write_index_row(project_id=project_id, asset_id=asset_id, object_key=object_key, name=name, content_type=content_type, folder_id=folder_id, status="indexing", stage="Creating search embeddings", document=document, silence_ranges=silence_ranges)
        await _progress(on_progress, asset_id, "indexing", "Creating search embeddings", 60)
        embeddings = await _embed_documents([f"{name}. {moment.description}. {moment.transcript}" for moment in moments])
        summary_embedding = (await _embed_documents([f"{name}. {document}"]))[0]
        await _write_index_row(project_id=project_id, asset_id=asset_id, object_key=object_key, name=name, content_type=content_type, folder_id=folder_id, status="indexing", stage="Rendering previews", document=document, silence_ranges=silence_ranges, embedding=summary_embedding)
        await _progress(on_progress, asset_id, "indexing", "Rendering previews", 75)
        thumbnail_keys = await asyncio.to_thread(_render_moment_previews, source, project_id, asset_id, content_type, moments)
        await _progress(on_progress, asset_id, "indexing", "Saving searchable moments", 90)
        await _replace_moments(project_id=project_id, asset_id=asset_id, object_key=object_key, name=name, content_type=content_type, folder_id=folder_id, moments=moments, embeddings=embeddings, thumbnail_keys=thumbnail_keys)
        await _write_index_row(project_id=project_id, asset_id=asset_id, object_key=object_key, name=name, content_type=content_type, folder_id=folder_id, status="ready", stage="Ready", document=document, silence_ranges=silence_ranges, embedding=summary_embedding)
        result = {"asset_id": asset_id, "status": "ready", "stage": "Ready", "progress": 100, "moments": len(moments)}
        await _progress(on_progress, asset_id, "ready", result["stage"], 100)
        return result
    except Exception as error:
        await _write_index_row(project_id=project_id, asset_id=asset_id, object_key=object_key, name=name, content_type=content_type, folder_id=folder_id, status="failed", stage="Failed", error=str(error)[:500])
        raise
    finally:
        source.unlink(missing_ok=True)


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
            WITH
                ready_assets AS (
                    SELECT asset_id FROM asset_search_index FINAL
                    WHERE project_id = {project_id:String} AND status = 'ready'
                      AND schema_version = {schema_version:UInt16}
                ),
                lexical_assets AS (
                    SELECT DISTINCT asset_id
                    FROM asset_search_moments FINAL
                    WHERE project_id = {project_id:String}
                      AND schema_version = {schema_version:UInt16}
                      AND asset_id IN ready_assets
                      AND hasAllTokens(search_text, lowerUTF8({query:String}))
                ),
                (SELECT count() FROM lexical_assets) AS lexical_asset_count
            SELECT moment_id, asset_id, asset_name, object_key, content_type, folder_id, thumbnail_key,
                   start, end, description, transcript,
                   1 - cosineDistance(embedding, {embedding:Array(Float32)}) AS vector_score,
                   hasAllTokens(search_text, lowerUTF8({query:String})) AS lexical_match
            FROM asset_search_moments FINAL
            WHERE project_id = {project_id:String} AND schema_version = {schema_version:UInt16}
              AND length(embedding) = {dimensions:UInt16}
              AND asset_id IN ready_assets
              AND (lexical_asset_count = 0 OR asset_id IN lexical_assets)
            ORDER BY vector_score + if(lexical_match, 0.08, 0) DESC
            LIMIT {candidate_limit:UInt16}
            """,
            parameters={"embedding": embedding, "query": clean_query, "project_id": project_id, "schema_version": SEARCH_SCHEMA_VERSION, "dimensions": SEARCH_VECTOR_DIMENSIONS, "candidate_limit": min(limit * 3, 54)},
        )
        rows = result.result_rows
        if not rows:
            return []
        best_vector_score = max(float(row[11]) for row in rows)
        minimum_score = max(0.5, best_vector_score - 0.16)
        ranked = [row for row in rows if bool(row[12]) or float(row[11]) >= minimum_score]
        return [{"moment_id": row[0], "asset_id": row[1], "asset_name": row[2], "object_key": row[3], "content_type": row[4], "folder_id": row[5], "thumbnail_key": row[6], "start": float(row[7]), "end": float(row[8]), "description": row[9], "transcript": row[10], "score": round(min(1, float(row[11]) + (0.08 if row[12] else 0)), 4)} for row in ranked[:limit]]
    finally:
        await client.close()


async def asset_transcript(project_id: str, asset_id: str) -> list[dict[str, object]]:
    client = await clickhouse_client()
    try:
        await _ensure_schema(client)
        result = await client.query(
            """
            SELECT moment_id, start, end, transcript
            FROM asset_search_moments FINAL
            WHERE project_id = {project_id:String} AND asset_id = {asset_id:String}
              AND schema_version = {schema_version:UInt16} AND notEmpty(transcript)
              AND asset_id IN (
                SELECT asset_id FROM asset_search_index FINAL
                WHERE project_id = {project_id:String} AND status = 'ready'
                  AND schema_version = {schema_version:UInt16}
              )
            ORDER BY start
            """,
            parameters={"project_id": project_id, "asset_id": asset_id, "schema_version": SEARCH_SCHEMA_VERSION},
        )
        return [{"id": row[0], "start": float(row[1]), "end": float(row[2]), "text": row[3]} for row in result.result_rows]
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
    return (await _embed_contents([value], "RETRIEVAL_QUERY"))[0]


async def _embed_documents(documents: list[str]) -> list[list[float]]:
    return await _embed_contents(documents, "RETRIEVAL_DOCUMENT")


async def _embed_contents(contents: list[str], task_type: str) -> list[list[float]]:
    client = genai.Client(vertexai=True, project=settings.google_cloud_project, location=settings.google_cloud_location)
    semaphore = asyncio.Semaphore(4)
    async def embed(content: str) -> list[float]:
        async with semaphore:
            response = await client.aio.models.embed_content(model=SEARCH_EMBEDDING_MODEL, contents=content, config=types.EmbedContentConfig(task_type=task_type, output_dimensionality=SEARCH_VECTOR_DIMENSIONS))
        values = response.embeddings[0].values if response.embeddings else None
        return _normalized_vector(values)
    try:
        embeddings = await asyncio.gather(*(embed(content) for content in contents))
    finally:
        await client.aio.aclose()
    return embeddings


async def _replace_moments(*, project_id: str, asset_id: str, object_key: str, name: str, content_type: str, folder_id: str, moments: list[IndexedMoment], embeddings: list[list[float]], thumbnail_keys: list[str]) -> None:
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


async def _write_index_row(*, project_id: str, asset_id: str, object_key: str, name: str, content_type: str, folder_id: str, status: str, stage: str = "", document: str = "", silence_ranges: str = "[]", embedding: list[float] | None = None, error: str = "") -> None:
    client = await clickhouse_client()
    try:
        await _ensure_schema(client)
        await client.insert("asset_search_index", [[project_id, asset_id, object_key, name, content_type, folder_id, status, stage, document, silence_ranges, embedding or [], SEARCH_EMBEDDING_MODEL, SEARCH_ANALYSIS_MODEL, SEARCH_SCHEMA_VERSION, error, datetime.now(timezone.utc)]], column_names=["project_id", "asset_id", "object_key", "asset_name", "content_type", "folder_id", "status", "stage", "document", "silence_ranges", "embedding", "embedding_model", "analysis_model", "schema_version", "error", "updated_at"])
    finally:
        await client.close()


async def _ensure_schema(client) -> None:
    global _schema_ready
    if _schema_ready:
        return
    async with _schema_lock:
        if _schema_ready:
            return
        await client.command("""CREATE TABLE IF NOT EXISTS asset_search_index (project_id String, asset_id String, object_key String, asset_name String, content_type LowCardinality(String), folder_id String, status LowCardinality(String), stage LowCardinality(String), document String, silence_ranges String, embedding Array(Float32), embedding_model LowCardinality(String), analysis_model LowCardinality(String), schema_version UInt16, error String, updated_at DateTime64(3, 'UTC'), INDEX status_values status TYPE set(16) GRANULARITY 1, INDEX document_tokens document TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 1) ENGINE = ReplacingMergeTree(updated_at) ORDER BY (project_id, asset_id)""")
        await client.command("ALTER TABLE asset_search_index ADD COLUMN IF NOT EXISTS stage LowCardinality(String) AFTER status")
        await client.command("ALTER TABLE asset_search_index ADD COLUMN IF NOT EXISTS silence_ranges String DEFAULT '[]' AFTER document")
        await client.command("ALTER TABLE asset_search_index ADD INDEX IF NOT EXISTS status_values status TYPE set(16) GRANULARITY 1")
        await client.command("""CREATE TABLE IF NOT EXISTS asset_search_moments (project_id String, asset_id String, moment_id String, object_key String, asset_name String, content_type LowCardinality(String), folder_id String, thumbnail_key String, start Float64, end Float64, description String, transcript String, search_text String MATERIALIZED lowerUTF8(concat(asset_name, ' ', description, ' ', transcript)), embedding Array(Float32), embedding_model LowCardinality(String), analysis_model LowCardinality(String), schema_version UInt16, updated_at DateTime64(3, 'UTC'), INDEX content_type_values content_type TYPE set(16) GRANULARITY 1, INDEX moment_text_tokens description TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 1, INDEX transcript_tokens transcript TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 1, INDEX search_text_tokens search_text TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 1) ENGINE = ReplacingMergeTree(updated_at) ORDER BY (project_id, asset_id, moment_id)""")
        await client.command("ALTER TABLE asset_search_moments ADD COLUMN IF NOT EXISTS thumbnail_key String AFTER folder_id")
        await client.command("ALTER TABLE asset_search_moments ADD COLUMN IF NOT EXISTS search_text String MATERIALIZED lowerUTF8(concat(asset_name, ' ', description, ' ', transcript)) AFTER transcript")
        await client.command("ALTER TABLE asset_search_moments ADD INDEX IF NOT EXISTS content_type_values content_type TYPE set(16) GRANULARITY 1")
        await client.command("ALTER TABLE asset_search_moments ADD INDEX IF NOT EXISTS transcript_tokens transcript TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 1")
        await client.command("ALTER TABLE asset_search_moments ADD INDEX IF NOT EXISTS search_text_tokens search_text TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 1")
        _schema_ready = True


def _render_moment_previews(source: Path, project_id: str, asset_id: str, content_type: str, moments: list[IndexedMoment]) -> list[str]:
    storage_client = storage.Client(project=settings.google_cloud_project)
    bucket = storage_client.bucket(settings.gcs_bucket)
    shared_audio_preview = _render_preview(source, content_type, 0, max((moment.end for moment in moments), default=.25)) if content_type.startswith("audio/") else None
    keys = []
    for index, moment in enumerate(moments, start=1):
        digest = hashlib.sha256(f"{asset_id}:{moment.start:.3f}:{moment.end:.3f}:{SEARCH_SCHEMA_VERSION}".encode()).hexdigest()
        key = f"projects/{project_id}/search/moments/v{SEARCH_SCHEMA_VERSION}/{asset_id}/{index:04d}-{digest[:12]}.jpg"
        preview = shared_audio_preview or _render_preview(source, content_type, moment.start, moment.end)
        bucket.blob(key).upload_from_string(preview, content_type="image/jpeg")
        keys.append(key)
    return keys


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


def _download_source(object_key: str, content_type: str) -> Path:
    suffix = mimetypes.guess_extension(content_type)
    with tempfile.NamedTemporaryFile(prefix="amplifier-index-source-", suffix=suffix or ".media", delete=False) as temporary:
        source = Path(temporary.name)
    try:
        storage.Client(project=settings.google_cloud_project).bucket(settings.gcs_bucket).blob(object_key).download_to_filename(source)
        return source
    except Exception:
        source.unlink(missing_ok=True)
        raise


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
