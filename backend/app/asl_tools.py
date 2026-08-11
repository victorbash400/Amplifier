from __future__ import annotations

import asyncio
import hashlib
import xml.etree.ElementTree as ET

from google import genai
from google.cloud import storage
from google.genai import types
from pydantic import BaseModel, Field

from app.clickhouse import clickhouse_client
from app.config import settings
from app.media_search import SEARCH_SCHEMA_VERSION
from app.transcript_service import transcript_for_asset


ASL_MODEL = "gemini-3.1-pro-preview"
ASL_SCHEMA_VERSION = 2


class AslCue(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    start: float = Field(ge=0)
    end: float = Field(ge=0)
    gloss: str = Field(min_length=1, max_length=300)
    sigml: str = Field(min_length=30, max_length=20_000)


class AslPlan(BaseModel):
    cues: list[AslCue] = Field(max_length=40)


async def generate_asl_track(project_id: str, asset_id: str, start: float, end: float, source: str, attached_cues: list[dict[str, object]] | None = None, source_object_key: str | None = None) -> list[dict[str, object]]:
    if source == "transcript":
        indexed = attached_cues or await transcript_for_asset(project_id, asset_id, source_object_key)
        evidence_cues = [cue for cue in indexed if float(cue["end"]) > start and float(cue["start"]) < end]
        if not evidence_cues:
            raise ValueError("This clip has no attached or indexed transcript")
    elif source == "description":
        evidence_cues = await _description_cues(project_id, asset_id, start, end)
        if not evidence_cues:
            raise ValueError("This clip has no indexed video descriptions")
    else:
        raise ValueError("Choose transcript or video description for ASL")
    evidence = "\n".join(f"{cue['id']} | {cue['start']:.2f}-{cue['end']:.2f} | {cue['text']}" for cue in evidence_cues)
    blob = _cache_blob(project_id, asset_id, f"{source}\n{evidence}")
    if await asyncio.to_thread(blob.exists):
        cached = await asyncio.to_thread(blob.download_as_text)
        try:
            plan = AslPlan.model_validate_json(cached)
        except ValueError as error:
            raise RuntimeError("The cached ASL track is invalid") from error
        return _validated_cues(plan, evidence_cues)
    client = genai.Client(vertexai=True, project=settings.google_cloud_project, location=settings.google_cloud_location)
    try:
        response = await client.aio.models.generate_content(
            model=ASL_MODEL,
            contents=(
                f"Translate each {source} cue into natural American Sign Language. Return one output cue per input cue with the same id and timestamps. "
                "Use concise ASL gloss order, include necessary non-manual facial grammar, and fingerspell proper names or terms without a conventional sign. "
                "For every cue, produce complete CWASA-compatible gestural SiGML XML. Use a <sigml> root containing one or more <hamgestural_sign gloss=\"...\"> elements. "
                "Every sign must contain <sign_manual>, hand configuration, orientation, body location, and any motion. Use only CWASA SiGML elements and enumerated values. "
                "Follow this exact structural style: <sigml><hamgestural_sign gloss=\"I\"><sign_manual><handconfig handshape=\"finger2\" thumbpos=\"across\"/><handconfig extfidir=\"il\"/><handconfig palmor=\"r\"/><location_bodyarm location=\"chest\" contact=\"touch\"/></sign_manual></hamgestural_sign></sigml>. "
                "Never mix compact HamNoSys tags such as hns_sign or hamfinger2 into this gestural format. Never return prose inside sigml. Keep every animation short enough for its cue.\n\n"
                f"TIMESTAMPED {source.upper()} CUES\n{evidence[:24000]}"
            ),
            config=types.GenerateContentConfig(temperature=0, max_output_tokens=16000, response_mime_type="application/json", response_schema=AslPlan),
        )
    finally:
        await client.aio.aclose()
    try:
        plan = AslPlan.model_validate_json(response.text or "{}")
    except ValueError as error:
        raise RuntimeError("Gemini returned an invalid ASL plan") from error
    cues = _validated_cues(plan, evidence_cues)
    await asyncio.to_thread(blob.upload_from_string, plan.model_dump_json(), content_type="application/json")
    return cues


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


def _cache_blob(project_id: str, asset_id: str, evidence: str):
    digest = hashlib.sha256(evidence.encode()).hexdigest()[:20]
    key = f"projects/{project_id}/accessibility/asl/v{SEARCH_SCHEMA_VERSION}/r{ASL_SCHEMA_VERSION}/{asset_id}/{digest}.json"
    return storage.Client(project=settings.google_cloud_project).bucket(settings.gcs_bucket).blob(key)


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
        if manual is None or not has_hand_configuration or not has_location:
            raise RuntimeError("Gemini returned an incomplete ASL sign")


def _tag(element: ET.Element) -> str:
    return element.tag.rsplit("}", 1)[-1]
