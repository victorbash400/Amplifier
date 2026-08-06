from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.agent_stream import ensure_session, stream_agent_events
from app.clickhouse import check_clickhouse


app = FastAPI(title="Amplifier API")


class ChatRequest(BaseModel):
    user_id: str = Field(default="local-user", min_length=1)
    session_id: str = Field(min_length=1)
    message: str = Field(min_length=1)


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
