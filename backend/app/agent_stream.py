from __future__ import annotations

import json
import base64
import re
from copy import deepcopy
from typing import AsyncIterator
from uuid import uuid4

from google.adk.events import Event, EventActions
from google.adk.agents import RunConfig
from google.adk.agents.run_config import StreamingMode
from google.adk.runners import Runner
from google.adk.sessions import DatabaseSessionService
from google.genai import types

from app.agents import agent_apps
from app.config import settings


sessions = DatabaseSessionService(settings.agent_session_database_url)
runners = {agent_id: Runner(app=app, session_service=sessions) for agent_id, app in agent_apps.items()}


async def ensure_session(user_id: str, session_id: str, agent_id: str = "general") -> None:
    runner = runner_for(agent_id)
    session = await sessions.get_session(
        app_name=runner.app_name,
        user_id=user_id,
        session_id=session_id,
    )
    if session:
        return
    await sessions.create_session(
        app_name=runner.app_name,
        user_id=user_id,
        session_id=session_id,
        state={"active_agent_id": agent_id},
    )


async def update_session_context(*, user_id: str, session_id: str, agent_id: str, state: dict[str, object]) -> None:
    runner = runner_for(agent_id)
    session = await sessions.get_session(app_name=runner.app_name, user_id=user_id, session_id=session_id)
    if not session:
        raise ValueError("The agent session does not exist")
    await sessions.append_event(
        session,
        Event(author="system", actions=EventActions(state_delta={"active_agent_id": agent_id, **state})),
    )


async def branch_session(*, user_id: str, source_session_id: str, target_session_id: str, agent_id: str) -> None:
    runner = runner_for(agent_id)
    source = await sessions.get_session(
        app_name=runner.app_name,
        user_id=user_id,
        session_id=source_session_id,
    )
    if not source:
        raise ValueError("The source chat does not exist in ADK session storage.")
    state = deepcopy(source.state)
    state["active_agent_id"] = agent_id
    target = await sessions.create_session(
        app_name=runner.app_name,
        user_id=user_id,
        session_id=target_session_id,
        state=state,
    )
    for source_event in source.events:
        event = source_event.model_copy(deep=True)
        event.id = str(uuid4())
        await sessions.append_event(target, event)


async def stream_agent_events(*, user_id: str, session_id: str, message: str, agent_id: str = "general", timeline_shot: dict[str, object] | None = None) -> AsyncIterator[str]:
    try:
        runner = runner_for(agent_id)
        session = await sessions.get_session(
            app_name=runner.app_name,
            user_id=user_id,
            session_id=session_id,
        )
        needs_title = not session or not session.state.get("chat_title")
        assistant_text = ""
        parts = [types.Part.from_text(text=message)]
        if timeline_shot:
            structured = {key: value for key, value in timeline_shot.items() if key != "image"}
            parts.append(types.Part.from_text(text=f"Verified Timeline Shot attachment:\n{json.dumps(structured, separators=(',', ':'))}"))
            parts.append(types.Part.from_bytes(data=base64.b64decode(str(timeline_shot["image"]).split(",", 1)[1]), mime_type="image/png"))
        content = types.Content(role="user", parts=parts)
        seen_tool_calls: set[str] = set()
        config = RunConfig(streaming_mode=StreamingMode.SSE)
        async for event in runner.run_async(
            user_id=user_id,
            session_id=session_id,
            new_message=content,
            run_config=config,
        ):
            if event.error_message:
                yield sse({"type": "error", "error": event.error_message})
                continue

            for call in event.get_function_calls():
                tool_call_id = call.id or call.name
                if tool_call_id in seen_tool_calls:
                    continue
                seen_tool_calls.add(tool_call_id)
                yield sse({
                    "type": "tool_call",
                    "id": tool_call_id,
                    "name": call.name,
                    "args": dict(call.args or {}),
                })

            for response in event.get_function_responses():
                yield sse({
                    "type": "tool_response",
                    "id": response.id or response.name,
                    "name": response.name,
                    "result": response.response or {},
                })

            if event.partial and event.content:
                for part in event.content.parts or []:
                    if not part.text:
                        continue
                    if not part.thought:
                        assistant_text += part.text
                    yield sse({
                        "type": "reasoning" if part.thought else "content",
                        "content": part.text,
                    })
        if needs_title and assistant_text.strip():
            title = await chat_title(message, assistant_text)
            current = await sessions.get_session(
                app_name=runner.app_name,
                user_id=user_id,
                session_id=session_id,
            )
            if current:
                await sessions.append_event(
                    current,
                    Event(
                        author="system",
                        actions=EventActions(state_delta={"chat_title": title}),
                    ),
                )
                yield sse({"type": "title", "title": title})
        yield sse({"type": "done"})
    except Exception as error:
        yield sse({"type": "error", "error": str(error)})


def sse(event: dict[str, object]) -> str:
    return f"data: {json.dumps(event, default=str)}\n\n"


def runner_for(agent_id: str) -> Runner:
    try:
        return runners[agent_id]
    except KeyError as error:
        raise ValueError(f"Unknown agent: {agent_id}") from error


async def chat_title(user_message: str, assistant_message: str) -> str:
    del assistant_message
    words = re.findall(r"[A-Za-z0-9][A-Za-z0-9'-]*", user_message)
    return " ".join(words[:5])[:60] or "New chat"
