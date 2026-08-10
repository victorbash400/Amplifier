from __future__ import annotations

import asyncio
from copy import deepcopy
import json
import math
from typing import Any, Literal
from uuid import uuid4

from app.accounts import DATABASE_PATH, account_owns_project, project_asset
from app.database import connect, lock_project


MINIMUM_DURATION = 0.25
_schema_lock = asyncio.Lock()
_schema_ready = False


class TimelineConflict(ValueError):
    pass


async def ensure_timeline_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return
    async with _schema_lock:
        if _schema_ready:
            return
        async with connect(DATABASE_PATH) as database:
            await database.execute("PRAGMA foreign_keys = ON")
            await database.execute("CREATE TABLE IF NOT EXISTS timelines (project_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, revision INTEGER NOT NULL, document_json TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE, FOREIGN KEY (account_id) REFERENCES users(id) ON DELETE CASCADE)")
            await database.execute("CREATE TABLE IF NOT EXISTS timeline_requests (project_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (project_id, idempotency_key), FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE)")
            await database.commit()
        _schema_ready = True


def empty_timeline() -> dict[str, Any]:
    return {"revision": 0, "clips": [], "trackCounts": {"audio": 1, "visual": 1}, "captionTrack": None, "aslTrack": None}


async def read_timeline(account_id: str, project_id: str) -> dict[str, Any]:
    await _require_project(account_id, project_id)
    await ensure_timeline_schema()
    async with connect(DATABASE_PATH) as database:
        cursor = await database.execute("SELECT revision, document_json FROM timelines WHERE project_id = ? AND account_id = ?", (project_id, account_id))
        row = await cursor.fetchone()
    if not row:
        return empty_timeline()
    document = json.loads(row[1])
    document["revision"] = int(row[0])
    return document


async def sync_timeline(account_id: str, project_id: str, expected_revision: int, document: dict[str, Any]) -> dict[str, Any]:
    await _require_project(account_id, project_id)
    clean = await _validated_document(account_id, project_id, document)
    await ensure_timeline_schema()
    async with connect(DATABASE_PATH) as database:
        await lock_project(database, project_id, account_id)
        cursor = await database.execute("SELECT revision, document_json FROM timelines WHERE project_id = ? AND account_id = ?", (project_id, account_id))
        row = await cursor.fetchone()
        current_revision = int(row[0]) if row else 0
        current = json.loads(row[1]) if row else empty_timeline()
        comparable = {key: value for key, value in clean.items() if key != "revision"}
        current_comparable = {key: value for key, value in current.items() if key != "revision"}
        if expected_revision != current_revision:
            if comparable == current_comparable:
                clean["revision"] = current_revision
                await database.rollback()
                return clean
            await database.rollback()
            raise TimelineConflict(f"Timeline changed from revision {expected_revision} to {current_revision}")
        if comparable == current_comparable:
            clean["revision"] = current_revision
            await database.rollback()
            return clean
        revision = current_revision + 1
        clean["revision"] = revision
        await database.execute("INSERT INTO timelines (project_id, account_id, revision, document_json, updated_at) VALUES (?, ?, ?, ?, datetime('now')) ON CONFLICT(project_id) DO UPDATE SET revision = excluded.revision, document_json = excluded.document_json, updated_at = excluded.updated_at WHERE timelines.account_id = excluded.account_id", (project_id, account_id, revision, json.dumps(clean, separators=(",", ":"))))
        await database.commit()
    return clean


async def apply_operation(account_id: str, project_id: str, expected_revision: int, operation: dict[str, Any], idempotency_key: str) -> dict[str, Any]:
    await _require_project(account_id, project_id)
    await ensure_timeline_schema()
    async with connect(DATABASE_PATH) as database:
        await lock_project(database, project_id, account_id)
        cursor = await database.execute("SELECT response_json FROM timeline_requests WHERE project_id = ? AND idempotency_key = ?", (project_id, idempotency_key))
        cached = await cursor.fetchone()
        if cached:
            await database.rollback()
            return json.loads(cached[0])
        cursor = await database.execute("SELECT revision, document_json FROM timelines WHERE project_id = ? AND account_id = ?", (project_id, account_id))
        row = await cursor.fetchone()
        current_revision = int(row[0]) if row else 0
        if current_revision != expected_revision:
            await database.rollback()
            raise TimelineConflict(f"Timeline changed from revision {expected_revision} to {current_revision}")
        document = json.loads(row[1]) if row else empty_timeline()
        before = deepcopy(document.get("clips", []))
        if operation.get("kind") == "caption_track":
            document["captionTrack"] = deepcopy(operation.get("track"))
        elif operation.get("kind") == "asl_track":
            document["aslTrack"] = deepcopy(operation.get("track"))
        else:
            document["clips"] = _apply(before, operation)
            counts = document.get("trackCounts") if isinstance(document.get("trackCounts"), dict) else {}
            document["trackCounts"] = {
                role: max(int(counts.get(role, 1)), max((clip["lane"] + 1 for clip in document["clips"] if clip.get("role") == role), default=1))
                for role in ("audio", "visual")
            }
        document = await _validated_document(account_id, project_id, document)
        document["revision"] = current_revision + 1
        change = deepcopy(operation.get("change")) if isinstance(operation.get("change"), dict) else _change(before, document["clips"])
        response = {"status": "completed", "timeline": document, "change": change, "message": _message(operation)}
        encoded_document = json.dumps(document, separators=(",", ":"))
        encoded_response = json.dumps(response, separators=(",", ":"))
        await database.execute("INSERT INTO timelines (project_id, account_id, revision, document_json, updated_at) VALUES (?, ?, ?, ?, datetime('now')) ON CONFLICT(project_id) DO UPDATE SET revision = excluded.revision, document_json = excluded.document_json, updated_at = excluded.updated_at WHERE timelines.account_id = excluded.account_id", (project_id, account_id, document["revision"], encoded_document))
        await database.execute("INSERT INTO timeline_requests (project_id, idempotency_key, response_json, created_at) VALUES (?, ?, ?, datetime('now'))", (project_id, idempotency_key, encoded_response))
        await database.commit()
        return response


async def _validated_document(account_id: str, project_id: str, document: dict[str, Any]) -> dict[str, Any]:
    clips = document.get("clips", [])
    if not isinstance(clips, list) or len(clips) > 500:
        raise ValueError("Timeline clips are invalid")
    clean_clips: list[dict[str, Any]] = []
    ids: set[str] = set()
    for raw in clips:
        if not isinstance(raw, dict):
            raise ValueError("Timeline clip is invalid")
        clip_id = str(raw.get("id") or "")
        asset_id = str(raw.get("assetId") or "")
        if not clip_id or clip_id in ids or not asset_id:
            raise ValueError("Timeline clip identifiers are invalid")
        asset = await project_asset(account_id, project_id, asset_id)
        if not asset:
            raise ValueError(f"Timeline asset {asset_id} is unavailable")
        role = str(raw.get("role") or "")
        if role not in ("visual", "audio"):
            raise ValueError("Timeline clip role is invalid")
        start = _number(raw.get("start"), "start", minimum=0)
        duration = _number(raw.get("duration"), "duration", minimum=MINIMUM_DURATION)
        source_duration = _number(raw.get("sourceDuration"), "source duration", minimum=MINIMUM_DURATION)
        trim_start = _number(raw.get("trimStart"), "trim start", minimum=0)
        lane = raw.get("lane")
        if not isinstance(lane, int) or lane < 0 or lane > 100:
            raise ValueError("Timeline lane is invalid")
        if trim_start + duration > source_duration + .01:
            raise ValueError("Timeline clip exceeds its source duration")
        clip = {"id": clip_id, "assetId": asset_id, "start": start, "duration": duration, "lane": lane, "sourceDuration": source_duration, "trimStart": trim_start, "role": role, "volume": _number(raw.get("volume", 1), "volume", minimum=0, maximum=2)}
        if raw.get("linkId"):
            clip["linkId"] = str(raw["linkId"])
        if isinstance(raw.get("visionAdjustments"), dict):
            clip["visionAdjustments"] = raw["visionAdjustments"]
        ids.add(clip_id)
        clean_clips.append(clip)
    for index, clip in enumerate(clean_clips):
        for other in clean_clips[index + 1:]:
            if clip["role"] == other["role"] and clip["lane"] == other["lane"] and clip["start"] < other["start"] + other["duration"] - .001 and other["start"] < clip["start"] + clip["duration"] - .001:
                raise ValueError("Timeline clips overlap on the same lane")
    tracks = document.get("trackCounts") if isinstance(document.get("trackCounts"), dict) else {}
    track_counts = {"audio": max(1, int(tracks.get("audio", 1))), "visual": max(1, int(tracks.get("visual", 1)))}
    return {"revision": int(document.get("revision", 0)), "clips": clean_clips, "trackCounts": track_counts, "captionTrack": document.get("captionTrack"), "aslTrack": document.get("aslTrack")}


def _apply(clips: list[dict[str, Any]], operation: dict[str, Any]) -> list[dict[str, Any]]:
    kind = operation.get("kind")
    clip_id = str(operation.get("clip_id") or "")
    selected = next((clip for clip in clips if clip["id"] == clip_id), None)
    if kind == "insert":
        clip = deepcopy(operation.get("clip"))
        if not isinstance(clip, dict):
            raise ValueError("Insert clip is invalid")
        return [*clips, clip]
    if kind == "insert_group":
        inserted = deepcopy(operation.get("clips"))
        if not isinstance(inserted, list) or not inserted or any(not isinstance(clip, dict) for clip in inserted):
            raise ValueError("Insert clip group is invalid")
        return [*clips, *inserted]
    if not selected:
        raise ValueError("Timeline clip was not found")
    group_ids = {clip["id"] for clip in clips if clip["id"] == clip_id or selected.get("linkId") and clip.get("linkId") == selected.get("linkId")}
    if kind == "delete":
        removed = [clip for clip in clips if clip["id"] in group_ids]
        remaining = [deepcopy(clip) for clip in clips if clip["id"] not in group_ids]
        if operation.get("ripple"):
            cut_start = min(clip["start"] for clip in removed)
            cut_duration = max(clip["start"] + clip["duration"] for clip in removed) - cut_start
            for clip in remaining:
                if clip["start"] >= cut_start + cut_duration:
                    clip["start"] = max(cut_start, clip["start"] - cut_duration)
        return remaining
    if kind == "move":
        desired = _number(operation.get("start"), "start", minimum=0)
        lane = operation.get("lane")
        if not isinstance(lane, int) or lane < 0:
            raise ValueError("Timeline lane is invalid")
        delta_time = desired - selected["start"]
        delta_lane = lane - selected["lane"]
        return [{**clip, "start": max(0, clip["start"] + delta_time), "lane": max(0, clip["lane"] + delta_lane)} if clip["id"] in group_ids else deepcopy(clip) for clip in clips]
    if kind == "trim":
        edge = operation.get("edge")
        time = _number(operation.get("time"), "time", minimum=0)
        result = deepcopy(clips)
        for clip in result:
            if clip["id"] not in group_ids:
                continue
            if edge == "start":
                new_start = min(max(clip["start"] - clip["trimStart"], time), clip["start"] + clip["duration"] - MINIMUM_DURATION)
                change = new_start - clip["start"]
                clip.update(start=new_start, duration=clip["duration"] - change, trimStart=clip["trimStart"] + change)
            elif edge == "end":
                clip["duration"] = min(clip["sourceDuration"] - clip["trimStart"], max(MINIMUM_DURATION, time - clip["start"]))
            else:
                raise ValueError("Trim edge is invalid")
        return result
    if kind == "split":
        time = _number(operation.get("time"), "time", minimum=0)
        if time <= selected["start"] or time >= selected["start"] + selected["duration"]:
            raise ValueError("Split time must be inside the selected clip")
        split_link = str(uuid4()) if selected.get("linkId") else None
        result = []
        for clip in clips:
            if clip["id"] not in group_ids:
                result.append(deepcopy(clip))
                continue
            left_duration = time - clip["start"]
            right = {**clip, "id": str(uuid4()), "start": time, "duration": clip["duration"] - left_duration, "trimStart": clip["trimStart"] + left_duration}
            left = {**clip, "duration": left_duration}
            if split_link:
                left["linkId"] = split_link
                right["linkId"] = split_link
            result.extend((left, right))
        return result
    if kind == "volume":
        volume = _number(operation.get("volume"), "volume", minimum=0, maximum=2)
        return [{**clip, "volume": volume} if clip["id"] in group_ids and clip["role"] == "audio" else deepcopy(clip) for clip in clips]
    if kind == "vision":
        adjustments = deepcopy(selected.get("visionAdjustments") or {})
        adjustments.update(operation.get("adjustments") or {})
        return [{**clip, "visionAdjustments": adjustments} if clip["id"] in group_ids and clip["role"] == "visual" else deepcopy(clip) for clip in clips]
    if kind == "dub":
        inserted = deepcopy(operation.get("clip"))
        if not isinstance(inserted, dict) or inserted.get("role") != "audio":
            raise ValueError("Dub audio clip is invalid")
        muted = [{**clip, "volume": 0} if clip["id"] in group_ids and clip["role"] == "audio" else deepcopy(clip) for clip in clips]
        return [*muted, inserted]
    if kind == "replace":
        asset_id = str(operation.get("asset_id") or "")
        source_duration = _number(operation.get("source_duration"), "source duration", minimum=MINIMUM_DURATION)
        return [{**clip, "assetId": asset_id, "sourceDuration": source_duration, "duration": min(clip["duration"], source_duration), "trimStart": min(clip["trimStart"], max(0, source_duration - MINIMUM_DURATION))} if clip["id"] in group_ids else deepcopy(clip) for clip in clips]
    if kind == "replace_track":
        asset_id = str(operation.get("asset_id") or "")
        source_duration = _number(operation.get("source_duration"), "source duration", minimum=MINIMUM_DURATION)
        return [{**clip, "assetId": asset_id, "sourceDuration": source_duration, "duration": min(clip["duration"], source_duration), "trimStart": min(clip["trimStart"], max(0, source_duration - MINIMUM_DURATION))} if clip["id"] == clip_id else deepcopy(clip) for clip in clips]
    raise ValueError("Unsupported timeline operation")


def _change(before: list[dict[str, Any]], after: list[dict[str, Any]]) -> dict[str, Any]:
    previous = {clip["id"]: clip for clip in before}
    current = {clip["id"]: clip for clip in after}
    ids = sorted({*previous, *current} - {clip_id for clip_id in previous.keys() & current.keys() if previous[clip_id] == current[clip_id]})
    affected = [clip for clip_id in ids for clip in (previous.get(clip_id), current.get(clip_id)) if clip]
    return {"start": min((clip["start"] for clip in affected), default=0), "end": max((clip["start"] + clip["duration"] for clip in affected), default=0), "lanes": sorted({clip["lane"] for clip in affected}), "clipIds": ids}


def _message(operation: dict[str, Any]) -> str:
    return {"insert": "Inserted media on the timeline.", "insert_group": "Inserted linked media on the timeline.", "move": "Moved the selected timeline clip.", "trim": "Trimmed the selected timeline clip.", "split": "Split the selected timeline clip.", "delete": "Deleted the selected timeline clip.", "replace": "Replaced the selected linked media.", "replace_track": "Replaced one timeline track.", "dub": "Added translated dialogue and muted the original audio.", "volume": "Updated the selected audio level.", "vision": "Updated the selected visual settings.", "caption_track": "Updated the timeline text track.", "asl_track": "Updated the timeline sign-language track."}.get(str(operation.get("kind")), "Updated the timeline.")


def _number(value: object, label: str, *, minimum: float | None = None, maximum: float | None = None) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise ValueError(f"Timeline {label} is invalid")
    number = float(value)
    if minimum is not None and number < minimum or maximum is not None and number > maximum:
        raise ValueError(f"Timeline {label} is invalid")
    return number


async def _require_project(account_id: str, project_id: str) -> None:
    if not await account_owns_project(account_id, project_id):
        raise ValueError("Project not found")
