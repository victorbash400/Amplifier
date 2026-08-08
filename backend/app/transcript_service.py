from __future__ import annotations

import asyncio
import hashlib
import json
from pathlib import Path
import tempfile

from google.cloud import storage

from app.config import settings
from app.media_indexing import _audio_moments
from app.media_search import asset_transcript
from app.media_transcription import transcribe_media


async def transcript_for_asset(project_id: str, asset_id: str, source_object_key: str | None) -> list[dict[str, object]]:
    indexed = await asset_transcript(project_id, asset_id)
    if indexed:
        return indexed
    cache = storage.Client(project=settings.google_cloud_project).bucket(settings.gcs_bucket).blob(f"projects/{project_id}/accessibility/transcripts/v2/{asset_id}.json")
    if await asyncio.to_thread(cache.exists):
        try:
            return list(json.loads(await asyncio.to_thread(cache.download_as_text)))
        except (TypeError, ValueError) as error:
            raise RuntimeError("The cached transcript is invalid") from error
    if not source_object_key or not source_object_key.startswith(f"projects/{project_id}/assets/{asset_id}/"):
        raise ValueError("This clip has no attached or indexed transcript")
    source_blob = storage.Client(project=settings.google_cloud_project).bucket(settings.gcs_bucket).blob(source_object_key)
    with tempfile.TemporaryDirectory(prefix="amplifier-transcript-") as directory:
        source = Path(directory) / "source-media"
        await asyncio.to_thread(source_blob.download_to_filename, source)
        segments = await asyncio.to_thread(transcribe_media, source)
    moments = _audio_moments(segments)
    cues = [{"id": hashlib.sha256(f"{asset_id}:{moment.start:.3f}:{moment.end:.3f}:{moment.transcript}".encode()).hexdigest(), "start": moment.start, "end": moment.end, "text": moment.transcript} for moment in moments if moment.transcript]
    if not cues:
        raise ValueError("No speech was found in this clip")
    await asyncio.to_thread(cache.upload_from_string, json.dumps(cues, separators=(",", ":")), content_type="application/json")
    return cues
