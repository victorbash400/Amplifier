from __future__ import annotations

import asyncio
from pathlib import Path
import subprocess
import tempfile

from google.cloud import storage

from app.config import settings


async def reduce_background_noise(*, project_id: str, asset_id: str, source_asset_id: str, source_object_key: str, source_name: str, content_type: str, folder_id: str, strength: float, duration: float | None) -> dict[str, object]:
    if not source_object_key.startswith(f"projects/{project_id}/assets/{source_asset_id}/"):
        raise ValueError("The selected media does not belong to this project")
    if not content_type.startswith(("audio/", "video/")):
        raise ValueError("Noise reduction requires audio or video")
    if not 0 <= strength <= 1:
        raise ValueError("Noise reduction strength is invalid")
    suffix = ".mp4" if content_type.startswith("video/") else ".mp3"
    output_type = "video/mp4" if suffix == ".mp4" else "audio/mpeg"
    name = f"{Path(source_name).stem} - Noise reduced{suffix}"
    with tempfile.TemporaryDirectory(prefix="amplifier-noise-reduce-") as directory:
        source = Path(directory) / f"source{Path(source_name).suffix or '.media'}"
        output = Path(directory) / name
        source_blob = storage.Client(project=settings.google_cloud_project).bucket(settings.gcs_bucket).blob(source_object_key)
        await asyncio.to_thread(source_blob.download_to_filename, source)
        await asyncio.to_thread(_filter_noise, source, output, content_type, strength)
        object_key = f"projects/{project_id}/assets/{asset_id}/{name}"
        blob = storage.Client(project=settings.google_cloud_project).bucket(settings.gcs_bucket).blob(object_key)
        blob.metadata = {"project_id": project_id, "asset_id": asset_id, "original_name": name, "hearing_action": "noise-reduce", "source_asset_id": source_asset_id, "strength": f"{strength:.2f}"}
        await asyncio.to_thread(blob.upload_from_filename, output, content_type=output_type)
        await asyncio.to_thread(blob.reload)
        return {"id": asset_id, "projectId": project_id, "folderId": folder_id, "name": name, "size": int(blob.size or output.stat().st_size), "type": output_type, "objectKey": object_key, "generation": str(blob.generation or ""), "duration": duration, "hasAudio": True, "audioProbe": "ffprobe", "accessibilitySourceId": source_asset_id, "noiseReduction": strength}


def _filter_noise(source: Path, output: Path, content_type: str, strength: float) -> None:
    reduction = 6 + strength * 30
    audio_filter = f"afftdn=nr={reduction:.1f}:nf=-35:tn=1"
    if content_type.startswith("video/"):
        command = ["ffmpeg", "-v", "error", "-i", str(source), "-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy", "-af", audio_filter, "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-y", str(output)]
    else:
        command = ["ffmpeg", "-v", "error", "-i", str(source), "-vn", "-af", audio_filter, "-c:a", "libmp3lame", "-q:a", "2", "-y", str(output)]
    result = subprocess.run(command, capture_output=True, text=True, timeout=600, check=False)
    if result.returncode or not output.exists() or output.stat().st_size < 1:
        raise RuntimeError((result.stderr or "FFmpeg could not reduce background noise").strip()[-500:])
