import asyncio
from contextlib import asynccontextmanager
import hmac
import json
import logging
from pathlib import Path
from typing import Annotated
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.accounts import account_owns_project, authenticate_account, create_account, load_workspace, save_workspace
from app.agent_stream import branch_session, ensure_session, stream_agent_events, update_session_context
from app.asl_tools import generate_asl_track
from app.asset_storage import create_upload_session, delete_asset, open_asset_stream, verify_uploaded_asset
from app.braille import braille_transcript
from app.clickhouse import check_clickhouse
from app.config import settings
from app.hearing_tools import reduce_background_noise
from app.language_tools import generate_language_track
from app.media_search import asset_transcript, index_asset, index_status, remove_asset_index, search_assets
from app.sensory_tools import generate_sensory_video
from app.timeline_renderer import RenderClip, render_timeline
from app.timeline_service import TimelineConflict, read_timeline, sync_timeline
from app.tools.scoped_clickhouse_mcp import scoped_clickhouse_server
from app.transcript_service import transcript_for_asset
from app.vision_tools import generate_vision_filter, generate_vision_narration


mcp_app = scoped_clickhouse_server.streamable_http_app()


@asynccontextmanager
async def lifespan(_: FastAPI):
    async with scoped_clickhouse_server.session_manager.run():
        yield


app = FastAPI(title="Amplifier API", lifespan=lifespan)
app.mount("/mcp", mcp_app)
logger = logging.getLogger(__name__)
background_index_tasks: set[asyncio.Task[None]] = set()


class AccountRequest(BaseModel):
    email: str
    password: str
    name: str = ""


class WorkspaceRequest(BaseModel):
    workspace: dict[str, object] | None = None


def authenticated_account_id(
    account_id: Annotated[str | None, Header(alias="X-Amplifier-Account")] = None,
    internal_secret: Annotated[str | None, Header(alias="X-Amplifier-Internal-Secret")] = None,
) -> str:
    if not settings.internal_secret:
        raise HTTPException(status_code=503, detail="Amplifier internal authentication is not configured")
    if not account_id or not internal_secret or not hmac.compare_digest(internal_secret, settings.internal_secret):
        raise HTTPException(status_code=401, detail="Authentication required")
    return account_id


async def require_project(account_id: str, project_id: str) -> None:
    if not await account_owns_project(account_id, project_id):
        raise HTTPException(status_code=404, detail="Project not found")


class ChatRequest(BaseModel):
    user_id: str = Field(default="local-user", min_length=1)
    session_id: str = Field(min_length=1)
    message: str = Field(min_length=1)
    agent_id: str = Field(default="general", pattern=r"^(general|edit|vision|hearing|deafblind|sensory|language)$")
    project_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    selected_clip_ids: list[str] = Field(default_factory=list, max_length=20)
    playhead: float = Field(default=0, ge=0)
    timeline_revision: int = Field(default=0, ge=0)
    timeline: dict[str, object]
    timeline_shot: dict[str, object] | None = None


class TimelineSyncRequest(BaseModel):
    project_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    expected_revision: int = Field(ge=0)
    timeline: dict[str, object]


class BranchChatRequest(BaseModel):
    user_id: str = Field(default="local-user", min_length=1)
    source_session_id: str = Field(min_length=1)
    target_session_id: str = Field(min_length=1)
    agent_id: str = Field(default="general", pattern=r"^(general|edit|vision|hearing|deafblind|sensory|language)$")


class AssetUploadRequest(BaseModel):
    project_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    asset_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    file_name: str = Field(min_length=1, max_length=255)
    content_type: str = Field(min_length=1, max_length=255)
    size: int = Field(gt=0, le=20 * 1024 * 1024 * 1024)
    origin: str | None = None


class AssetUploadCompleteRequest(BaseModel):
    project_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    asset_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    file_name: str = Field(min_length=1, max_length=255)
    size: int = Field(gt=0, le=20 * 1024 * 1024 * 1024)


class AssetDeleteRequest(BaseModel):
    project_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    asset_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    object_key: str = Field(min_length=1, max_length=1024)


class MediaIndexRequest(BaseModel):
    project_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    asset_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    object_key: str = Field(min_length=1, max_length=1024)
    name: str = Field(min_length=1, max_length=255)
    content_type: str = Field(min_length=1, max_length=255)
    folder_id: str = Field(default="root", min_length=1, max_length=100)
    duration: float | None = Field(default=None, ge=0)
    force: bool = False


class MediaSearchRequest(BaseModel):
    project_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    query: str = Field(min_length=2, max_length=240)


class MediaTranscriptRequest(BaseModel):
    project_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    asset_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    object_key: str | None = Field(default=None, max_length=1024)


class VisionNarrationRequest(BaseModel):
    project_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    asset_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    source_asset_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    folder_id: str = Field(default="root", min_length=1, max_length=100)
    action: str = Field(pattern=r"^(audio-description|spoken-text)$")
    start: float = Field(ge=0)
    end: float = Field(gt=0)


class VisionFilterRequest(BaseModel):
    project_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    asset_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    source_asset_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    source_object_key: str = Field(min_length=1, max_length=1024)
    source_name: str = Field(min_length=1, max_length=255)
    content_type: str = Field(pattern=r"^(video|image)/")
    folder_id: str = Field(default="root", min_length=1, max_length=100)
    action: str = Field(pattern=r"^(contrast|color-safe)$")
    preset: str | None = Field(default=None, pattern=r"^(red-green|blue-yellow|all-channels)$")
    start: float = Field(ge=0)
    end: float = Field(gt=0)


class AslSourceCue(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    start: float = Field(ge=0)
    end: float = Field(ge=0)
    text: str = Field(min_length=1, max_length=2000)


class AslTrackRequest(BaseModel):
    project_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    asset_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    source: str = Field(pattern=r"^(transcript|description)$")
    cues: list[AslSourceCue] | None = Field(default=None, max_length=100)
    source_object_key: str | None = Field(default=None, max_length=1024)


class NoiseReductionRequest(BaseModel):
    project_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    asset_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    source_asset_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    source_object_key: str = Field(min_length=1, max_length=1024)
    source_name: str = Field(min_length=1, max_length=255)
    content_type: str = Field(pattern=r"^(video|audio)/")
    folder_id: str = Field(default="root", min_length=1, max_length=100)
    strength: float = Field(ge=0, le=1)
    duration: float | None = Field(default=None, ge=0)


class SensoryVideoRequest(BaseModel):
    project_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    asset_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    source_asset_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    source_object_key: str = Field(min_length=1, max_length=1024)
    source_name: str = Field(min_length=1, max_length=255)
    folder_id: str = Field(default="root", min_length=1, max_length=100)
    action: str = Field(pattern=r"^(reduce-flash|reduce-motion|stabilize|fewer-cuts|less-stimulus|static-version)$")
    start: float = Field(ge=0)
    end: float = Field(gt=0)


class LanguageTrackRequest(BaseModel):
    project_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    asset_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    source_asset_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    source_object_key: str = Field(min_length=1, max_length=1024)
    source_generation: str = Field(default="", max_length=100)
    source_duration: float | None = Field(default=None, ge=0)
    source_name: str = Field(min_length=1, max_length=255)
    folder_id: str = Field(default="root", min_length=1, max_length=100)
    action: str = Field(pattern=r"^(captions|audio|descriptions)$")
    language: str = Field(pattern=r"^(en|es|fr|de|pt|it|ar|hi|ja|ko|zh)$")
    start: float = Field(ge=0)
    end: float = Field(gt=0)


class TimelineRenderClipRequest(BaseModel):
    asset_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    object_key: str = Field(min_length=1, max_length=1024)
    name: str = Field(min_length=1, max_length=255)
    content_type: str = Field(pattern=r"^(video|audio|image)/")
    start: float = Field(ge=0)
    duration: float = Field(gt=0)
    source_duration: float = Field(gt=0)
    trim_start: float = Field(ge=0)
    lane: int = Field(ge=0, le=100)
    role: str = Field(pattern=r"^(visual|audio)$")
    volume: float = Field(default=1, ge=0, le=2)
    contrast: float = Field(default=1, ge=.25, le=4)
    color_preset: str | None = Field(default=None, pattern=r"^(red-green|blue-yellow|all-channels)$")


class TimelineExportRequest(BaseModel):
    project_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    name: str = Field(min_length=1, max_length=100)
    folder_id: str = Field(default="root", min_length=1, max_length=100)
    clips: list[TimelineRenderClipRequest] = Field(min_length=1, max_length=500)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/accounts", status_code=201)
async def register_account(body: AccountRequest) -> dict[str, dict[str, str]]:
    try:
        account = await create_account(body.email, body.password, body.name)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {"account": account}


@app.post("/accounts/authenticate")
async def authenticate(body: AccountRequest) -> dict[str, str]:
    account = await authenticate_account(body.email, body.password)
    if not account:
        raise HTTPException(status_code=401, detail="Email or password is incorrect")
    return account


@app.post("/workspace/read")
async def read_workspace(body: WorkspaceRequest, account_id: Annotated[str, Depends(authenticated_account_id)]) -> dict[str, list[dict[str, object]]]:
    return await load_workspace(account_id)


@app.put("/workspace")
async def write_workspace(body: WorkspaceRequest, account_id: Annotated[str, Depends(authenticated_account_id)]) -> dict[str, str]:
    if body.workspace is None:
        raise HTTPException(status_code=400, detail="Workspace is required")
    try:
        await save_workspace(account_id, body.workspace)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {"status": "saved"}


@app.get("/clickhouse/health")
async def clickhouse_health() -> dict[str, str]:
    try:
        await check_clickhouse()
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    return {"status": "ok"}


@app.post("/assets/uploads")
async def begin_asset_upload(body: AssetUploadRequest, account_id: Annotated[str, Depends(authenticated_account_id)]) -> dict[str, str]:
    await require_project(account_id, body.project_id)
    try:
        upload_url, object_key = await asyncio.to_thread(
            create_upload_session,
            project_id=body.project_id,
            asset_id=body.asset_id,
            file_name=body.file_name,
            content_type=body.content_type,
            size=body.size,
            origin=body.origin,
        )
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    return {"upload_url": upload_url, "object_key": object_key}


@app.post("/assets/uploads/complete")
async def complete_asset_upload(body: AssetUploadCompleteRequest, account_id: Annotated[str, Depends(authenticated_account_id)]) -> dict[str, str | int | bool | None]:
    await require_project(account_id, body.project_id)
    try:
        asset = await asyncio.to_thread(
            verify_uploaded_asset,
            project_id=body.project_id,
            asset_id=body.asset_id,
            file_name=body.file_name,
            expected_size=body.size,
        )
    except Exception as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return {
        "object_key": asset.object_key,
        "generation": asset.generation,
        "size": asset.size,
        "content_type": asset.content_type,
        "has_audio": asset.has_audio,
    }


@app.get("/assets/media")
async def asset_media(project_id: str, object_key: str, account_id: Annotated[str, Depends(authenticated_account_id)], range: str | None = None) -> StreamingResponse:
    await require_project(account_id, project_id)
    try:
        asset = await asyncio.to_thread(open_asset_stream, project_id=project_id, object_key=object_key, range_header=range)
    except Exception as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    partial = asset.start > 0 or asset.end < asset.size - 1
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(asset.end - asset.start + 1),
        "ETag": f'"{asset.generation}"',
        "Cache-Control": "private, max-age=86400",
    }
    if partial:
        headers["Content-Range"] = f"bytes {asset.start}-{asset.end}/{asset.size}"
    return StreamingResponse(asset.body, status_code=206 if partial else 200, media_type=asset.content_type, headers=headers)


@app.delete("/assets")
async def remove_asset(body: AssetDeleteRequest, account_id: Annotated[str, Depends(authenticated_account_id)]) -> None:
    await require_project(account_id, body.project_id)
    try:
        await remove_asset_index(project_id=body.project_id, asset_id=body.asset_id)
        await asyncio.to_thread(delete_asset, project_id=body.project_id, object_key=body.object_key)
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.get("/search/index")
async def media_index_status(project_id: str, account_id: Annotated[str, Depends(authenticated_account_id)]) -> dict[str, object]:
    await require_project(account_id, project_id)
    try:
        return {"assets": await index_status(project_id)}
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.post("/search/index")
async def create_media_index(body: MediaIndexRequest, account_id: Annotated[str, Depends(authenticated_account_id)]) -> StreamingResponse:
    await require_project(account_id, body.project_id)
    async def events():
        queue: asyncio.Queue[dict[str, object] | None] = asyncio.Queue()

        async def progress(event: dict[str, object]) -> None:
            await queue.put(event)

        async def run() -> None:
            try:
                result = await index_asset(
                    project_id=body.project_id,
                    asset_id=body.asset_id,
                    object_key=body.object_key,
                    name=body.name,
                    content_type=body.content_type,
                    folder_id=body.folder_id,
                    duration=body.duration,
                    force=body.force,
                    on_progress=progress,
                )
                if result.get("reused"):
                    await queue.put(result)
            except Exception as error:
                logger.exception("Media indexing failed for asset %s in project %s", body.asset_id, body.project_id)
                await queue.put({"asset_id": body.asset_id, "status": "failed", "stage": "Failed", "error": str(error)})
            finally:
                await queue.put(None)

        task = asyncio.create_task(run())
        background_index_tasks.add(task)
        task.add_done_callback(background_index_tasks.discard)
        while True:
            event = await queue.get()
            if event is None:
                break
            yield json.dumps(event, separators=(",", ":")) + "\n"

    return StreamingResponse(events(), media_type="application/x-ndjson", headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


@app.post("/search/query")
async def query_media_index(body: MediaSearchRequest, account_id: Annotated[str, Depends(authenticated_account_id)]) -> dict[str, object]:
    await require_project(account_id, body.project_id)
    try:
        return {"results": await search_assets(body.project_id, body.query)}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.post("/search/transcript")
async def read_media_transcript(body: MediaTranscriptRequest, account_id: Annotated[str, Depends(authenticated_account_id)]) -> dict[str, object]:
    await require_project(account_id, body.project_id)
    try:
        return {"cues": await transcript_for_asset(body.project_id, body.asset_id, body.object_key)}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.post("/search/braille")
async def read_braille_transcript(body: MediaTranscriptRequest, account_id: Annotated[str, Depends(authenticated_account_id)]) -> dict[str, object]:
    await require_project(account_id, body.project_id)
    try:
        return await braille_transcript(body.project_id, body.asset_id, body.object_key)
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.post("/vision/narration")
async def create_vision_narration(body: VisionNarrationRequest, account_id: Annotated[str, Depends(authenticated_account_id)]) -> dict[str, object]:
    await require_project(account_id, body.project_id)
    if body.end <= body.start:
        raise HTTPException(status_code=400, detail="The selected clip range is invalid")
    try:
        return {"asset": await generate_vision_narration(project_id=body.project_id, asset_id=body.asset_id, source_asset_id=body.source_asset_id, folder_id=body.folder_id, action=body.action, start=body.start, end=body.end)}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.post("/language/track")
async def create_language_track(body: LanguageTrackRequest, account_id: Annotated[str, Depends(authenticated_account_id)]) -> dict[str, object]:
    await require_project(account_id, body.project_id)
    if body.end <= body.start:
        raise HTTPException(status_code=400, detail="The selected clip range is invalid")
    try:
        return await generate_language_track(project_id=body.project_id, asset_id=body.asset_id, source_asset_id=body.source_asset_id, source_object_key=body.source_object_key, source_generation=body.source_generation, source_duration=body.source_duration, source_name=body.source_name, folder_id=body.folder_id, action=body.action, language=body.language, start=body.start, end=body.end)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.post("/timelines/export", status_code=201)
async def export_timeline(body: TimelineExportRequest, account_id: Annotated[str, Depends(authenticated_account_id)]) -> dict[str, object]:
    await require_project(account_id, body.project_id)
    workspace = await load_workspace(account_id)
    if body.folder_id != "root" and not any(isinstance(folder, dict) and folder.get("id") == body.folder_id and folder.get("projectId") == body.project_id for folder in workspace["folders"]):
        raise HTTPException(status_code=400, detail="Destination folder was not found")
    files = {str(file.get("id")): file for file in workspace["files"] if isinstance(file, dict) and file.get("projectId") == body.project_id}
    render_clips: list[RenderClip] = []
    for clip in body.clips:
        file = files.get(clip.asset_id)
        if not file or file.get("objectKey") != clip.object_key or file.get("type") != clip.content_type:
            raise HTTPException(status_code=409, detail=f"{clip.name} is unavailable")
        if not clip.object_key.startswith(f"projects/{body.project_id}/assets/{clip.asset_id}/"):
            raise HTTPException(status_code=400, detail="A timeline asset does not belong to this project")
        stored_duration = float(file.get("duration") or clip.source_duration)
        if clip.trim_start + clip.duration > stored_duration + .25:
            raise HTTPException(status_code=400, detail=f"{clip.name} extends beyond its source media")
        render_clips.append(RenderClip(object_key=clip.object_key, name=clip.name, content_type=clip.content_type, start=clip.start, duration=clip.duration, trim_start=clip.trim_start, lane=clip.lane, role=clip.role, volume=clip.volume, contrast=clip.contrast, color_preset=clip.color_preset))
    clean_name = Path(body.name).name.strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="Export name is required")
    file_name = clean_name if clean_name.lower().endswith(".mp4") else f"{clean_name}.mp4"
    asset_id = str(uuid4())
    try:
        rendered = await asyncio.to_thread(render_timeline, body.project_id, asset_id, file_name, render_clips)
        asset = {"id": asset_id, "projectId": body.project_id, "folderId": body.folder_id, "name": file_name, "size": rendered["size"], "type": "video/mp4", "objectKey": rendered["object_key"], "generation": rendered["generation"], "duration": rendered["duration"], "hasAudio": True, "audioProbe": "ffprobe"}
        current = await load_workspace(account_id)
        if body.folder_id != "root" and not any(isinstance(folder, dict) and folder.get("id") == body.folder_id and folder.get("projectId") == body.project_id for folder in current["folders"]):
            raise ValueError("Destination folder was removed while rendering")
        current["files"].append(asset)
        await save_workspace(account_id, current)
        return {"asset": asset}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.get("/timelines")
async def get_timeline(project_id: str, account_id: Annotated[str, Depends(authenticated_account_id)]) -> dict[str, object]:
    await require_project(account_id, project_id)
    return await read_timeline(account_id, project_id)


@app.put("/timelines")
async def put_timeline(body: TimelineSyncRequest, account_id: Annotated[str, Depends(authenticated_account_id)]) -> dict[str, object]:
    await require_project(account_id, body.project_id)
    try:
        return await sync_timeline(account_id, body.project_id, body.expected_revision, body.timeline)
    except TimelineConflict as error:
        current = await read_timeline(account_id, body.project_id)
        raise HTTPException(status_code=409, detail={"code": "timeline_conflict", "message": str(error), "timeline": current}) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/vision/filter")
async def create_vision_filter(body: VisionFilterRequest, account_id: Annotated[str, Depends(authenticated_account_id)]) -> dict[str, object]:
    await require_project(account_id, body.project_id)
    if body.end <= body.start:
        raise HTTPException(status_code=400, detail="The selected clip range is invalid")
    if body.action == "color-safe" and not body.preset:
        raise HTTPException(status_code=400, detail="Choose a colour-safe filter")
    try:
        return {"asset": await generate_vision_filter(project_id=body.project_id, asset_id=body.asset_id, source_asset_id=body.source_asset_id, source_object_key=body.source_object_key, source_name=body.source_name, content_type=body.content_type, folder_id=body.folder_id, action=body.action, preset=body.preset, start=body.start, end=body.end)}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.post("/hearing/asl")
async def create_asl_track(body: AslTrackRequest, account_id: Annotated[str, Depends(authenticated_account_id)]) -> dict[str, object]:
    await require_project(account_id, body.project_id)
    if body.end <= body.start:
        raise HTTPException(status_code=400, detail="The selected clip range is invalid")
    try:
        attached_cues = [cue.model_dump() for cue in body.cues] if body.cues else None
        return {"cues": await generate_asl_track(body.project_id, body.asset_id, body.start, body.end, body.source, attached_cues, body.source_object_key)}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.post("/hearing/noise-reduce")
async def create_noise_reduced_asset(body: NoiseReductionRequest, account_id: Annotated[str, Depends(authenticated_account_id)]) -> dict[str, object]:
    await require_project(account_id, body.project_id)
    try:
        return {"asset": await reduce_background_noise(**body.model_dump())}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.post("/sensory/video")
async def create_sensory_video(body: SensoryVideoRequest, account_id: Annotated[str, Depends(authenticated_account_id)]) -> dict[str, object]:
    await require_project(account_id, body.project_id)
    if body.end <= body.start:
        raise HTTPException(status_code=400, detail="The selected clip range is invalid")
    try:
        return {"asset": await generate_sensory_video(**body.model_dump())}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.post("/agent/chat")
async def agent_chat(body: ChatRequest, account_id: Annotated[str, Depends(authenticated_account_id)]) -> StreamingResponse:
    if body.user_id != account_id:
        raise HTTPException(status_code=403, detail="Account mismatch")
    await require_project(account_id, body.project_id)
    try:
        timeline = await sync_timeline(account_id, body.project_id, body.timeline_revision, body.timeline)
    except TimelineConflict as error:
        current = await read_timeline(account_id, body.project_id)
        raise HTTPException(status_code=409, detail={"code": "timeline_conflict", "message": str(error), "timeline": current}) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    clip_ids = {str(clip.get("id")) for clip in timeline["clips"] if isinstance(clip, dict)}
    if any(clip_id not in clip_ids for clip_id in body.selected_clip_ids):
        raise HTTPException(status_code=400, detail="The selected timeline clip is unavailable")
    timeline_shot = verify_timeline_shot(body.timeline_shot, body.project_id, timeline)
    await ensure_session(body.user_id, body.session_id, body.agent_id)
    await update_session_context(
        user_id=body.user_id,
        session_id=body.session_id,
        agent_id=body.agent_id,
        state={"account_id": account_id, "project_id": body.project_id, "selected_clip_ids": body.selected_clip_ids, "playhead": body.playhead, "timeline_revision": timeline["revision"], "timeline_shot": {key: value for key, value in timeline_shot.items() if key != "image"} if timeline_shot else None},
    )
    return StreamingResponse(
        stream_agent_events(
            user_id=body.user_id,
            session_id=body.session_id,
            message=body.message.strip(),
            agent_id=body.agent_id,
            timeline_shot=timeline_shot,
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )


def verify_timeline_shot(shot: dict[str, object] | None, project_id: str, timeline: dict[str, object]) -> dict[str, object] | None:
    if not shot:
        return None
    if shot.get("projectId") != project_id:
        raise HTTPException(status_code=400, detail="Timeline Shot belongs to another project")
    image = shot.get("image")
    if not isinstance(image, str) or not image.startswith("data:image/png;base64,") or len(image) > 2_800_000:
        raise HTTPException(status_code=400, detail="Timeline Shot image is invalid")
    canonical = {str(clip.get("id")): clip for clip in timeline.get("clips", []) if isinstance(clip, dict)}
    projected = shot.get("clips")
    if not isinstance(projected, list) or len(projected) > 200:
        raise HTTPException(status_code=400, detail="Timeline Shot clips are invalid")
    for item in projected:
        if not isinstance(item, dict):
            raise HTTPException(status_code=400, detail="Timeline Shot clip is invalid")
        clip = canonical.get(str(item.get("id")))
        if not clip or item.get("assetId") != clip.get("assetId") or item.get("role") != clip.get("role") or item.get("lane") != clip.get("lane"):
            raise HTTPException(status_code=400, detail="Timeline Shot does not match the active timeline")
        for field, expected in (("start", clip.get("start")), ("duration", clip.get("duration")), ("trimStart", clip.get("trimStart"))):
            if not isinstance(item.get(field), (int, float)) or abs(float(item[field]) - float(expected or 0)) > .001:
                raise HTTPException(status_code=400, detail=f"Timeline Shot {field} is stale or invalid")
    return {**shot, "stale": int(shot.get("revision") or -1) != int(timeline.get("revision") or 0)}


@app.post("/agent/sessions/branch", status_code=201)
async def branch_agent_chat(body: BranchChatRequest, account_id: Annotated[str, Depends(authenticated_account_id)]) -> dict[str, str]:
    if body.user_id != account_id:
        raise HTTPException(status_code=403, detail="Account mismatch")
    try:
        await branch_session(
            user_id=body.user_id,
            source_session_id=body.source_session_id,
            target_session_id=body.target_session_id,
            agent_id=body.agent_id,
        )
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return {"session_id": body.target_session_id}
