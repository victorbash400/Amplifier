from __future__ import annotations

from typing import Any, Literal
from uuid import uuid4

from google.adk.tools import ToolContext

from app.accounts import project_asset, project_assets, register_project_asset
from app.asl_tools import AslGenerationError, AslPreflightError, generate_asl_track
from app.braille import braille_transcript
from app.hearing_tools import reduce_background_noise
from app.language_tools import _speaker_turns, generate_language_track
from app.media_search import asset_transcript, search_assets
from app.sensory_tools import generate_sensory_video
from app.timeline_service import TimelineConflict, apply_operation, read_timeline as load_timeline
from app.transcript_service import transcript_for_asset
from app.vision_tools import generate_vision_filter, generate_vision_narration


MUTATION_TOOLS = {
    "insert_asset", "insert_asset_at_playhead", "insert_asset_next_to", "insert_media_moment", "move_clip", "trim_clip", "split_clip", "delete_clip", "replace_clip", "replace_clip_track", "set_volume",
    "apply_audio_description", "apply_spoken_text", "apply_contrast", "apply_colour_safe", "apply_large_text",
    "apply_captions", "apply_asl", "apply_noise_reduction", "apply_braille_text", "apply_structured_description",
    "apply_labels", "apply_navigation", "apply_tactile_cues", "reduce_flash", "reduce_motion", "stabilize",
    "reduce_cuts", "reduce_stimulus", "create_static_version", "translate_captions", "translate_audio",
    "translate_descriptions",
}


class AgentToolError(ValueError):
    def __init__(self, code: str, message: str, action: str, *, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.action = action
        self.retryable = retryable


def _state(tool_context: ToolContext) -> tuple[str, str, int]:
    account_id = str(tool_context.state.get("account_id") or "")
    project_id = str(tool_context.state.get("project_id") or "")
    revision = int(tool_context.state.get("timeline_revision") or 0)
    if not account_id or not project_id:
        raise ValueError("The agent has no verified project context")
    return account_id, project_id, revision


async def _timeline(tool_context: ToolContext) -> dict[str, Any]:
    account_id, project_id, _ = _state(tool_context)
    return await load_timeline(account_id, project_id)


async def _selected(tool_context: ToolContext, role: str | None = None) -> tuple[dict[str, Any], dict[str, Any]]:
    timeline = await _timeline(tool_context)
    selected_ids = [str(value) for value in tool_context.state.get("selected_clip_ids", [])]
    clip = next((item for item in timeline["clips"] if item["id"] in selected_ids and (role is None or item["role"] == role)), None)
    if not clip:
        raise AgentToolError(
            "selection_required",
            "A compatible timeline clip is not selected.",
            "Read the timeline shot, call select_timeline_clip with the exact clip ID, then retry once.",
            retryable=True,
        )
    return timeline, clip


async def _asset_for_clip(tool_context: ToolContext, clip: dict[str, Any]) -> dict[str, Any]:
    account_id, project_id, _ = _state(tool_context)
    asset = await project_asset(account_id, project_id, clip["assetId"])
    if not asset:
        raise ValueError("The selected media is unavailable")
    return asset


async def _mutate(tool_context: ToolContext, operation: dict[str, Any]) -> dict[str, Any]:
    account_id, project_id, revision = _state(tool_context)
    call_id = tool_context.function_call_id or str(uuid4())
    try:
        result = await apply_operation(account_id, project_id, revision, operation, call_id)
    except TimelineConflict as error:
        return {"status": "failed", "code": "timeline_conflict", "error": str(error), "retryable": True, "action": "Read the current timeline and retry the edit."}
    tool_context.state["timeline_revision"] = result["timeline"]["revision"]
    return result


def _selection_change(clip: dict[str, Any]) -> dict[str, Any]:
    return {"start": clip["start"], "end": clip["start"] + clip["duration"], "lanes": [clip["lane"]], "clipIds": [clip["id"]]}


async def read_timeline_shot(tool_context: ToolContext) -> dict[str, Any]:
    """Read the verified compact timeline and selection for this turn."""
    attached = tool_context.state.get("timeline_shot")
    if isinstance(attached, dict):
        return {"status": "completed", "shot": attached}
    timeline = await _timeline(tool_context)
    selected = set(str(value) for value in tool_context.state.get("selected_clip_ids", []))
    clips = timeline["clips"] if not selected else [clip for clip in timeline["clips"] if clip["id"] in selected or clip.get("linkId") and any(other["id"] in selected and other.get("linkId") == clip.get("linkId") for other in timeline["clips"])]
    account_id, project_id, _ = _state(tool_context)
    assets = {asset["id"]: asset for asset in await project_assets(account_id, project_id)}
    projected = [{**clip, "assetName": assets.get(clip["assetId"], {}).get("name", "Unavailable media"), "assetType": assets.get(clip["assetId"], {}).get("type", "")} for clip in clips]
    return {"status": "completed", "shot": {"projectId": project_id, "revision": timeline["revision"], "playhead": tool_context.state.get("playhead", 0), "selectedClipIds": list(selected), "clips": projected, "trackCounts": timeline["trackCounts"]}}


async def read_attached_skill(skill_id: str, tool_context: ToolContext) -> dict[str, Any]:
    """Read one server-verified skill attached to this chat.

    Args:
        skill_id: Exact skill ID from the attached-skill manifest.
    """
    skills = tool_context.state.get("attached_skills", [])
    skill = next((item for item in skills if isinstance(item, dict) and item.get("id") == skill_id), None)
    if not skill:
        raise ValueError(f"Skill is not attached: {skill_id}")
    return {"status": "completed", "skill_id": skill_id, "revision": skill.get("revision"), "name": skill.get("name"), "instructions": skill.get("instruction")}


async def read_timeline(tool_context: ToolContext) -> dict[str, Any]:
    """Read the complete verified canonical timeline."""
    return {"status": "completed", "timeline": await _timeline(tool_context)}


async def read_selection(tool_context: ToolContext) -> dict[str, Any]:
    """Read selected clips and their owned asset metadata."""
    timeline = await _timeline(tool_context)
    selected = set(str(value) for value in tool_context.state.get("selected_clip_ids", []))
    account_id, project_id, _ = _state(tool_context)
    clips = [clip for clip in timeline["clips"] if clip["id"] in selected]
    assets = {clip["assetId"]: await project_asset(account_id, project_id, clip["assetId"]) for clip in clips}
    return {"status": "completed", "clips": clips, "assets": assets}


async def select_timeline_clip(clip_id: str, tool_context: ToolContext) -> dict[str, Any]:
    """Focus an exact canonical clip and its linked group for subsequent tools."""
    timeline = await _timeline(tool_context)
    clip = next((item for item in timeline["clips"] if item["id"] == clip_id), None)
    if not clip:
        raise AgentToolError("clip_not_found", "The requested timeline clip was not found.", "Read the current timeline shot and use one exact returned clip ID.")
    selected = [item["id"] for item in timeline["clips"] if item["id"] == clip_id or clip.get("linkId") and item.get("linkId") == clip.get("linkId")]
    playhead = float(clip["start"])
    tool_context.state["selected_clip_ids"] = selected
    tool_context.state["playhead"] = playhead
    return {"status": "completed", "selection": {"clipIds": selected, "playhead": playhead}, "clip": clip}


async def read_project(tool_context: ToolContext) -> dict[str, Any]:
    """List media in the verified active project without exposing storage keys."""
    account_id, project_id, _ = _state(tool_context)
    assets = await project_assets(account_id, project_id)
    return {"status": "completed", "projectId": project_id, "assets": [{key: item.get(key) for key in ("id", "name", "type", "duration", "hasAudio")} for item in assets]}


async def list_project_assets(media_type: Literal["all", "video", "audio", "image"], folder_id: str, tool_context: ToolContext) -> dict[str, Any]:
    """List every owned file available to Edit Agent, optionally filtered by media type or folder.

    Args:
        media_type: all, video, audio, or image.
        folder_id: A folder ID, or an empty string for every folder.
    """
    account_id, project_id, _ = _state(tool_context)
    assets = await project_assets(account_id, project_id)
    prefix = "" if media_type == "all" else f"{media_type}/"
    matches = [asset for asset in assets if (not prefix or str(asset.get("type") or "").startswith(prefix)) and (not folder_id or asset.get("folderId") == folder_id)]
    return {"status": "completed", "projectId": project_id, "assets": [_safe_asset(asset) for asset in matches]}


async def inspect_asset(asset_id: str, tool_context: ToolContext) -> dict[str, Any]:
    """Inspect one owned project file before placing it on the timeline."""
    account_id, project_id, _ = _state(tool_context)
    asset = await project_asset(account_id, project_id, asset_id)
    if not asset:
        raise ValueError("Asset was not found in this project")
    return {"status": "completed", "asset": _safe_asset(asset)}


async def search_media(query: str, tool_context: ToolContext) -> dict[str, Any]:
    """Search indexed moments in the active project.

    Args:
        query: A concise description of the desired media moment.
    """
    _, project_id, _ = _state(tool_context)
    results = await search_assets(project_id, query, limit=10)
    return {"status": "completed", "results": [{key: item.get(key) for key in ("asset_id", "asset_name", "start", "end", "description", "transcript", "score")} for item in results]}


async def read_transcript(tool_context: ToolContext) -> dict[str, Any]:
    """Read the transcript for the selected clip."""
    _, clip = await _selected(tool_context)
    _, project_id, _ = _state(tool_context)
    return {"status": "completed", "cues": await asset_transcript(project_id, clip["assetId"])}


async def read_speaker_turns(tool_context: ToolContext) -> dict[str, Any]:
    """Read diarized speaker turns for the selected clip."""
    _, clip = await _selected(tool_context)
    asset = await _asset_for_clip(tool_context, clip)
    _, project_id, _ = _state(tool_context)
    turns = await _speaker_turns(project_id, clip["assetId"], str(asset.get("objectKey") or ""), str(asset.get("generation") or ""), asset.get("duration"))
    return {"status": "completed", "turns": [turn.__dict__ for turn in turns]}


async def insert_asset(asset_id: str, start: float, lane: int, include_audio: bool, tool_context: ToolContext) -> dict[str, Any]:
    """Insert a complete owned file at an exact timeline time and lane. Videos create linked visual and audio clips when audio is present."""
    return await _insert_owned_asset(asset_id, start, lane, include_audio, 0, None, tool_context)


async def insert_asset_at_playhead(asset_id: str, lane: int, include_audio: bool, tool_context: ToolContext) -> dict[str, Any]:
    """Insert a complete owned file at the verified current playhead."""
    return await _insert_owned_asset(asset_id, float(tool_context.state.get("playhead") or 0), lane, include_audio, 0, None, tool_context)


async def insert_asset_next_to(asset_id: str, anchor_clip_id: str, position: Literal["before", "after"], lane: int, include_audio: bool, tool_context: ToolContext) -> dict[str, Any]:
    """Insert a complete owned file immediately before or after an existing clip or linked group."""
    timeline = await _timeline(tool_context)
    anchor = next((clip for clip in timeline["clips"] if clip["id"] == anchor_clip_id), None)
    if not anchor:
        raise ValueError("Anchor clip was not found")
    group = [clip for clip in timeline["clips"] if clip["id"] == anchor_clip_id or anchor.get("linkId") and clip.get("linkId") == anchor.get("linkId")]
    account_id, project_id, _ = _state(tool_context)
    asset = await project_asset(account_id, project_id, asset_id)
    if not asset:
        raise ValueError("Asset was not found in this project")
    duration = _asset_duration(asset, 0, None)
    start = max(clip["start"] + clip["duration"] for clip in group) if position == "after" else min(clip["start"] for clip in group) - duration
    if start < 0:
        return _placement_failure("no_space_before", "The asset does not fit before the anchor clip.", 0)
    return await _insert_owned_asset(asset_id, start, lane, include_audio, 0, None, tool_context, asset=asset, timeline=timeline)


async def insert_media_moment(asset_id: str, source_start: float, source_end: float, start: float, lane: int, include_audio: bool, tool_context: ToolContext) -> dict[str, Any]:
    """Insert a searched source moment at an exact timeline time without adding the full file."""
    if source_end <= source_start:
        raise ValueError("The source moment range is invalid")
    return await _insert_owned_asset(asset_id, start, lane, include_audio, source_start, source_end - source_start, tool_context)


async def _insert_owned_asset(asset_id: str, start: float, lane: int, include_audio: bool, source_start: float, requested_duration: float | None, tool_context: ToolContext, *, asset: dict[str, Any] | None = None, timeline: dict[str, Any] | None = None) -> dict[str, Any]:
    account_id, project_id, _ = _state(tool_context)
    asset = asset or await project_asset(account_id, project_id, asset_id)
    if not asset:
        raise ValueError("Asset was not found in this project")
    if lane < 0 or start < 0 or source_start < 0:
        raise ValueError("Timeline placement is invalid")
    media_type = str(asset.get("type") or "")
    if not media_type.startswith(("video/", "audio/", "image/")):
        raise ValueError("Only video, audio, and image assets can be placed on the timeline")
    source_duration = float(asset.get("duration") or (source_start + requested_duration if requested_duration else 5))
    duration = _asset_duration(asset, source_start, requested_duration)
    if source_start + duration > source_duration + .01:
        raise ValueError("The requested source moment exceeds the asset duration")
    roles = ["audio"] if media_type.startswith("audio/") else ["visual"]
    if media_type.startswith("video/") and include_audio and asset.get("hasAudio") is not False:
        roles.append("audio")
    timeline = timeline or await _timeline(tool_context)
    conflict = _first_available_start(timeline["clips"], roles, lane, start, duration)
    if conflict > start + .001:
        return _placement_failure("timeline_collision", "The requested lane is occupied at that time.", conflict)
    link_id = str(uuid4()) if len(roles) > 1 else None
    clips = [{"id": str(uuid4()), "assetId": asset_id, "start": start, "duration": duration, "lane": lane, "sourceDuration": source_duration, "trimStart": source_start, "role": role, "volume": 1, **({"linkId": link_id} if link_id else {})} for role in roles]
    result = await _mutate(tool_context, {"kind": "insert_group", "clips": clips})
    result["insertedAsset"] = _safe_asset(asset)
    return result


def _asset_duration(asset: dict[str, Any], source_start: float, requested_duration: float | None) -> float:
    source_duration = float(asset.get("duration") or 5)
    duration = requested_duration if requested_duration is not None else source_duration - source_start
    if duration < .25:
        raise ValueError("The asset placement must be at least 0.25 seconds")
    return duration


def _first_available_start(clips: list[dict[str, Any]], roles: list[str], lane: int, start: float, duration: float) -> float:
    candidate = start
    while True:
        conflicts = [clip for clip in clips if clip.get("role") in roles and clip.get("lane") == lane and candidate < clip["start"] + clip["duration"] - .001 and clip["start"] < candidate + duration - .001]
        if not conflicts:
            return candidate
        candidate = max(clip["start"] + clip["duration"] for clip in conflicts)


def _placement_failure(code: str, error: str, suggested_start: float) -> dict[str, Any]:
    return {"status": "failed", "code": code, "error": error, "retryable": True, "suggestedStart": suggested_start, "action": f"Retry at {suggested_start:.2f} seconds or choose another lane."}


def _safe_asset(asset: dict[str, Any]) -> dict[str, Any]:
    return {key: asset.get(key) for key in ("id", "name", "type", "size", "duration", "hasAudio", "audioProbe", "folderId", "pending")}


async def move_clip(clip_id: str, start: float, lane: int, tool_context: ToolContext) -> dict[str, Any]:
    """Move a timeline clip and linked tracks to a new start and lane."""
    return await _mutate(tool_context, {"kind": "move", "clip_id": clip_id, "start": start, "lane": lane})


async def trim_clip(clip_id: str, edge: Literal["start", "end"], time: float, tool_context: ToolContext) -> dict[str, Any]:
    """Trim a clip and linked tracks at an exact timeline time."""
    return await _mutate(tool_context, {"kind": "trim", "clip_id": clip_id, "edge": edge, "time": time})


async def split_clip(clip_id: str, time: float, tool_context: ToolContext) -> dict[str, Any]:
    """Split a clip and linked tracks at an exact timeline time."""
    return await _mutate(tool_context, {"kind": "split", "clip_id": clip_id, "time": time})


async def delete_clip(clip_id: str, ripple: bool, tool_context: ToolContext) -> dict[str, Any]:
    """Delete a clip and linked tracks, optionally closing the resulting gap."""
    return await _mutate(tool_context, {"kind": "delete", "clip_id": clip_id, "ripple": ripple})


async def replace_clip(clip_id: str, asset_id: str, tool_context: ToolContext) -> dict[str, Any]:
    """Replace a clip and every linked audio/video track with one owned asset."""
    account_id, project_id, _ = _state(tool_context)
    asset = await project_asset(account_id, project_id, asset_id)
    if not asset:
        raise ValueError("Replacement asset was not found in this project")
    return await _mutate(tool_context, {"kind": "replace", "clip_id": clip_id, "asset_id": asset_id, "source_duration": float(asset.get("duration") or .25)})


async def replace_clip_track(clip_id: str, asset_id: str, tool_context: ToolContext) -> dict[str, Any]:
    """Replace only one exact audio or visual clip without changing linked tracks."""
    account_id, project_id, _ = _state(tool_context)
    asset = await project_asset(account_id, project_id, asset_id)
    if not asset:
        raise ValueError("Replacement asset was not found in this project")
    return await _mutate(tool_context, {"kind": "replace_track", "clip_id": clip_id, "asset_id": asset_id, "source_duration": float(asset.get("duration") or .25)})


async def set_volume(clip_id: str, volume: float, tool_context: ToolContext) -> dict[str, Any]:
    """Set the selected audio clip volume from 0 to 2."""
    return await _mutate(tool_context, {"kind": "volume", "clip_id": clip_id, "volume": volume})


async def inspect_visual_issue(tool_context: ToolContext) -> dict[str, Any]:
    """Inspect indexed visual evidence for the selected clip and range."""
    _, clip = await _selected(tool_context, "visual")
    _, project_id, _ = _state(tool_context)
    results = await search_assets(project_id, f"visual readability accessibility issues in {clip['assetId']}", limit=8)
    return {"status": "completed", "clip": clip, "evidence": [{key: item.get(key) for key in ("start", "end", "description", "transcript")} for item in results if item.get("asset_id") == clip["assetId"]]}


async def apply_contrast(level: float, tool_context: ToolContext) -> dict[str, Any]:
    """Apply non-rendering contrast metadata to the selected visual clip."""
    _, clip = await _selected(tool_context, "visual")
    if not .25 <= level <= 4:
        raise ValueError("Contrast must be between 0.25 and 4")
    return await _mutate(tool_context, {"kind": "vision", "clip_id": clip["id"], "adjustments": {"contrast": level}})


async def apply_colour_safe(preset: Literal["red-green", "blue-yellow", "all-channels"], tool_context: ToolContext) -> dict[str, Any]:
    """Apply a non-rendering colour-safe filter to the selected visual clip."""
    _, clip = await _selected(tool_context, "visual")
    return await _mutate(tool_context, {"kind": "vision", "clip_id": clip["id"], "adjustments": {"colorPreset": preset}})


async def apply_large_text(tool_context: ToolContext) -> dict[str, Any]:
    """Enable large text for the active caption or transcript track."""
    timeline, clip = await _selected(tool_context)
    track = dict(timeline.get("captionTrack") or {"clipId": clip["id"], "cues": [], "kind": "captions"})
    track["large"] = True
    return await _mutate(tool_context, {"kind": "caption_track", "track": track, "change": _selection_change(clip)})


async def _narration(action: str, tool_context: ToolContext) -> dict[str, Any]:
    timeline, clip = await _selected(tool_context, "visual")
    account_id, project_id, _ = _state(tool_context)
    asset = await _asset_for_clip(tool_context, clip)
    generated_id = str(uuid4())
    generated = await generate_vision_narration(project_id=project_id, asset_id=generated_id, source_asset_id=clip["assetId"], folder_id=str(asset.get("folderId") or "root"), action=action, start=clip["trimStart"], end=clip["trimStart"] + clip["duration"])
    await register_project_asset(account_id, project_id, generated)
    lane = max((item["lane"] for item in timeline["clips"] if item["role"] == "audio"), default=-1) + 1
    inserted = {"id": str(uuid4()), "assetId": generated_id, "start": clip["start"], "duration": min(clip["duration"], float(generated.get("duration") or clip["duration"])), "lane": lane, "sourceDuration": float(generated.get("duration") or clip["duration"]), "trimStart": 0, "role": "audio", "volume": 1}
    result = await _mutate(tool_context, {"kind": "insert", "clip": inserted})
    result["selection"] = {"clipIds": [inserted["id"]], "playhead": inserted["start"]}
    result["asset"] = generated
    return result


async def apply_audio_description(tool_context: ToolContext) -> dict[str, Any]:
    """Generate timed audio description for the selected visual clip and attach it."""
    return await _narration("audio-description", tool_context)


async def apply_spoken_text(tool_context: ToolContext) -> dict[str, Any]:
    """Generate timed spoken on-screen text for the selected visual clip and attach it."""
    return await _narration("spoken-text", tool_context)


async def apply_captions(tool_context: ToolContext) -> dict[str, Any]:
    """Create a caption track from the selected media transcript."""
    _, clip = await _selected(tool_context)
    asset = await _asset_for_clip(tool_context, clip)
    _, project_id, _ = _state(tool_context)
    cues = await transcript_for_asset(project_id, clip["assetId"], asset.get("objectKey"))
    track = {"clipId": clip["id"], "cues": cues, "large": False, "kind": "captions"}
    return await _mutate(tool_context, {"kind": "caption_track", "track": track, "change": _selection_change(clip)})


async def apply_asl(source: Literal["captions", "description"], tool_context: ToolContext) -> dict[str, Any]:
    """Create an ASL cue track from caption text or the indexed video description without attaching captions."""
    _, clip = await _selected(tool_context)
    asset = await _asset_for_clip(tool_context, clip)
    _, project_id, _ = _state(tool_context)
    try:
        cues = await generate_asl_track(project_id, clip["assetId"], clip["trimStart"], clip["trimStart"] + clip["duration"], source, None, asset.get("objectKey"))
    except AslPreflightError as error:
        raise AgentToolError("asl_prerequisite_missing", str(error), "Do not retry or switch sources. Report the missing prerequisite.") from error
    except AslGenerationError as error:
        raise AgentToolError("asl_generation_stopped", str(error), "Do not retry automatically or switch sources. Tell the user that saved progress will resume on an explicit retry.") from error
    track = {"clipId": clip["id"], "cues": cues, "placement": {"x": .88, "y": .12}}
    return await _mutate(tool_context, {"kind": "asl_track", "track": track, "change": _selection_change(clip)})


async def apply_noise_reduction(strength: float, tool_context: ToolContext) -> dict[str, Any]:
    """Generate and attach a verified noise-reduced replacement for selected media."""
    _, clip = await _selected(tool_context)
    asset = await _asset_for_clip(tool_context, clip)
    account_id, project_id, _ = _state(tool_context)
    generated_id = str(uuid4())
    generated = await reduce_background_noise(project_id=project_id, asset_id=generated_id, source_asset_id=clip["assetId"], source_object_key=str(asset.get("objectKey") or ""), source_name=str(asset.get("name") or "media"), content_type=str(asset.get("type") or ""), folder_id=str(asset.get("folderId") or "root"), strength=strength, duration=asset.get("duration"))
    await register_project_asset(account_id, project_id, generated)
    result = await _mutate(tool_context, {"kind": "replace", "clip_id": clip["id"], "asset_id": generated_id, "source_duration": float(generated.get("duration") or clip["sourceDuration"])})
    result["asset"] = generated
    return result


async def _text_track(kind: str, tool_context: ToolContext) -> dict[str, Any]:
    _, clip = await _selected(tool_context)
    asset = await _asset_for_clip(tool_context, clip)
    _, project_id, _ = _state(tool_context)
    if kind == "braille":
        output = await braille_transcript(project_id, clip["assetId"], asset.get("objectKey"))
        cues = output.get("cues", [])
        track_kind = "braille"
    else:
        cues = await transcript_for_asset(project_id, clip["assetId"], asset.get("objectKey"))
        track_kind = "transcript"
    track = {"clipId": clip["id"], "cues": cues, "large": kind in ("labels", "navigation"), "kind": track_kind, "accessibilityMode": kind}
    return await _mutate(tool_context, {"kind": "caption_track", "track": track, "change": _selection_change(clip)})


async def apply_braille_text(tool_context: ToolContext) -> dict[str, Any]:
    """Create a Braille-ready timed text track for the selected clip."""
    return await _text_track("braille", tool_context)


async def apply_structured_description(tool_context: ToolContext) -> dict[str, Any]:
    """Create a structured timed description track for the selected clip."""
    return await _text_track("structured-description", tool_context)


async def apply_labels(tool_context: ToolContext) -> dict[str, Any]:
    """Create large explicit timed labels for the selected clip."""
    return await _text_track("labels", tool_context)


async def apply_navigation(tool_context: ToolContext) -> dict[str, Any]:
    """Create a navigable structured text track for the selected clip."""
    return await _text_track("navigation", tool_context)


async def apply_tactile_cues(tool_context: ToolContext) -> dict[str, Any]:
    """Create deterministic timed tactile-cue metadata from the selected transcript."""
    return await _text_track("tactile-cues", tool_context)


async def inspect_sensory_issue(tool_context: ToolContext) -> dict[str, Any]:
    """Inspect indexed evidence for flashing, motion, cuts, and visual stimulation."""
    _, clip = await _selected(tool_context, "visual")
    _, project_id, _ = _state(tool_context)
    results = await search_assets(project_id, "flashing rapid motion cuts visual clutter sensory overload", limit=10)
    return {"status": "completed", "clip": clip, "evidence": [{key: item.get(key) for key in ("start", "end", "description")} for item in results if item.get("asset_id") == clip["assetId"]]}


async def _sensory(action: str, tool_context: ToolContext) -> dict[str, Any]:
    _, clip = await _selected(tool_context, "visual")
    asset = await _asset_for_clip(tool_context, clip)
    account_id, project_id, _ = _state(tool_context)
    generated_id = str(uuid4())
    generated = await generate_sensory_video(project_id=project_id, asset_id=generated_id, source_asset_id=clip["assetId"], source_object_key=str(asset.get("objectKey") or ""), source_name=str(asset.get("name") or "video.mp4"), folder_id=str(asset.get("folderId") or "root"), action=action, start=clip["trimStart"], end=clip["trimStart"] + clip["duration"])
    await register_project_asset(account_id, project_id, generated)
    result = await _mutate(tool_context, {"kind": "replace", "clip_id": clip["id"], "asset_id": generated_id, "source_duration": float(generated.get("duration") or clip["sourceDuration"])})
    result["asset"] = generated
    return result


async def reduce_flash(tool_context: ToolContext) -> dict[str, Any]:
    """Generate and attach a photosensitivity-safe version of the selected video."""
    return await _sensory("reduce-flash", tool_context)


async def reduce_motion(tool_context: ToolContext) -> dict[str, Any]:
    """Generate and attach a lower-motion version of the selected video."""
    return await _sensory("reduce-motion", tool_context)


async def stabilize(tool_context: ToolContext) -> dict[str, Any]:
    """Generate and attach a stabilized version of the selected video."""
    return await _sensory("stabilize", tool_context)


async def reduce_cuts(tool_context: ToolContext) -> dict[str, Any]:
    """Generate and attach a version with fewer rapid cuts."""
    return await _sensory("fewer-cuts", tool_context)


async def reduce_stimulus(tool_context: ToolContext) -> dict[str, Any]:
    """Generate and attach a lower-stimulation version of the selected video."""
    return await _sensory("less-stimulus", tool_context)


async def create_static_version(tool_context: ToolContext) -> dict[str, Any]:
    """Generate and attach a nearly static alternative to the selected video."""
    return await _sensory("static-version", tool_context)


async def _translate(action: str, language: str, tool_context: ToolContext) -> dict[str, Any]:
    timeline, clip = await _selected(tool_context)
    asset = await _asset_for_clip(tool_context, clip)
    account_id, project_id, _ = _state(tool_context)
    generated_id = str(uuid4())
    output = await generate_language_track(project_id=project_id, asset_id=generated_id, source_asset_id=clip["assetId"], source_object_key=str(asset.get("objectKey") or ""), source_generation=str(asset.get("generation") or ""), source_duration=asset.get("duration"), source_name=str(asset.get("name") or "media"), folder_id=str(asset.get("folderId") or "root"), action=action, language=language, start=clip["trimStart"], end=clip["trimStart"] + clip["duration"])
    if action == "captions":
        track = {"clipId": clip["id"], "cues": output["cues"], "large": False, "kind": "captions", "language": language}
        return await _mutate(tool_context, {"kind": "caption_track", "track": track, "change": _selection_change(clip)})
    generated = output.get("asset")
    if not isinstance(generated, dict):
        raise RuntimeError("Translation returned no generated audio")
    await register_project_asset(account_id, project_id, generated)
    lane = max((item["lane"] for item in timeline["clips"] if item["role"] == "audio"), default=-1) + 1
    inserted = {"id": str(uuid4()), "assetId": generated_id, "start": clip["start"], "duration": min(clip["duration"], float(generated.get("duration") or clip["duration"])), "lane": lane, "sourceDuration": float(generated.get("duration") or clip["duration"]), "trimStart": 0, "role": "audio", "volume": 1}
    operation = {"kind": "dub", "clip_id": clip["id"], "clip": inserted} if action == "audio" else {"kind": "insert", "clip": inserted}
    result = await _mutate(tool_context, operation)
    result["selection"] = {"clipIds": [inserted["id"]], "playhead": inserted["start"]}
    result["asset"] = generated
    return result


async def translate_captions(language: str, tool_context: ToolContext) -> dict[str, Any]:
    """Translate captions for the selected clip into a supported language code."""
    return await _translate("captions", language, tool_context)


async def translate_audio(language: str, tool_context: ToolContext) -> dict[str, Any]:
    """Translate selected dialogue into timed multi-speaker audio."""
    return await _translate("audio", language, tool_context)


async def translate_descriptions(language: str, tool_context: ToolContext) -> dict[str, Any]:
    """Translate selected visual descriptions into timed spoken audio."""
    return await _translate("descriptions", language, tool_context)


TOOLS_BY_AGENT = {
    "edit": [read_attached_skill, read_timeline_shot, read_timeline, read_selection, select_timeline_clip, read_project, list_project_assets, inspect_asset, search_media, insert_asset, insert_asset_at_playhead, insert_asset_next_to, insert_media_moment, move_clip, trim_clip, split_clip, delete_clip, replace_clip, replace_clip_track, set_volume],
    "vision": [read_attached_skill, read_timeline_shot, read_selection, select_timeline_clip, inspect_visual_issue, apply_audio_description, apply_spoken_text, apply_contrast, apply_colour_safe, apply_large_text],
    "hearing": [read_attached_skill, read_timeline_shot, read_selection, select_timeline_clip, read_transcript, apply_captions, apply_asl, apply_noise_reduction],
    "deafblind": [read_attached_skill, read_timeline_shot, read_selection, select_timeline_clip, read_transcript, apply_braille_text, apply_structured_description, apply_labels, apply_navigation, apply_tactile_cues],
    "sensory": [read_attached_skill, read_timeline_shot, read_selection, select_timeline_clip, inspect_sensory_issue, reduce_flash, reduce_motion, stabilize, reduce_cuts, reduce_stimulus, create_static_version],
    "language": [read_attached_skill, read_timeline_shot, read_selection, select_timeline_clip, read_speaker_turns, translate_captions, translate_audio, translate_descriptions],
}


TOOL_NAMES_BY_AGENT = {agent_id: {tool.__name__ for tool in tools} for agent_id, tools in TOOLS_BY_AGENT.items()}
