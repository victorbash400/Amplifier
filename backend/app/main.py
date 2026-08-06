import asyncio

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.agent_stream import ensure_session, stream_agent_events
from app.asset_storage import create_upload_session, delete_asset, open_asset_stream, verify_uploaded_asset
from app.clickhouse import check_clickhouse


app = FastAPI(title="Amplifier API")


class ChatRequest(BaseModel):
    user_id: str = Field(default="local-user", min_length=1)
    session_id: str = Field(min_length=1)
    message: str = Field(min_length=1)


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
    object_key: str = Field(min_length=1, max_length=1024)


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
async def complete_asset_upload(body: AssetUploadCompleteRequest) -> dict[str, str | int]:
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
        await asyncio.to_thread(delete_asset, project_id=body.project_id, object_key=body.object_key)
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.post("/agent/chat")
async def agent_chat(body: ChatRequest) -> StreamingResponse:
    await ensure_session(body.user_id, body.session_id)
    return StreamingResponse(
        stream_agent_events(
            user_id=body.user_id,
            session_id=body.session_id,
            message=body.message.strip(),
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )
