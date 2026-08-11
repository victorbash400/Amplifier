from __future__ import annotations

import asyncio
import hashlib
import math
import xml.etree.ElementTree as ET
from typing import Literal

from google import genai
from google.cloud import storage
from google.genai import types
from pydantic import BaseModel, Field

from app.clickhouse import clickhouse_client
from app.config import settings
from app.media_search import SEARCH_SCHEMA_VERSION, asset_transcript


ASL_MODEL = "gemini-3-flash-preview"
ASL_SCHEMA_VERSION = 3
ASL_CUE_TIMEOUT_SECONDS = 60
ASL_MAX_CUES = 200


class AslCue(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    start: float = Field(ge=0)
    end: float = Field(ge=0)
    gloss: str = Field(min_length=1, max_length=300)
    sigml: str = Field(min_length=30, max_length=20_000)


class AslPlan(BaseModel):
    cues: list[AslCue] = Field(max_length=ASL_MAX_CUES)


class GeneratedSign(BaseModel):
    gloss: str = Field(min_length=1, max_length=300)
    sigml: str = Field(min_length=30, max_length=20_000)


class AslNotebook(BaseModel):
    version: int
    source: str
    evidence_hash: str
    expected_ids: list[str]
    completed: list[AslCue]
    status: Literal["ready", "running", "failed", "completed"]
    next_index: int = Field(ge=0)
    error: str | None = None


class AslPreflightError(ValueError):
    pass


class AslGenerationError(RuntimeError):
    pass


async def generate_asl_track(project_id: str, asset_id: str, start: float, end: float, source: str, attached_cues: list[dict[str, object]] | None = None, source_object_key: str | None = None) -> list[dict[str, object]]:
    if source == "captions":
        del source_object_key
        indexed = attached_cues or await asset_transcript(project_id, asset_id)
        evidence_cues = [cue for cue in indexed if float(cue["end"]) > start and float(cue["start"]) < end]
        if not evidence_cues:
            raise AslPreflightError("This clip has no indexed caption text. Index the media or create captions before starting ASL generation.")
    elif source == "description":
        evidence_cues = await _description_cues(project_id, asset_id, start, end)
        if not evidence_cues:
            raise AslPreflightError("This clip has no indexed video descriptions")
    else:
        raise AslPreflightError("Choose captions or video description for ASL")
    evidence_cues = _preflight_cues(evidence_cues)
    evidence = "\n".join(f"{cue['id']} | {cue['start']:.2f}-{cue['end']:.2f} | {cue['text']}" for cue in evidence_cues)
    evidence_hash = hashlib.sha256(f"{source}\n{evidence}".encode()).hexdigest()
    blob = _notebook_blob(project_id, asset_id, evidence_hash)
    expected_ids = [str(cue["id"]) for cue in evidence_cues]
    if await asyncio.to_thread(blob.exists):
        cached = await asyncio.to_thread(blob.download_as_text)
        try:
            notebook = AslNotebook.model_validate_json(cached)
        except ValueError as error:
            raise AslGenerationError("The saved ASL notebook is invalid") from error
        _validate_notebook(notebook, source, evidence_hash, expected_ids, evidence_cues)
        if notebook.status == "completed":
            return _validated_cues(AslPlan(cues=notebook.completed), evidence_cues)
    else:
        notebook = AslNotebook(version=ASL_SCHEMA_VERSION, source=source, evidence_hash=evidence_hash, expected_ids=expected_ids, completed=[], status="ready", next_index=0)
        await _save_notebook(blob, notebook)
    client = genai.Client(vertexai=True, project=settings.google_cloud_project, location=settings.google_cloud_location)
    try:
        for index in range(notebook.next_index, len(evidence_cues)):
            notebook.status = "running"
            notebook.next_index = index
            notebook.error = None
            await _save_notebook(blob, notebook)
            original = evidence_cues[index]
            try:
                generated = await asyncio.wait_for(_generate_sign(client, source, original), timeout=ASL_CUE_TIMEOUT_SECONDS)
                cue = AslCue(id=str(original["id"]), start=float(original["start"]), end=float(original["end"]), gloss=generated.gloss, sigml=generated.sigml)
                _validated_cues(AslPlan(cues=[cue]), [original])
            except Exception as error:
                notebook.status = "failed"
                notebook.next_index = index
                notebook.error = f"Cue {index + 1} of {len(evidence_cues)} failed: {_safe_error(error)}"
                await _save_notebook(blob, notebook)
                raise AslGenerationError(f"ASL generation stopped at cue {index + 1} of {len(evidence_cues)}. Completed cues were saved. An explicit retry will resume from this cue.") from error
            notebook.completed.append(cue)
            notebook.next_index = index + 1
            await _save_notebook(blob, notebook)
    finally:
        await client.aio.aclose()
    notebook.status = "completed"
    notebook.next_index = len(evidence_cues)
    notebook.error = None
    cues = _validated_cues(AslPlan(cues=notebook.completed), evidence_cues)
    await _save_notebook(blob, notebook)
    return cues


async def _generate_sign(client: genai.Client, source: str, cue: dict[str, object]) -> GeneratedSign:
    response = await client.aio.models.generate_content(
        model=ASL_MODEL,
        contents=(
            f"Translate this single {source} cue into concise natural American Sign Language. Use at most six essential signs. "
            "Return only the gloss and complete CWASA-compatible gestural SiGML XML. The <sigml> root must contain one or more <hamgestural_sign> elements. "
            "Every sign needs <sign_manual>, hand configuration, orientation, and a body or hand location. Use only CWASA gestural SiGML elements and enumerated values. "
            "Example structure: <sigml><hamgestural_sign gloss=\"I\"><sign_manual><handconfig handshape=\"finger2\" thumbpos=\"across\"/><handconfig extfidir=\"il\"/><handconfig palmor=\"r\"/><location_bodyarm location=\"chest\" contact=\"touch\"/></sign_manual></hamgestural_sign></sigml>. "
            "Do not include prose, timestamps, IDs, DOCTYPE, ENTITY, hns_sign, or compact HamNoSys tags.\n\n"
            f"TEXT: {str(cue['text'])[:1200]}"
        ),
        config=types.GenerateContentConfig(
            temperature=0,
            max_output_tokens=4096,
            response_mime_type="application/json",
            response_schema=GeneratedSign,
            thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel.MINIMAL),
        ),
    )
    try:
        return GeneratedSign.model_validate_json(response.text or "{}")
    except ValueError as error:
        raise AslGenerationError("Gemini returned an incomplete ASL cue") from error


async def _description_cues(project_id: str, asset_id: str, start: float, end: float) -> list[dict[str, object]]:
    client = await clickhouse_client()
    try:
        result = await client.query(
            """
            SELECT moment_id, start, end, description
            FROM asset_search_moments FINAL
            WHERE project_id = {project_id:String} AND asset_id = {asset_id:String}
              AND schema_version = {schema_version:UInt16} AND end > {start:Float64} AND start < {end:Float64}
              AND notEmpty(description)
            ORDER BY start
            """,
            parameters={"project_id": project_id, "asset_id": asset_id, "schema_version": SEARCH_SCHEMA_VERSION, "start": start, "end": end},
        )
        return [{"id": row[0], "start": float(row[1]), "end": float(row[2]), "text": row[3]} for row in result.result_rows]
    finally:
        await client.close()


def _preflight_cues(cues: list[dict[str, object]]) -> list[dict[str, object]]:
    if not cues:
        raise AslPreflightError("ASL generation requires at least one timed source cue")
    if len(cues) > ASL_MAX_CUES:
        raise AslPreflightError(f"ASL generation supports at most {ASL_MAX_CUES} cues in one request")
    normalized: list[dict[str, object]] = []
    seen: set[str] = set()
    for position, cue in enumerate(cues, start=1):
        cue_id = str(cue.get("id") or "").strip()
        text = str(cue.get("text") or "").strip()
        try:
            start = float(cue["start"])
            end = float(cue["end"])
        except (KeyError, TypeError, ValueError) as error:
            raise AslPreflightError(f"Source cue {position} has invalid timing") from error
        if not cue_id:
            raise AslPreflightError(f"Source cue {position} has no stable ID")
        if cue_id in seen:
            raise AslPreflightError(f"Source cue ID {cue_id} is duplicated")
        if not text:
            raise AslPreflightError(f"Source cue {position} has no text")
        if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end <= start:
            raise AslPreflightError(f"Source cue {position} has invalid timing")
        seen.add(cue_id)
        normalized.append({"id": cue_id, "start": start, "end": end, "text": text})
    return sorted(normalized, key=lambda cue: (float(cue["start"]), float(cue["end"]), str(cue["id"])))


def _validate_notebook(notebook: AslNotebook, source: str, evidence_hash: str, expected_ids: list[str], evidence_cues: list[dict[str, object]]) -> None:
    if notebook.version != ASL_SCHEMA_VERSION or notebook.source != source or notebook.evidence_hash != evidence_hash:
        raise AslGenerationError("The saved ASL notebook does not match the current source")
    if notebook.expected_ids != expected_ids:
        raise AslGenerationError("The saved ASL notebook cue list does not match the current source")
    if notebook.next_index != len(notebook.completed) or notebook.next_index > len(expected_ids):
        raise AslGenerationError("The saved ASL notebook progress is inconsistent")
    if [cue.id for cue in notebook.completed] != expected_ids[:notebook.next_index]:
        raise AslGenerationError("The saved ASL notebook cue order is inconsistent")
    if notebook.completed:
        _validated_cues(AslPlan(cues=notebook.completed), evidence_cues[:notebook.next_index])
    if notebook.status == "completed" and notebook.next_index != len(expected_ids):
        raise AslGenerationError("The saved ASL notebook is marked complete before all cues were generated")


async def _save_notebook(blob: object, notebook: AslNotebook) -> None:
    await asyncio.to_thread(blob.upload_from_string, notebook.model_dump_json(), content_type="application/json")


def _notebook_blob(project_id: str, asset_id: str, evidence_hash: str):
    digest = evidence_hash[:20]
    key = f"projects/{project_id}/accessibility/asl/v{SEARCH_SCHEMA_VERSION}/r{ASL_SCHEMA_VERSION}/{asset_id}/{digest}.notebook.json"
    return storage.Client(project=settings.google_cloud_project).bucket(settings.gcs_bucket).blob(key)


def _safe_error(error: Exception) -> str:
    if isinstance(error, TimeoutError):
        return f"Timed out after {ASL_CUE_TIMEOUT_SECONDS} seconds"
    message = str(error).strip()
    return message[:300] if message else error.__class__.__name__


def _validated_cues(plan: AslPlan, transcript: list[dict[str, object]]) -> list[dict[str, object]]:
    source = {str(cue["id"]): cue for cue in transcript}
    if not plan.cues:
        raise RuntimeError("Gemini returned no ASL cues")
    ids = [cue.id for cue in plan.cues]
    if len(ids) != len(set(ids)) or set(ids) != set(source):
        raise RuntimeError("Gemini did not return one ASL cue per transcript cue")
    cues = []
    for cue in plan.cues:
        original = source[cue.id]
        if abs(cue.start - float(original["start"])) > .01 or abs(cue.end - float(original["end"])) > .01:
            raise RuntimeError("Gemini changed the ASL cue timing")
        _validate_sigml(cue.sigml)
        cues.append(cue.model_dump())
    return sorted(cues, key=lambda cue: float(cue["start"]))


def _validate_sigml(sigml: str) -> None:
    if "<!DOCTYPE" in sigml.upper() or "<!ENTITY" in sigml.upper():
        raise RuntimeError("ASL SiGML contains unsupported XML declarations")
    try:
        root = ET.fromstring(sigml)
    except ET.ParseError as error:
        raise RuntimeError("Gemini returned malformed ASL SiGML") from error
    signs = [element for element in root if _tag(element) == "hamgestural_sign"]
    if _tag(root) != "sigml" or not signs:
        raise RuntimeError("Gemini returned incomplete ASL SiGML")
    for sign in signs:
        manual = next((element for element in sign if _tag(element) == "sign_manual"), None)
        descendants = list(manual.iter()) if manual is not None else []
        has_hand_configuration = any(_tag(element) == "handconfig" for element in descendants)
        has_location = any(_tag(element) in {"location_bodyarm", "location_hand", "handconstellation"} for element in descendants)
        has_movement = any(_tag(element).startswith("hammove_") for element in descendants)
        if manual is None or not has_hand_configuration or not (has_location or has_movement):
            raise RuntimeError("Gemini returned an incomplete ASL sign")


def _tag(element: ET.Element) -> str:
    return element.tag.rsplit("}", 1)[-1]
