import asyncio
import json
import logging

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.agent_stream import branch_session, ensure_session, stream_agent_events
from app.asl_tools import generate_asl_track
from app.asset_storage import create_upload_session, delete_asset, open_asset_stream, verify_uploaded_asset
from app.braille import braille_transcript
from app.clickhouse import check_clickhouse
from app.hearing_tools import reduce_background_noise
from app.media_search import asset_transcript, index_asset, index_status, remove_asset_index, search_assets
from app.transcript_service import transcript_for_asset
from app.vision_tools import generate_vision_filter, generate_vision_narration


app = FastAPI(title="Amplifier API")
logger = logging.getLogger(__name__)


class ChatRequest(BaseModel):
    user_id: str = Field(default="local-user", min_length=1)
    session_id: str = Field(min_length=1)
    message: str = Field(min_length=1)
    agent_id: str = Field(default="general", pattern=r"^(general|edit|vision|hearing|deafblind|cognitive|vision-cognitive|hearing-cognitive|deafblind-cognitive|sensory)$")


class BranchChatRequest(BaseModel):
    user_id: str = Field(default="local-user", min_length=1)
    source_session_id: str = Field(min_length=1)
    target_session_id: str = Field(min_length=1)
    agent_id: str = Field(default="general", pattern=r"^(general|edit|vision|hearing|deafblind|cognitive|vision-cognitive|hearing-cognitive|deafblind-cognitive|sensory)$")


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


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/clickhouse/health")
async def clickhouse_health() -> dict[str, str]:
    try:
        await check_clickhouse()
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    return {"status": "ok"}


@app.post("/assets/uploads")
async def begin_asset_upload(body: AssetUploadRequest) -> dict[str, str]:
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
async def complete_asset_upload(body: AssetUploadCompleteRequest) -> dict[str, str | int | bool | None]:
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
async def asset_media(project_id: str, object_key: str, range: str | None = None) -> StreamingResponse:
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
async def remove_asset(body: AssetDeleteRequest) -> None:
    try:
        await remove_asset_index(project_id=body.project_id, asset_id=body.asset_id)
        await asyncio.to_thread(delete_asset, project_id=body.project_id, object_key=body.object_key)
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.get("/search/index")
async def media_index_status(project_id: str) -> dict[str, object]:
    try:
        return {"assets": await index_status(project_id)}
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.post("/search/index")
async def create_media_index(body: MediaIndexRequest) -> StreamingResponse:
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
        try:
            while True:
                event = await queue.get()
                if event is None:
                    break
                yield json.dumps(event, separators=(",", ":")) + "\n"
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(events(), media_type="application/x-ndjson", headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


@app.post("/search/query")
async def query_media_index(body: MediaSearchRequest) -> dict[str, object]:
    try:
        return {"results": await search_assets(body.project_id, body.query)}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.post("/search/transcript")
async def read_media_transcript(body: MediaTranscriptRequest) -> dict[str, object]:
    try:
        return {"cues": await transcript_for_asset(body.project_id, body.asset_id, body.object_key)}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.post("/search/braille")
async def read_braille_transcript(body: MediaTranscriptRequest) -> dict[str, object]:
    try:
        return await braille_transcript(body.project_id, body.asset_id, body.object_key)
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.post("/vision/narration")
async def create_vision_narration(body: VisionNarrationRequest) -> dict[str, object]:
    if body.end <= body.start:
        raise HTTPException(status_code=400, detail="The selected clip range is invalid")
    try:
        return {"asset": await generate_vision_narration(project_id=body.project_id, asset_id=body.asset_id, source_asset_id=body.source_asset_id, folder_id=body.folder_id, action=body.action, start=body.start, end=body.end)}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.post("/vision/filter")
async def create_vision_filter(body: VisionFilterRequest) -> dict[str, object]:
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
async def create_asl_track(body: AslTrackRequest) -> dict[str, object]:
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
async def create_noise_reduced_asset(body: NoiseReductionRequest) -> dict[str, object]:
    try:
        return {"asset": await reduce_background_noise(**body.model_dump())}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.post("/agent/chat")
async def agent_chat(body: ChatRequest) -> StreamingResponse:
    await ensure_session(body.user_id, body.session_id, body.agent_id)
    return StreamingResponse(
        stream_agent_events(
            user_id=body.user_id,
            session_id=body.session_id,
            message=body.message.strip(),
            agent_id=body.agent_id,
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )


@app.post("/agent/sessions/branch", status_code=201)
async def branch_agent_chat(body: BranchChatRequest) -> dict[str, str]:
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
