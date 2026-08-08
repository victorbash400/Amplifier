from __future__ import annotations

import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from google.api_core.client_options import ClientOptions
from google.cloud.speech_v2 import SpeechClient
from google.cloud.speech_v2.types import cloud_speech

from app.config import settings


TRANSCRIPTION_MODEL = "chirp_3"
CHUNK_SECONDS = 50


@dataclass(frozen=True)
class TranscriptWord:
    start: float
    end: float
    text: str


@dataclass(frozen=True)
class TranscriptSegment:
    start: float
    end: float
    text: str
    words: tuple[TranscriptWord, ...]


def transcribe_media(source: Path) -> list[TranscriptSegment]:
    with tempfile.TemporaryDirectory(prefix="amplifier-transcript-") as directory:
        chunks = _audio_chunks(source, Path(directory))
        client = SpeechClient(transport="rest", client_options=ClientOptions(api_endpoint=f"{settings.google_speech_location}-speech.googleapis.com"))
        segments: list[TranscriptSegment] = []
        for index, chunk in enumerate(chunks):
            segments.extend(_recognize_chunk(client, chunk, index * CHUNK_SECONDS))
        return segments


def _audio_chunks(source: Path, directory: Path) -> list[Path]:
    pattern = directory / "chunk-%04d.flac"
    result = subprocess.run(
        [
            "ffmpeg", "-v", "error", "-i", str(source), "-map", "0:a:0", "-ac", "1", "-ar", "16000",
            "-f", "segment", "-segment_time", str(CHUNK_SECONDS), "-reset_timestamps", "1", "-c:a", "flac", str(pattern),
        ],
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
    )
    chunks = sorted(directory.glob("chunk-*.flac"))
    if result.returncode or not chunks:
        raise RuntimeError((result.stderr or "Could not extract audio for transcription").strip()[-400:])
    return chunks


def _recognize_chunk(client: SpeechClient, source: Path, offset: float) -> list[TranscriptSegment]:
    config = cloud_speech.RecognitionConfig(
        auto_decoding_config=cloud_speech.AutoDetectDecodingConfig(),
        language_codes=["auto"],
        model=TRANSCRIPTION_MODEL,
        features=cloud_speech.RecognitionFeatures(enable_word_time_offsets=True, enable_automatic_punctuation=True),
    )
    response = client.recognize(request=cloud_speech.RecognizeRequest(
        recognizer=f"projects/{settings.google_cloud_project}/locations/{settings.google_speech_location}/recognizers/_",
        config=config,
        content=source.read_bytes(),
    ))
    segments: list[TranscriptSegment] = []
    for result in response.results:
        if not result.alternatives:
            continue
        alternative = result.alternatives[0]
        text = alternative.transcript.strip()
        if not text:
            continue
        words = tuple(
            TranscriptWord(
                start=offset + _seconds(word.start_offset),
                end=offset + _seconds(word.end_offset),
                text=word.word.strip(),
            )
            for word in alternative.words
            if word.word.strip()
        )
        start = words[0].start if words else offset
        end = words[-1].end if words else offset + _seconds(result.result_end_offset)
        segments.append(TranscriptSegment(start=start, end=max(start, end), text=text, words=words))
    return segments


def _seconds(value: object) -> float:
    return float(getattr(value, "seconds", 0)) + float(getattr(value, "microseconds", 0)) / 1_000_000
