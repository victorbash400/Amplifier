from __future__ import annotations

import asyncio
import base64
import math
import os
from pathlib import Path
import subprocess
import tempfile

from google import genai
from google.cloud import storage

from app.config import settings


SENSORY_MODEL = "gemini-omni-flash-preview"
CHUNK_SECONDS = 9.5
PROMPTS = {
    "reduce-flash": "Remake this as a photosensitivity-safe video. Completely eliminate every flash, strobe, flicker, rapid light-dark transition, intense red flash, and abrupt brightness change. Replace unsafe moments with continuous steady lighting, smooth gradual transitions, or calm newly generated frames. Change the original lighting, cuts, timing, framing, and visual treatment whenever needed to remove flashing. Safety is the only priority.",
    "reduce-motion": "Reduce rapid camera and background motion. Make movement slow, smooth, and comfortable while preserving every important action and the original meaning. Keep everything else the same.",
    "stabilize": "Stabilize all camera shake and jitter. Preserve the original composition, subjects, actions, timing, and meaning. Keep everything else the same.",
    "fewer-cuts": "Remove rapid cuts and make this a calm continuous shot. Preserve the subjects, important actions, timing, and meaning. Do not introduce new objects or events.",
    "less-stimulus": "Reduce distracting background activity, visual clutter, intense lighting, and unnecessary movement. Preserve all important subjects, actions, readable information, timing, and meaning.",
    "static-version": "Create a nearly static, low-motion version of this scene. Preserve the key subject, essential action, readable information, timing, and meaning. Avoid camera movement, flashing, and background motion.",
}


async def generate_sensory_video(*, project_id: str, asset_id: str, source_asset_id: str, source_object_key: str, source_name: str, folder_id: str, action: str, start: float, end: float) -> dict[str, object]:
    if action not in PROMPTS:
        raise ValueError("Unsupported sensory transformation")
    if not source_object_key.startswith(f"projects/{project_id}/assets/"):
        raise ValueError("The selected video does not belong to this project")
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise ValueError("GEMINI_API_KEY is required for Gemini Omni video editing")

    with tempfile.TemporaryDirectory(prefix="amplifier-sensory-") as directory:
        root = Path(directory)
        source = root / f"source{Path(source_name).suffix or '.mp4'}"
        bucket = storage.Client(project=settings.google_cloud_project).bucket(settings.gcs_bucket)
        await asyncio.to_thread(bucket.blob(source_object_key).download_to_filename, source)
        duration = end - start
        chunk_count = math.ceil(duration / CHUNK_SECONDS)
        edited: list[Path] = []
        client = genai.Client(vertexai=False, api_key=api_key)
        try:
            for index in range(chunk_count):
                chunk_start = start + index * CHUNK_SECONDS
                chunk_duration = min(CHUNK_SECONDS, end - chunk_start)
                input_path = root / f"input-{index:03d}.mp4"
                raw_output = root / f"raw-{index:03d}.mp4"
                normalized = root / f"edited-{index:03d}.mp4"
                await asyncio.to_thread(_cut_chunk, source, input_path, chunk_start, chunk_duration)
                video = await asyncio.to_thread(_edit_chunk, client, input_path, PROMPTS[action])
                raw_output.write_bytes(video)
                await asyncio.to_thread(_normalize_chunk, raw_output, normalized, chunk_duration)
                edited.append(normalized)
        finally:
            client.close()

        stitched_video = root / "stitched-video.mp4"
        final = root / "result.mp4"
        await asyncio.to_thread(_concat_chunks, edited, stitched_video)
        await asyncio.to_thread(_restore_audio, stitched_video, source, final, start, duration)
        name = f"{Path(source_name).stem} - {action.replace('-', ' ').title()}.mp4"
        object_key = f"projects/{project_id}/assets/{asset_id}/{name}"
        output_blob = bucket.blob(object_key)
        output_blob.metadata = {"project_id": project_id, "asset_id": asset_id, "original_name": name, "sensory_action": action, "source_asset_id": source_asset_id, "model": SENSORY_MODEL, "chunks": str(chunk_count)}
        await asyncio.to_thread(output_blob.upload_from_filename, final, content_type="video/mp4")
        await asyncio.to_thread(output_blob.reload)
        return {"id": asset_id, "projectId": project_id, "folderId": folder_id, "name": name, "size": int(output_blob.size or final.stat().st_size), "type": "video/mp4", "objectKey": object_key, "generation": str(output_blob.generation or ""), "duration": duration, "hasAudio": _has_audio(source), "audioProbe": "ffprobe", "accessibilitySourceId": source_asset_id}


def _run(command: list[str], message: str, timeout: int = 300) -> None:
    result = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)
    if result.returncode:
        raise RuntimeError((result.stderr or message).strip()[-600:])


def _cut_chunk(source: Path, output: Path, start: float, duration: float) -> None:
    _run(["ffmpeg", "-v", "error", "-ss", f"{start:.3f}", "-t", f"{duration:.3f}", "-i", str(source), "-an", "-vf", "scale='min(1280,iw)':-2,fps=24,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-movflags", "+faststart", "-y", str(output)], "Could not prepare a sensory video chunk")


def _edit_chunk(client: genai.Client, source: Path, prompt: str) -> bytes:
    interaction = client.interactions.create(model=SENSORY_MODEL, input=[{"type": "video", "data": base64.b64encode(source.read_bytes()).decode(), "mime_type": "video/mp4"}, {"type": "text", "text": prompt}], generation_config={"video_config": {"task": "edit"}}, response_format={"type": "video"}, background=False, store=False, timeout=900)
    output = getattr(interaction, "output_video", None)
    data = getattr(output, "data", None)
    if isinstance(data, str):
        return base64.b64decode(data)
    if isinstance(data, bytes):
        return data
    raise RuntimeError("Gemini Omni returned no edited video")


def _normalize_chunk(source: Path, output: Path, duration: float) -> None:
    actual = _duration(source)
    _run(["ffmpeg", "-v", "error", "-i", str(source), "-an", "-vf", f"setpts={duration / actual:.8f}*PTS,fps=24,format=yuv420p", "-t", f"{duration:.3f}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-y", str(output)], "Could not normalize an edited video chunk")


def _concat_chunks(chunks: list[Path], output: Path) -> None:
    manifest = output.with_suffix(".txt")
    manifest.write_text("".join(f"file '{path}'\n" for path in chunks))
    _run(["ffmpeg", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(manifest), "-c", "copy", "-y", str(output)], "Could not stitch edited video chunks")


def _restore_audio(video: Path, source: Path, output: Path, start: float, duration: float) -> None:
    if _has_audio(source):
        _run(["ffmpeg", "-v", "error", "-i", str(video), "-ss", f"{start:.3f}", "-t", f"{duration:.3f}", "-i", str(source), "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", "-y", str(output)], "Could not restore the source audio")
    else:
        _run(["ffmpeg", "-v", "error", "-i", str(video), "-c", "copy", "-movflags", "+faststart", "-y", str(output)], "Could not finalize the sensory video")


def _duration(path: Path) -> float:
    result = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)], capture_output=True, text=True, timeout=30, check=False)
    duration = float(result.stdout.strip() or 0)
    if result.returncode or duration <= 0:
        raise RuntimeError("Could not read generated video duration")
    return duration


def _has_audio(path: Path) -> bool:
    result = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=index", "-of", "csv=p=0", str(path)], capture_output=True, text=True, timeout=30, check=False)
    return result.returncode == 0 and bool(result.stdout.strip())
