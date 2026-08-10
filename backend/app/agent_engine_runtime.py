from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any, AsyncIterator
from uuid import uuid4

import vertexai
from google.adk.events import Event
from google.genai import types
from vertexai import agent_engines

from app.config import settings


def parse_stream_json(buffer: str, data: bytes) -> tuple[str, list[object]]:
    buffer += data.decode("utf-8")
    decoder = json.JSONDecoder()
    payloads: list[object] = []
    while buffer.lstrip():
        buffer = buffer.lstrip()
        try:
            payload, offset = decoder.raw_decode(buffer)
        except json.JSONDecodeError:
            break
        buffer = buffer[offset:]
        payloads.extend(payload if isinstance(payload, list) else [payload])
    return buffer, payloads


@lru_cache(maxsize=6)
def remote_app(agent_id: str) -> Any:
    resource = settings.agent_engine_resources.get(agent_id)
    if not resource:
        raise RuntimeError(f"Agent Engine is not configured for {agent_id}")
    vertexai.init(project=settings.google_cloud_project, location=settings.agent_engine_location, api_transport="rest")
    return agent_engines.get(resource)


async def get_session(user_id: str, session_id: str, agent_id: str) -> dict[str, Any] | None:
    try:
        return await remote_app(agent_id).async_get_session(user_id=user_id, session_id=session_id)
    except Exception as error:
        if "not found" in str(error).casefold() or "404" in str(error):
            return None
        raise


async def ensure_session(user_id: str, session_id: str, agent_id: str) -> dict[str, Any]:
    current = await get_session(user_id, session_id, agent_id)
    if current:
        return current
    return await remote_app(agent_id).async_create_session(
        user_id=user_id,
        session_id=session_id,
        state={"active_agent_id": agent_id},
    )


async def append_state(user_id: str, session_id: str, agent_id: str, state: dict[str, object]) -> None:
    await ensure_session(user_id, session_id, agent_id)
    resource = settings.agent_engine_resources[agent_id]
    client = vertexai.Client(project=settings.google_cloud_project, location=settings.agent_engine_location)
    await asyncio.to_thread(
        client.agent_engines.sessions.events.append,
        name=f"{resource}/sessions/{session_id}",
        author="system",
        invocation_id=str(uuid4()),
        timestamp=datetime.now(timezone.utc),
        config={"actions": {"state_delta": {"active_agent_id": agent_id, **state}}},
    )


async def delete_session(user_id: str, session_id: str, agent_id: str) -> None:
    await remote_app(agent_id).async_delete_session(user_id=user_id, session_id=session_id)


async def branch_session(user_id: str, source_session_id: str, target_session_id: str, agent_id: str) -> None:
    source = await get_session(user_id, source_session_id, agent_id)
    if not source:
        raise ValueError("The source chat does not exist in Agent Engine Sessions.")
    await remote_app(agent_id).async_create_session(
        user_id=user_id,
        session_id=target_session_id,
        state={**dict(source.get("state") or {}), "active_agent_id": agent_id},
    )
    client = vertexai.Client(project=settings.google_cloud_project, location=settings.agent_engine_location)
    resource = settings.agent_engine_resources[agent_id]
    for raw in list(source.get("events") or []):
        event = Event.model_validate(raw)
        config: dict[str, object] = {}
        if event.content:
            config["content"] = event.content.model_dump(mode="json", exclude_none=True)
        if event.actions:
            config["actions"] = event.actions.model_dump(mode="json", exclude_none=True)
        await asyncio.to_thread(
            client.agent_engines.sessions.events.append,
            name=f"{resource}/sessions/{target_session_id}",
            author=event.author or "system",
            invocation_id=event.invocation_id or str(uuid4()),
            timestamp=datetime.now(timezone.utc),
            config=config,
        )


async def stream_events(*, user_id: str, session_id: str, agent_id: str, content: types.Content) -> AsyncIterator[Event]:
    app = remote_app(agent_id)
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[object] = asyncio.Queue()
    complete = object()

    def consume_stream() -> None:
        response = None
        try:
            buffer = ""
            response = app.execution_api_client.transport._session.post(
                f"https://{settings.agent_engine_location}-aiplatform.googleapis.com/v1/{app.resource_name}:streamQuery",
                json={
                    "classMethod": "async_stream_query",
                    "input": {
                        "user_id": user_id,
                        "session_id": session_id,
                        "message": content.model_dump(mode="json", exclude_none=True),
                        "run_config": {"streaming_mode": "sse"},
                    },
                },
                stream=True,
                timeout=(30, 3600),
            )
            response.raise_for_status()
            if "application/json" not in str(response.headers.get("content-type") or ""):
                raise RuntimeError(f"Agent Engine returned unsupported stream content: {response.headers.get('content-type') or 'unknown'}")
            for chunk in response.iter_content(chunk_size=None):
                buffer, payloads = parse_stream_json(buffer, chunk)
                for event in payloads:
                    if event is not None:
                        loop.call_soon_threadsafe(queue.put_nowait, event)
            if buffer.strip():
                raise RuntimeError("Agent Engine ended with an incomplete streamed event.")
        except BaseException as error:
            loop.call_soon_threadsafe(queue.put_nowait, error)
        finally:
            if response is not None:
                response.close()
            loop.call_soon_threadsafe(queue.put_nowait, complete)

    consumer = asyncio.create_task(asyncio.to_thread(consume_stream))
    received_event = False
    while True:
        item = await queue.get()
        if item is complete:
            break
        if isinstance(item, BaseException):
            raise item
        received_event = True
        yield Event.model_validate(item)
    await consumer
    if not received_event:
        raise RuntimeError("Agent Engine ended without returning an event. Check the managed agent execution logs and retry.")


def enabled(agent_id: str) -> bool:
    return agent_id in settings.agent_engine_resources
