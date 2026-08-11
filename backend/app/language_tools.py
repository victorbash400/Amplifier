from __future__ import annotations

import asyncio
import hashlib
import json
import math
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path
import subprocess
import tempfile
from typing import Literal

from google import genai
from google.api_core.client_options import ClientOptions
from google.api_core.retry import Retry, if_transient_error
from google.cloud import speech_v2, storage, texttospeech, translate_v3
from google.cloud.speech_v2.types import cloud_speech
from google.genai import types
from pydantic import BaseModel

from app.config import settings
from app.clickhouse import clickhouse_client
from app.vision_tools import NarrationCue, _audio_duration, _compose_timed_audio, _narration_cues, _visual_moments

TRANSLATION_MODEL = "general/translation-llm"
SPEECH_MODEL = "chirp_3"
VOICE_PROFILE_MODEL = "gemini-3-flash-preview"
LANGUAGES = {"en": ("English", "en-US"), "es": ("Spanish", "es-ES"), "fr": ("French", "fr-FR"), "de": ("German", "de-DE"), "pt": ("Portuguese", "pt-BR"), "it": ("Italian", "it-IT"), "ar": ("Arabic", "ar-XA"), "hi": ("Hindi", "hi-IN"), "ja": ("Japanese", "ja-JP"), "ko": ("Korean", "ko-KR"), "zh": ("Chinese", "cmn-CN")}
MASCULINE_VOICES = ("Charon", "Fenrir", "Puck")
FEMININE_VOICES = ("Aoede", "Kore", "Leda")
NEUTRAL_VOICES = ("Charon", "Aoede", "Fenrir", "Kore", "Puck", "Leda")
_schema_lock = asyncio.Lock()
_schema_ready = False
_google_retry = Retry(predicate=if_transient_error, initial=1, maximum=8, multiplier=2, deadline=45)


@dataclass(frozen=True)
class SpeakerTurn:
    start: float
    end: float
    text: str
    speaker: int
    voice_presentation: Literal["masculine", "feminine", "neutral"] = "neutral"


class VoicePresentation(BaseModel):
    presentation: Literal["masculine", "feminine", "neutral"]


class LanguagePreflightError(ValueError):
    pass


class LanguageGenerationError(RuntimeError):
    pass


async def generate_language_track(*, project_id: str, asset_id: str, source_asset_id: str, source_object_key: str, source_generation: str, source_duration: float | None, source_name: str, folder_id: str, action: str, language: str, start: float, end: float) -> dict[str, object]:
    if language not in LANGUAGES:
        raise LanguagePreflightError("Unsupported target language")
    if action not in {"captions", "audio", "descriptions"}:
        raise LanguagePreflightError("Unsupported language action")
    if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end <= start:
        raise LanguagePreflightError("The selected clip range is invalid")
    if not source_object_key.startswith(f"projects/{project_id}/assets/{source_asset_id}/"):
        raise LanguagePreflightError("The selected media does not belong to this project")
    await _preflight_source(project_id, source_object_key, source_generation, source_duration, end)
    cache_action = "descriptions" if action == "descriptions" else "dialogue-voices-v1"
    cached = await _cached_plan(project_id, source_asset_id, source_generation, cache_action, language, start, end)
    if cached:
        turns, translated = cached
    elif action == "descriptions":
        moments = await _visual_moments(project_id, source_asset_id, start, end)
        if not moments:
            raise ValueError("The selected clip has no indexed visual descriptions")
        source_cues = await _narration_cues("audio-description", moments, start, end)
        turns = [SpeakerTurn(cue.start, cue.end, cue.text, 1) for cue in source_cues]
    else:
        turns = [turn for turn in await _speaker_turns(project_id, source_asset_id, source_object_key, source_generation, source_duration) if turn.end > start and turn.start < end]
    if not turns:
        raise LanguagePreflightError("No speech was found in the selected clip")
    turns = _preflight_turns(turns, source_duration)
    if not cached:
        try:
            translated = await _translate_turns(turns, language)
            await _save_plan(project_id, source_asset_id, source_object_key, source_generation, cache_action, language, start, end, turns, translated)
        except LanguageGenerationError:
            raise
        except Exception as error:
            raise LanguageGenerationError("Language translation stopped before audio generation") from error
    cues = [{"id": _cue_id(source_asset_id, language, turn), "start": turn.start, "end": turn.end, "text": text, "speaker": turn.speaker, "voicePresentation": turn.voice_presentation} for turn, text in zip(turns, translated, strict=True)]
    if action == "captions":
        return {"cues": cues, "language": language, "speakers": len({turn.speaker for turn in turns})}
    try:
        pieces = await _synthesize_turns(turns, translated, language)
    except Exception as error:
        raise LanguageGenerationError("Translated speech synthesis stopped; translation and speaker profiles were saved") from error
    timed = [NarrationCue(start=turn.start, end=turn.end, text=text) for turn, text in zip(turns, translated, strict=True)]
    try:
        audio = await asyncio.to_thread(_compose_timed_audio, timed, pieces, start, end - start)
    except Exception as error:
        raise LanguageGenerationError("Translated speech could not be composed on the source timing") from error
    label = LANGUAGES[language][0]
    name = f"{Path(source_name).stem} - {label} {'descriptions' if action == 'descriptions' else 'audio'}.mp3"
    object_key = f"projects/{project_id}/assets/{asset_id}/{name}"
    blob = storage.Client(project=settings.google_cloud_project).bucket(settings.gcs_bucket).blob(object_key)
    blob.metadata = {"project_id": project_id, "asset_id": asset_id, "source_asset_id": source_asset_id, "language": language, "language_action": action, "speaker_count": str(len({turn.speaker for turn in turns}))}
    try:
        await asyncio.to_thread(blob.upload_from_string, audio, content_type="audio/mpeg")
        await asyncio.to_thread(blob.reload)
    except Exception as error:
        raise LanguageGenerationError("Translated audio could not be saved") from error
    return {"asset": {"id": asset_id, "projectId": project_id, "folderId": folder_id, "name": name, "size": int(blob.size or len(audio)), "type": "audio/mpeg", "objectKey": object_key, "generation": str(blob.generation or ""), "duration": _audio_duration(audio), "accessibilitySourceId": source_asset_id}, "cues": cues, "language": language, "speakers": len({turn.speaker for turn in turns})}


async def _speaker_turns(project_id: str, asset_id: str, object_key: str, generation: str, duration: float | None) -> list[SpeakerTurn]:
    cache_key = hashlib.sha256(f"{object_key}:{generation}".encode()).hexdigest()[:16]
    bucket = storage.Client(project=settings.google_cloud_project).bucket(settings.gcs_bucket)
    cache = bucket.blob(f"projects/{project_id}/accessibility/speakers/v4/{asset_id}-{cache_key}.json")
    if await asyncio.to_thread(cache.exists):
        try:
            turns = [SpeakerTurn(**item) for item in json.loads(await asyncio.to_thread(cache.download_as_text))]
        except (TypeError, ValueError, json.JSONDecodeError) as error:
            raise LanguagePreflightError("The saved speaker diarization is invalid") from error
    else:
        audio_key = await asyncio.to_thread(_normalized_audio, bucket, project_id, asset_id, object_key, cache_key)
        turns = await asyncio.to_thread(_diarize, audio_key, duration)
        if turns:
            turns = _bounded_turns(turns, duration)
            turns = _canonicalize_speakers(turns)
            turns = _preflight_turns(turns, duration)
            await asyncio.to_thread(cache.upload_from_string, json.dumps([turn.__dict__ for turn in turns], separators=(",", ":")), content_type="application/json")
    if not turns:
        return []
    turns = _bounded_turns(turns, duration)
    turns = _canonicalize_speakers(turns)
    turns = _preflight_turns(turns, duration)
    audio_key = await asyncio.to_thread(_normalized_audio, bucket, project_id, asset_id, object_key, cache_key)
    profiles = await _voice_profiles(bucket, project_id, asset_id, cache_key, audio_key, turns)
    if set(profiles) != {turn.speaker for turn in turns}:
        raise LanguageGenerationError("Speaker voice profiling did not complete")
    return [replace(turn, voice_presentation=profiles[turn.speaker]) for turn in turns]


async def _voice_profiles(bucket: storage.Bucket, project_id: str, asset_id: str, cache_key: str, audio_key: str, turns: list[SpeakerTurn]) -> dict[int, Literal["masculine", "feminine", "neutral"]]:
    speakers = sorted({turn.speaker for turn in turns})
    samples_by_speaker = {
        speaker: sorted((turn for turn in turns if turn.speaker == speaker), key=lambda turn: turn.end - turn.start, reverse=True)[:3]
        for speaker in speakers
    }
    if any(not samples for samples in samples_by_speaker.values()):
        raise LanguagePreflightError("Every diarized speaker needs a representative audio range")
    profiles: dict[int, Literal["masculine", "feminine", "neutral"]] = {}
    client = genai.Client(vertexai=True, project=settings.google_cloud_project, location=settings.google_cloud_location)
    try:
        for speaker in speakers:
            profile_cache = bucket.blob(f"projects/{project_id}/accessibility/speakers/voices/v2/{asset_id}-{cache_key}-speaker-{speaker}.json")
            if await asyncio.to_thread(profile_cache.exists):
                try:
                    profile = VoicePresentation.model_validate_json(await asyncio.to_thread(profile_cache.download_as_text))
                except ValueError as error:
                    raise LanguageGenerationError(f"The saved voice profile for speaker {speaker} is invalid") from error
            else:
                ranges = ", ".join(f"{turn.start:.2f}-{turn.end:.2f}s" for turn in samples_by_speaker[speaker])
                response = await client.aio.models.generate_content(
                    model=VOICE_PROFILE_MODEL,
                    contents=[
                        types.Part.from_uri(file_uri=f"gs://{settings.gcs_bucket}/{audio_key}", mime_type="audio/flac"),
                        f"Listen only to diarized speaker {speaker} at these ranges: {ranges}. Classify that speaker's audible vocal presentation for synthetic voice casting. "
                        "This is not the speaker's gender identity. Return masculine or feminine only when the sound is clear; otherwise return neutral.",
                    ],
                    config=types.GenerateContentConfig(temperature=0, max_output_tokens=128, response_mime_type="application/json", response_schema=VoicePresentation, audio_timestamp=True, thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel.MINIMAL)),
                )
                try:
                    profile = VoicePresentation.model_validate_json(response.text or "{}")
                except ValueError as error:
                    raise LanguageGenerationError(f"Gemini returned an invalid voice profile for speaker {speaker}") from error
                await asyncio.to_thread(profile_cache.upload_from_string, profile.model_dump_json(), content_type="application/json")
            profiles[speaker] = profile.presentation
    finally:
        await client.aio.aclose()
    return profiles


async def _preflight_source(project_id: str, object_key: str, generation: str, duration: float | None, selection_end: float) -> None:
    if not generation:
        raise LanguagePreflightError("The selected media has no verified storage generation")
    if duration is not None and (not math.isfinite(float(duration)) or float(duration) <= 0 or selection_end > float(duration) + .05):
        raise LanguagePreflightError("The selected range exceeds the verified media duration")
    blob = storage.Client(project=settings.google_cloud_project).bucket(settings.gcs_bucket).blob(object_key)
    try:
        await asyncio.to_thread(blob.reload)
    except Exception as error:
        raise LanguagePreflightError("The selected source media is unavailable") from error
    if str(blob.generation or "") != generation:
        raise LanguagePreflightError("The selected source media generation has changed")
    if not blob.size:
        raise LanguagePreflightError("The selected source media is empty")


def _preflight_turns(turns: list[SpeakerTurn], duration: float | None) -> list[SpeakerTurn]:
    if not turns:
        raise LanguagePreflightError("No diarized speaker turns are available")
    normalized: list[SpeakerTurn] = []
    for index, turn in enumerate(turns, start=1):
        if turn.speaker < 1:
            raise LanguagePreflightError(f"Diarized turn {index} has an invalid speaker ID")
        if not turn.text.strip():
            raise LanguagePreflightError(f"Diarized turn {index} has no text")
        if not math.isfinite(turn.start) or not math.isfinite(turn.end) or turn.start < 0 or turn.end <= turn.start:
            raise LanguagePreflightError(f"Diarized turn {index} has invalid timing")
        if duration is not None and turn.end > float(duration) + .5:
            raise LanguagePreflightError(f"Diarized turn {index} exceeds the media duration")
        normalized.append(replace(turn, text=" ".join(turn.text.split())))
    return sorted(normalized, key=lambda turn: (turn.start, turn.end, turn.speaker))


def _canonicalize_speakers(turns: list[SpeakerTurn]) -> list[SpeakerTurn]:
    labels = sorted({turn.speaker for turn in turns})
    mapping = {label: index + 1 for index, label in enumerate(labels)}
    return [replace(turn, speaker=mapping[turn.speaker]) for turn in turns]


def _bounded_turns(turns: list[SpeakerTurn], duration: float | None) -> list[SpeakerTurn]:
    if duration is None:
        return turns
    boundary = float(duration)
    return [replace(turn, end=min(turn.end, boundary)) for turn in turns if turn.start < boundary and min(turn.end, boundary) > turn.start]


def _diarize(object_key: str, duration: float | None) -> list[SpeakerTurn]:
    client = speech_v2.SpeechClient(transport="rest", client_options=ClientOptions(api_endpoint=f"{settings.google_speech_location}-speech.googleapis.com"))
    config = cloud_speech.RecognitionConfig(explicit_decoding_config=cloud_speech.ExplicitDecodingConfig(encoding=cloud_speech.ExplicitDecodingConfig.AudioEncoding.FLAC, sample_rate_hertz=16000, audio_channel_count=1), language_codes=["auto"], model=SPEECH_MODEL, features=cloud_speech.RecognitionFeatures(enable_automatic_punctuation=True, enable_word_time_offsets=True, diarization_config=cloud_speech.SpeakerDiarizationConfig()))
    uri = f"gs://{settings.gcs_bucket}/{object_key}"
    if duration is not None and duration < 60:
        response = client.recognize(request=cloud_speech.RecognizeRequest(recognizer=f"projects/{settings.google_cloud_project}/locations/{settings.google_speech_location}/recognizers/_", config=config, uri=uri), timeout=90)
        return _turns_from_results(response.results)
    operation = client.batch_recognize(request=cloud_speech.BatchRecognizeRequest(recognizer=f"projects/{settings.google_cloud_project}/locations/{settings.google_speech_location}/recognizers/_", config=config, files=[cloud_speech.BatchRecognizeFileMetadata(uri=f"gs://{settings.gcs_bucket}/{object_key}")], recognition_output_config=cloud_speech.RecognitionOutputConfig(inline_response_config=cloud_speech.InlineOutputConfig())))
    response = operation.result(timeout=1800)
    results = []
    for result in response.results.values():
        results.extend(result.transcript.results)
    return _turns_from_results(results)


def _normalized_audio(bucket: storage.Bucket, project_id: str, asset_id: str, source_key: str, cache_key: str) -> str:
    audio_key = f"projects/{project_id}/accessibility/speakers/audio/v1/{asset_id}-{cache_key}.flac"
    output_blob = bucket.blob(audio_key)
    if output_blob.exists():
        return audio_key
    with tempfile.TemporaryDirectory(prefix="amplifier-speaker-audio-") as directory:
        root = Path(directory)
        source, output = root / "source-media", root / "speech.flac"
        bucket.blob(source_key).download_to_filename(source)
        result = subprocess.run(["ffmpeg", "-v", "error", "-i", str(source), "-map", "0:a:0", "-ac", "1", "-ar", "16000", "-c:a", "flac", "-y", str(output)], capture_output=True, text=True, timeout=300, check=False)
        if result.returncode or not output.exists() or output.stat().st_size < 1:
            raise RuntimeError((result.stderr or "Could not extract speech audio from the selected media").strip()[-500:])
        output_blob.metadata = {"project_id": project_id, "source_asset_id": asset_id, "source_object_key": source_key}
        output_blob.upload_from_filename(output, content_type="audio/flac", if_generation_match=0)
    return audio_key


def _turns_from_results(results: object) -> list[SpeakerTurn]:
    words = []
    for recognition in results:
        if recognition.alternatives:
            words.extend(recognition.alternatives[0].words)
    timed_words = []
    for index, word in enumerate(words):
        text = word.word.strip()
        if not text:
            continue
        speaker = int(word.speaker_label or "1")
        word_start, word_end = _seconds(word.start_offset), _seconds(word.end_offset)
        if word_end <= word_start:
            next_start = next((_seconds(item.start_offset) for item in words[index + 1:] if _seconds(item.start_offset) > word_start), word_start + .35)
            word_end = min(word_start + .6, next_start)
        timed_words.append((word_start, word_end, text, speaker))
    turns: list[SpeakerTurn] = []
    for word_start, word_end, text, speaker in timed_words:
        if turns and turns[-1].speaker == speaker and word_start - turns[-1].end <= .8:
            previous = turns[-1]
            turns[-1] = SpeakerTurn(previous.start, max(previous.end, word_end), f"{previous.text} {text}", speaker)
        else:
            turns.append(SpeakerTurn(word_start, max(word_start, word_end), text, speaker))
    return _canonicalize_speakers(turns)


async def _translate_turns(turns: list[SpeakerTurn], language: str) -> list[str]:
    client = translate_v3.TranslationServiceClient(transport="rest")
    parent = f"projects/{settings.google_cloud_project}/locations/{settings.google_cloud_location}"
    translated: list[str] = []
    for offset in range(0, len(turns), 1024):
        response = await asyncio.to_thread(client.translate_text, request={"parent": parent, "contents": [turn.text for turn in turns[offset:offset + 1024]], "target_language_code": language, "mime_type": "text/plain", "model": f"{parent}/models/{TRANSLATION_MODEL}"}, retry=_google_retry, timeout=60)
        translated.extend(" ".join(item.translated_text.split()) for item in response.translations)
    if len(translated) != len(turns) or any(not text for text in translated):
        raise RuntimeError("Translation did not return one result per speaker turn")
    return translated


async def _synthesize_turns(turns: list[SpeakerTurn], texts: list[str], language: str) -> list[bytes]:
    semaphore = asyncio.Semaphore(4)
    async def one(turn: SpeakerTurn, text: str) -> bytes:
        async with semaphore:
            return await asyncio.to_thread(_synthesize_fitted, text, language, turn.speaker, turn.voice_presentation, max(.25, turn.end - turn.start))
    return await asyncio.gather(*(one(turn, text) for turn, text in zip(turns, texts, strict=True)))


def _synthesize_fitted(text: str, language: str, speaker: int, presentation: Literal["masculine", "feminine", "neutral"], target_duration: float) -> bytes:
    locale = LANGUAGES[language][1]
    voice = _speaker_voice(speaker, presentation)
    client = texttospeech.TextToSpeechClient(transport="rest")
    def synthesize(rate: float) -> bytes:
        response = client.synthesize_speech(request={"input": texttospeech.SynthesisInput(text=text), "voice": texttospeech.VoiceSelectionParams(language_code=locale, name=f"{locale}-Chirp3-HD-{voice}"), "audio_config": texttospeech.AudioConfig(audio_encoding=texttospeech.AudioEncoding.MP3, speaking_rate=rate)})
        if not response.audio_content:
            raise RuntimeError("Text-to-Speech returned no translated audio")
        return response.audio_content
    first = synthesize(1.0)
    rate = min(2.0, max(.25, _bytes_duration(first) / target_duration))
    return _fit_audio(first if abs(rate - 1) < .08 else synthesize(rate), target_duration)


def _speaker_voice(speaker: int, presentation: Literal["masculine", "feminine", "neutral"]) -> str:
    voices = FEMININE_VOICES if presentation == "feminine" else MASCULINE_VOICES if presentation == "masculine" else NEUTRAL_VOICES
    return voices[(speaker - 1) % len(voices)]


def _fit_audio(audio: bytes, duration: float) -> bytes:
    with tempfile.TemporaryDirectory(prefix="amplifier-language-fit-") as directory:
        source, output = Path(directory) / "source.mp3", Path(directory) / "fitted.mp3"
        source.write_bytes(audio)
        ratio = _file_duration(source) / duration
        if ratio <= 1.02:
            return audio
        filters = []
        while ratio > 2:
            filters.append("atempo=2.0")
            ratio /= 2
        filters.append(f"atempo={ratio:.5f}")
        result = subprocess.run(["ffmpeg", "-v", "error", "-i", str(source), "-filter:a", ",".join(filters), "-t", f"{duration:.3f}", "-c:a", "libmp3lame", "-q:a", "3", "-y", str(output)], capture_output=True, text=True, timeout=60, check=False)
        if result.returncode or not output.exists():
            raise RuntimeError((result.stderr or "Could not fit translated speech to its source timing").strip()[-400:])
        return output.read_bytes()


def _bytes_duration(audio: bytes) -> float:
    with tempfile.NamedTemporaryFile(prefix="amplifier-language-", suffix=".mp3") as source:
        source.write(audio)
        source.flush()
        return _file_duration(Path(source.name))


def _file_duration(source: Path) -> float:
    result = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(source)], capture_output=True, text=True, timeout=30, check=False)
    try:
        duration = float(result.stdout.strip())
    except ValueError as error:
        raise RuntimeError("Could not read translated speech duration") from error
    if result.returncode or not math.isfinite(duration) or duration <= 0:
        raise RuntimeError("Translated speech duration is invalid")
    return duration


def _seconds(value: object) -> float:
    return float(getattr(value, "seconds", 0)) + float(getattr(value, "microseconds", 0)) / 1_000_000


def _cue_id(asset_id: str, language: str, turn: SpeakerTurn) -> str:
    return hashlib.sha256(f"{asset_id}:{language}:{turn.speaker}:{turn.start:.3f}:{turn.end:.3f}".encode()).hexdigest()


async def _cached_plan(project_id: str, asset_id: str, generation: str, action: str, language: str, start: float, end: float) -> tuple[list[SpeakerTurn], list[str]] | None:
    client = await clickhouse_client()
    try:
        await _ensure_schema(client)
        result = await client.query("""
            SELECT speaker_turns, translated_turns
            FROM asset_language_tracks FINAL
            WHERE project_id = {project_id:String} AND source_asset_id = {asset_id:String}
              AND source_generation = {generation:String} AND action = {action:String}
              AND language = {language:String} AND selection_start = {start:Float64} AND selection_end = {end:Float64}
            LIMIT 1
        """, parameters={"project_id": project_id, "asset_id": asset_id, "generation": generation, "action": action, "language": language, "start": start, "end": end})
        if not result.result_rows:
            return None
        turns_json, translations_json = result.result_rows[0]
        turns = [SpeakerTurn(**item) for item in json.loads(turns_json)]
        translated = list(json.loads(translations_json))
        return (turns, translated) if len(turns) == len(translated) else None
    finally:
        await client.close()


async def _save_plan(project_id: str, asset_id: str, object_key: str, generation: str, action: str, language: str, start: float, end: float, turns: list[SpeakerTurn], translated: list[str]) -> None:
    client = await clickhouse_client()
    try:
        await _ensure_schema(client)
        await client.insert("asset_language_tracks", [[project_id, asset_id, object_key, generation, action, language, start, end, json.dumps([turn.__dict__ for turn in turns], separators=(",", ":")), json.dumps(translated, separators=(",", ":"), ensure_ascii=False), SPEECH_MODEL, TRANSLATION_MODEL, datetime.now(timezone.utc)]], column_names=["project_id", "source_asset_id", "source_object_key", "source_generation", "action", "language", "selection_start", "selection_end", "speaker_turns", "translated_turns", "speech_model", "translation_model", "updated_at"])
    finally:
        await client.close()


async def _ensure_schema(client: object) -> None:
    global _schema_ready
    if _schema_ready:
        return
    async with _schema_lock:
        if _schema_ready:
            return
        await client.command("""CREATE TABLE IF NOT EXISTS asset_language_tracks (project_id String, source_asset_id String, source_object_key String, source_generation String, action LowCardinality(String), language LowCardinality(String), selection_start Float64, selection_end Float64, speaker_turns String, translated_turns String, speech_model LowCardinality(String), translation_model LowCardinality(String), updated_at DateTime64(3, 'UTC'), INDEX language_values language TYPE set(128) GRANULARITY 1, INDEX action_values action TYPE set(8) GRANULARITY 1) ENGINE = ReplacingMergeTree(updated_at) ORDER BY (project_id, source_asset_id, source_generation, action, language, selection_start, selection_end)""")
        _schema_ready = True
