from __future__ import annotations

import asyncio
import math
from pathlib import Path
import subprocess
import tempfile

from google import genai
from google.cloud import storage, texttospeech
from google.genai import types
from pydantic import BaseModel, Field

from app.clickhouse import clickhouse_client
from app.config import settings
from app.media_search import SEARCH_SCHEMA_VERSION


VISION_MODEL = "gemini-3-flash-preview"
VISION_VOICE = "en-US-Chirp3-HD-Aoede"
VISION_FILTERS = {
    "contrast": "eq=contrast=1.18:brightness=0.015:saturation=1.04",
    "red-green": "colorcontrast=rc=0.35:gm=0.25:rcw=0.7:gmw=0.7:pl=0.8",
    "blue-yellow": "colorcontrast=by=0.4:byw=0.8:pl=0.8",
    "all-channels": "colorcontrast=rc=0.25:gm=0.2:by=0.25:rcw=0.6:gmw=0.6:byw=0.6:pl=0.8",
}


class NarrationCue(BaseModel):
    start: float
    end: float
    text: str = Field(min_length=1, max_length=600)


class NarrationPlan(BaseModel):
    cues: list[NarrationCue] = Field(max_length=40)


async def generate_vision_narration(*, project_id: str, asset_id: str, source_asset_id: str, folder_id: str, action: str, start: float, end: float) -> dict[str, object]:
    moments = await _visual_moments(project_id, source_asset_id, start, end)
    if not moments:
        raise ValueError("The selected clip has no indexed visual descriptions")
    cues = await _narration_cues(action, moments, start, end)
    if not cues:
        raise ValueError("No narration was found for the selected clip")
    semaphore = asyncio.Semaphore(4)
    async def synthesize(cue: NarrationCue) -> bytes:
        async with semaphore:
            return await asyncio.to_thread(_synthesize, cue.text)
    pieces = await asyncio.gather(*(synthesize(cue) for cue in cues))
    audio = await asyncio.to_thread(_compose_timed_audio, cues, pieces, start, end - start)
    name = _name(action)
    object_key = f"projects/{project_id}/assets/{asset_id}/{name}"
    blob = storage.Client(project=settings.google_cloud_project).bucket(settings.gcs_bucket).blob(object_key)
    blob.metadata = {"project_id": project_id, "asset_id": asset_id, "original_name": name, "vision_action": action, "source_asset_id": source_asset_id, "narration_cues": str(len(cues))}
    await asyncio.to_thread(blob.upload_from_string, audio, content_type="audio/mpeg")
    await asyncio.to_thread(blob.reload)
    return {
        "id": asset_id,
        "projectId": project_id,
        "folderId": folder_id,
        "name": name,
        "size": int(blob.size or len(audio)),
        "type": "audio/mpeg",
        "objectKey": object_key,
        "generation": str(blob.generation or ""),
        "duration": _audio_duration(audio),
        "narrationCues": len(cues),
    }


async def generate_vision_filter(*, project_id: str, asset_id: str, source_asset_id: str, source_object_key: str, source_name: str, content_type: str, folder_id: str, action: str, preset: str | None, start: float, end: float) -> dict[str, object]:
    if not source_object_key.startswith(f"projects/{project_id}/assets/{source_asset_id}/"):
        raise ValueError("The selected media does not belong to this project")
    if not content_type.startswith(("video/", "image/")):
        raise ValueError("Vision filters require a video or image clip")
    filter_name = preset if action == "color-safe" else action
    video_filter = VISION_FILTERS.get(filter_name or "")
    if not video_filter:
        raise ValueError("Unsupported Vision filter")

    suffix = ".mp4" if content_type.startswith("video/") else ".jpg"
    output_type = "video/mp4" if suffix == ".mp4" else "image/jpeg"
    name = _filtered_name(source_name, action, preset, suffix)
    with tempfile.TemporaryDirectory(prefix="amplifier-vision-filter-") as directory:
        root = Path(directory)
        source = root / f"source{Path(source_name).suffix or '.media'}"
        output = root / name
        blob = storage.Client(project=settings.google_cloud_project).bucket(settings.gcs_bucket).blob(source_object_key)
        await asyncio.to_thread(blob.download_to_filename, source)
        await asyncio.to_thread(_render_filter, source, output, video_filter, content_type, start, end)
        duration = _file_duration(output) if suffix == ".mp4" else None
        object_key = f"projects/{project_id}/assets/{asset_id}/{name}"
        output_blob = storage.Client(project=settings.google_cloud_project).bucket(settings.gcs_bucket).blob(object_key)
        output_blob.metadata = {"project_id": project_id, "asset_id": asset_id, "original_name": name, "vision_action": action, "vision_preset": preset or "", "source_asset_id": source_asset_id}
        await asyncio.to_thread(output_blob.upload_from_filename, output, content_type=output_type)
        await asyncio.to_thread(output_blob.reload)
        return {
            "id": asset_id,
            "projectId": project_id,
            "folderId": folder_id,
            "name": name,
            "size": int(output_blob.size or output.stat().st_size),
            "type": output_type,
            "objectKey": object_key,
            "generation": str(output_blob.generation or ""),
            "accessibilitySourceId": source_asset_id,
            **({"duration": duration} if duration else {}),
        }


def _render_filter(source: Path, output: Path, video_filter: str, content_type: str, start: float, end: float) -> None:
    if content_type.startswith("video/"):
        command = ["ffmpeg", "-v", "error", "-ss", f"{start:.3f}", "-t", f"{end - start:.3f}", "-i", str(source), "-map", "0:v:0", "-map", "0:a?", "-vf", f"{video_filter},format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-y", str(output)]
    else:
        command = ["ffmpeg", "-v", "error", "-i", str(source), "-frames:v", "1", "-vf", video_filter, "-q:v", "2", "-y", str(output)]
    result = subprocess.run(command, capture_output=True, text=True, timeout=300, check=False)
    if result.returncode or not output.exists() or output.stat().st_size < 1:
        raise RuntimeError((result.stderr or "FFmpeg could not apply the Vision filter").strip()[-500:])


def _filtered_name(source_name: str, action: str, preset: str | None, suffix: str) -> str:
    stem = Path(source_name).stem
    label = "High contrast" if action == "contrast" else {"red-green": "Red-green safe", "blue-yellow": "Blue-yellow safe", "all-channels": "Colour safe"}.get(preset or "", "Colour safe")
    return f"{stem} - {label}{suffix}"


async def _visual_moments(project_id: str, asset_id: str, start: float, end: float) -> list[dict[str, object]]:
    client = await clickhouse_client()
    try:
        result = await client.query(
            """
            SELECT start, end, description, transcript
            FROM asset_search_moments FINAL
            WHERE project_id = {project_id:String} AND asset_id = {asset_id:String}
              AND schema_version = {schema_version:UInt16} AND end > {start:Float64} AND start < {end:Float64}
              AND notEmpty(description)
            ORDER BY start
            """,
            parameters={"project_id": project_id, "asset_id": asset_id, "schema_version": SEARCH_SCHEMA_VERSION, "start": start, "end": end},
        )
        return [{"start": float(row[0]), "end": float(row[1]), "description": row[2], "transcript": row[3]} for row in result.result_rows]
    finally:
        await client.close()


async def _narration_cues(action: str, moments: list[dict[str, object]], start: float, end: float) -> list[NarrationCue]:
    duration = end - start
    evidence = "\n".join(f"{item['start']:.1f}-{item['end']:.1f}: VISUAL: {item['description']} SPEECH: {item['transcript']}" for item in moments)
    if action == "audio-description":
        instruction = "Create distinct, concise audio-description cues for each important visual beat. Prefer gaps without speech, but do not omit a meaningful visual change solely because speech exists. Do not repeat information clear from the transcript."
        maximum_cues = max(1, math.ceil(duration / 3))
    elif action == "spoken-text":
        instruction = "Create a cue whenever readable on-screen text appears. The cue text must contain only that text in natural reading order, with brief context only when required. Return no cues when no on-screen text exists."
        maximum_cues = max(1, math.ceil(duration / 2))
    else:
        raise ValueError("Unsupported Vision narration action")
    client = genai.Client(vertexai=True, project=settings.google_cloud_project, location=settings.google_cloud_location)
    try:
        response = await client.aio.models.generate_content(
            model=VISION_MODEL,
            contents=(
                f"{instruction} Use only the indexed evidence below. Return at most {maximum_cues} chronological cues between {start:.2f} and {end:.2f} seconds. "
                "Each cue must use the source timestamps for the visual event it describes. Give every cue enough time for natural speech and keep its text near two spoken words per second of cue duration. "
                "Do not overlap cues. Return a cues array containing start, end, and narration text.\n\n"
                f"{evidence[:24000]}"
            ),
            config=types.GenerateContentConfig(temperature=.1, max_output_tokens=max(300, maximum_cues * 100), response_mime_type="application/json", response_schema=NarrationPlan, thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel.MINIMAL)),
        )
    finally:
        await client.aio.aclose()
    try:
        plan = NarrationPlan.model_validate_json(response.text or "{}")
    except ValueError as error:
        raise RuntimeError("Gemini returned invalid timed narration cues") from error
    cues: list[NarrationCue] = []
    previous_end = start
    for cue in sorted(plan.cues, key=lambda item: item.start):
        cue_start = max(start, cue.start, previous_end)
        cue_end = min(end, cue.end)
        text = " ".join(cue.text.split())
        if cue_end <= cue_start or not text:
            continue
        cues.append(NarrationCue(start=cue_start, end=cue_end, text=text))
        previous_end = cue_end
    return cues


def _synthesize(script: str) -> bytes:
    response = texttospeech.TextToSpeechClient(transport="rest").synthesize_speech(
        request={
            "input": texttospeech.SynthesisInput(text=script),
            "voice": texttospeech.VoiceSelectionParams(language_code="en-US", name=VISION_VOICE),
            "audio_config": texttospeech.AudioConfig(audio_encoding=texttospeech.AudioEncoding.MP3),
        }
    )
    if not response.audio_content:
        raise RuntimeError("Text-to-Speech returned no narration audio")
    return response.audio_content


def _compose_timed_audio(cues: list[NarrationCue], pieces: list[bytes], selection_start: float, selection_duration: float) -> bytes:
    with tempfile.TemporaryDirectory(prefix="amplifier-timed-narration-") as directory:
        root = Path(directory)
        inputs: list[Path] = []
        durations: list[float] = []
        for index, piece in enumerate(pieces):
            source = root / f"cue-{index:03d}.mp3"
            source.write_bytes(piece)
            inputs.append(source)
            durations.append(_file_duration(source))
        total_duration = max(selection_duration, max((cue.start - selection_start) + duration for cue, duration in zip(cues, durations, strict=True)))
        output = root / "timed-narration.mp3"
        command = ["ffmpeg", "-v", "error", "-f", "lavfi", "-t", f"{total_duration:.3f}", "-i", "anullsrc=r=24000:cl=mono"]
        for source in inputs:
            command.extend(["-i", str(source)])
        filters = []
        labels = ["[0:a]"]
        for index, cue in enumerate(cues, start=1):
            delay = max(0, round((cue.start - selection_start) * 1000))
            label = f"cue{index}"
            filters.append(f"[{index}:a]adelay={delay}:all=1[{label}]")
            labels.append(f"[{label}]")
        filters.append(f"{''.join(labels)}amix=inputs={len(labels)}:normalize=0:dropout_transition=0,alimiter=limit=0.95,atrim=0:{total_duration:.3f}[out]")
        command.extend(["-filter_complex", ";".join(filters), "-map", "[out]", "-c:a", "libmp3lame", "-q:a", "3", "-y", str(output)])
        result = subprocess.run(command, capture_output=True, text=True, timeout=180, check=False)
        if result.returncode or not output.exists() or output.stat().st_size < 1:
            raise RuntimeError((result.stderr or "Could not assemble timed narration").strip()[-500:])
        return output.read_bytes()


def _audio_duration(audio: bytes) -> float:
    with tempfile.NamedTemporaryFile(prefix="amplifier-vision-narration-", suffix=".mp3") as source:
        source.write(audio)
        source.flush()
        return _file_duration(Path(source.name))


def _file_duration(source: Path) -> float:
    result = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(source)], capture_output=True, text=True, timeout=30, check=False)
    try:
        duration = float(result.stdout.strip())
    except ValueError as error:
        raise RuntimeError("Could not read generated narration duration") from error
    if result.returncode or not math.isfinite(duration) or duration <= 0:
        raise RuntimeError("Generated narration duration is invalid")
    return duration


def _name(action: str) -> str:
    return {"audio-description": "Audio description.mp3", "spoken-text": "Spoken on-screen text.mp3"}[action]
