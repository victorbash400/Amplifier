from __future__ import annotations

import asyncio
import json
import math
import mimetypes
import re
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from google import genai
from google.genai import errors, types

from app.config import settings
from app.media_transcription import TranscriptSegment, TranscriptWord, transcribe_media


INDEX_ANALYSIS_MODEL = "gemini-3-flash-preview"
WINDOW_SECONDS = 2.0
FRAME_BATCH_SIZE = 12
FRAME_BATCH_CONCURRENCY = 2


@dataclass(frozen=True)
class IndexedMoment:
    start: float
    end: float
    description: str = ""
    transcript: str = ""


@dataclass(frozen=True)
class TimeRange:
    start: float
    end: float


@dataclass(frozen=True)
class LocalMediaIndex:
    summary: str
    moments: list[IndexedMoment]
    silence: list[TimeRange]


async def build_local_index(source: Path, content_type: str, duration: float | None = None) -> LocalMediaIndex:
    measured_duration = duration if duration and math.isfinite(duration) else _duration(source)
    if content_type.startswith("image/"):
        description = await _describe_image(source, content_type)
        return LocalMediaIndex(summary=description, moments=[IndexedMoment(start=0, end=0, description=description)], silence=[])
    if content_type.startswith("audio/"):
        transcript, silence = await asyncio.gather(asyncio.to_thread(transcribe_media, source), asyncio.to_thread(_detect_silence, source, measured_duration))
        summary = await _summarize_audio(source, content_type, transcript)
        return LocalMediaIndex(summary=summary, moments=_audio_moments(transcript), silence=silence)
    transcript, descriptions, silence = await asyncio.gather(
        asyncio.to_thread(transcribe_media, source),
        _describe_video(source, measured_duration),
        asyncio.to_thread(_detect_silence, source, measured_duration),
    )
    moments = _align_video(descriptions, transcript)
    summary = await _summarize_video(moments)
    return LocalMediaIndex(summary=summary, moments=moments, silence=silence)


async def _describe_image(source: Path, content_type: str) -> str:
    response = await _generate([
        types.Part.from_bytes(data=source.read_bytes(), mime_type=content_type),
        types.Part.from_text(text="Describe this image in one concise factual sentence for search and accessibility. Include the main subject, action, setting, important objects, and readable text. Return only the sentence."),
    ], max_output_tokens=300)
    description = " ".join((response.text or "").strip().split())
    if not description:
        raise RuntimeError("Gemini returned no image description")
    return description


async def _describe_video(source: Path, duration: float) -> list[IndexedMoment]:
    frames = _extract_frames(source, duration)
    try:
        batches = [frames[index:index + FRAME_BATCH_SIZE] for index in range(0, len(frames), FRAME_BATCH_SIZE)]
        semaphore = asyncio.Semaphore(FRAME_BATCH_CONCURRENCY)

        async def describe(batch: list[tuple[float, float, Path]]) -> list[IndexedMoment]:
            async with semaphore:
                return await _describe_frame_batch(batch)

        results = await asyncio.gather(*(describe(batch) for batch in batches))
        moments = [moment for batch in results for moment in batch]
        if len(moments) != len(frames):
            raise RuntimeError(f"Gemini described {len(moments)} of {len(frames)} video windows")
        return moments
    finally:
        for _, _, frame in frames:
            frame.unlink(missing_ok=True)
        if frames:
            frames[0][2].parent.rmdir()


def _extract_frames(source: Path, duration: float) -> list[tuple[float, float, Path]]:
    directory = Path(tempfile.mkdtemp(prefix="amplifier-index-frames-"))
    windows = [(start, min(duration, start + WINDOW_SECONDS)) for start in _range(0, duration, WINDOW_SECONDS)] or [(0.0, 0.0)]
    frames: list[tuple[float, float, Path]] = []
    for index, (start, end) in enumerate(windows):
        output = directory / f"{index:04d}.jpg"
        time = start + max(0, end - start) / 2
        result = subprocess.run(
            ["ffmpeg", "-v", "error", "-ss", f"{time:.3f}", "-i", str(source), "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", "-y", str(output)],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        if result.returncode or not output.exists():
            raise RuntimeError((result.stderr or f"Could not extract frame at {time:.3f}s").strip()[-400:])
        frames.append((start, end, output))
    return frames


async def _describe_frame_batch(frames: list[tuple[float, float, Path]]) -> list[IndexedMoment]:
    manifest = [{"index": index, "start": start, "end": end} for index, (start, end, _) in enumerate(frames)]
    parts: list[types.Part] = [types.Part.from_text(text=(
        "Describe each supplied video frame in one concise factual sentence. Mention only meaningful subjects, actions, setting, objects, and readable on-screen text. "
        "Do not infer speech, intent, or events outside the frame. Return JSON with a descriptions array in exactly the supplied order. "
        f"Each item must contain index and description. Windows: {json.dumps(manifest)}"
    ))]
    for _, _, frame in frames:
        parts.append(types.Part.from_bytes(data=frame.read_bytes(), mime_type="image/jpeg"))
    response = await _generate(parts, max_output_tokens=max(700, len(frames) * 120), response_mime_type="application/json")
    try:
        payload = json.loads(_json_text(response.text or ""))
        items = payload if isinstance(payload, list) else payload["descriptions"]
        descriptions = {int(item["index"]): " ".join(str(item["description"]).split()) for item in items}
        return [IndexedMoment(start=start, end=end, description=descriptions[index]) for index, (start, end, _) in enumerate(frames)]
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Gemini returned invalid frame descriptions: {str(error)[:250]}") from error


async def _summarize_audio(source: Path, content_type: str, transcript: list[TranscriptSegment]) -> str:
    text = " ".join(segment.text for segment in transcript)
    parts = [types.Part.from_bytes(data=source.read_bytes(), mime_type=content_type), types.Part.from_text(text=(
        "Describe this audio in one concise factual paragraph for search. State what kind of recording it is, what happens, and the main subject. "
        f"Use this transcript as evidence and do not repeat it verbatim: {text[:12000]}"
    ))]
    response = await _generate(parts, max_output_tokens=400)
    summary = " ".join((response.text or "").strip().split())
    if not summary:
        raise RuntimeError("Gemini returned no audio summary")
    return summary


async def _summarize_video(moments: list[IndexedMoment]) -> str:
    evidence = "\n".join(f"{moment.start:.1f}-{moment.end:.1f}: {moment.description} {moment.transcript}" for moment in moments)
    response = await _generate([types.Part.from_text(text=(
        "Summarize this video in one concise factual paragraph for search. Include its main subject, setting, and important actions. "
        f"Use only this timestamped evidence:\n{evidence[:24000]}"
    ))], max_output_tokens=400)
    summary = " ".join((response.text or "").strip().split())
    if not summary:
        raise RuntimeError("Gemini returned no video summary")
    return summary


def _align_video(descriptions: list[IndexedMoment], transcript: list[TranscriptSegment]) -> list[IndexedMoment]:
    return [IndexedMoment(
        start=moment.start,
        end=moment.end,
        description=moment.description,
        transcript=_transcript_in_range(transcript, moment.start, moment.end),
    ) for moment in descriptions]


def _audio_moments(transcript: list[TranscriptSegment]) -> list[IndexedMoment]:
    words = [word for segment in transcript for word in segment.words]
    if not words:
        return [IndexedMoment(start=segment.start, end=segment.end, transcript=segment.text) for segment in transcript]
    windows: dict[int, list[TranscriptWord]] = {}
    for word in words:
        window = math.floor(((word.start + word.end) / 2) / WINDOW_SECONDS)
        windows.setdefault(window, []).append(word)
    return [IndexedMoment(
        start=window * WINDOW_SECONDS,
        end=(window + 1) * WINDOW_SECONDS,
        transcript=" ".join(word.text for word in window_words),
    ) for window, window_words in sorted(windows.items())]


def _transcript_in_range(segments: list[TranscriptSegment], start: float, end: float) -> str:
    words = [word.text for segment in segments for word in segment.words if start <= (word.start + word.end) / 2 < end]
    if words:
        return " ".join(words)
    return " ".join(segment.text for segment in segments if not segment.words and _overlaps(start, end, segment.start, segment.end))


async def _generate(parts: list[types.Part], *, max_output_tokens: int, response_mime_type: str | None = None):
    client = genai.Client(vertexai=True, project=settings.google_cloud_project, location=settings.google_cloud_location)
    try:
        for attempt in range(3):
            try:
                return await client.aio.models.generate_content(
                    model=INDEX_ANALYSIS_MODEL,
                    contents=parts,
                    config=types.GenerateContentConfig(
                        temperature=0.1,
                        max_output_tokens=max_output_tokens,
                        response_mime_type=response_mime_type,
                        thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel.MINIMAL),
                    ),
                )
            except errors.APIError as error:
                if error.code not in {429, 500, 502, 503, 504} or attempt == 2:
                    raise
                await asyncio.sleep(0.5 * (2 ** attempt))
        raise RuntimeError("Gemini media analysis did not complete")
    finally:
        await client.aio.aclose()


def _duration(source: Path) -> float:
    result = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(source)], capture_output=True, text=True, timeout=30, check=False)
    try:
        duration = float(result.stdout.strip())
    except ValueError as error:
        raise RuntimeError((result.stderr or "Could not read media duration").strip()[-400:]) from error
    if result.returncode or not math.isfinite(duration) or duration < 0:
        raise RuntimeError("Media duration is invalid")
    return duration


def _detect_silence(source: Path, duration: float) -> list[TimeRange]:
    result = subprocess.run(
        ["ffmpeg", "-v", "info", "-i", str(source), "-af", "silencedetect=noise=-35dB:d=0.35", "-f", "null", "-"],
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
    )
    if result.returncode:
        raise RuntimeError((result.stderr or "Could not detect silence").strip()[-400:])
    starts = [float(value) for value in re.findall(r"silence_start: ([0-9.]+)", result.stderr)]
    ends = [float(value) for value in re.findall(r"silence_end: ([0-9.]+)", result.stderr)]
    if len(starts) > len(ends):
        ends.append(duration)
    return [TimeRange(start=start, end=min(end, duration)) for start, end in zip(starts, ends, strict=True) if end > start]


def _range(start: float, end: float, step: float):
    value = start
    while value < end:
        yield value
        value += step


def _overlaps(start_a: float, end_a: float, start_b: float, end_b: float) -> bool:
    return start_a < end_b and start_b < end_a


def _json_text(value: str) -> str:
    clean = value.strip()
    if clean.startswith("```"):
        clean = clean.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    return clean
