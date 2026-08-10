from __future__ import annotations

import json
import base64
from copy import deepcopy
from typing import AsyncIterator
from uuid import uuid4

from google.adk.events import Event, EventActions
from google.adk.agents import RunConfig
from google.adk.agents.run_config import StreamingMode
from google.adk.runners import Runner
from google.adk.sessions import DatabaseSessionService
from google import genai
from google.genai import types

from app.agents import agent_apps
from app import agent_engine_runtime
from app.agents.media_agents import AGENT_ID_BY_NAME, SPECIALIST_AGENT_IDS, SPECIALIST_AGENT_NAMES
from app.agent_tools import MUTATION_TOOLS
from app.config import settings


sessions = DatabaseSessionService(settings.agent_session_database_url)
runners = {agent_id: Runner(app=app, session_service=sessions) for agent_id, app in agent_apps.items()}
TIMELINE_ACTIVITY_TOOLS = MUTATION_TOOLS | {"read_timeline_shot", "read_timeline", "read_selection", "select_timeline_clip"}
SPECIALIST_ACKNOWLEDGEMENTS = {
    "vision": "Vision Agent is handling the visual accessibility change.",
    "hearing": "Hearing Agent is handling the audio accessibility change.",
    "deafblind": "Deafblind Agent is handling the combined access change.",
    "sensory": "Sensory Agent is handling the sensory accessibility change.",
    "language": "Language Agent is handling the language change.",
}


async def ensure_session(user_id: str, session_id: str, agent_id: str = "edit") -> None:
    if agent_engine_runtime.enabled(agent_id):
        await agent_engine_runtime.ensure_session(user_id, session_id, agent_id)
        return
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
    if agent_engine_runtime.enabled(agent_id):
        await agent_engine_runtime.append_state(user_id, session_id, agent_id, state)
        return
    runner = runner_for(agent_id)
    session = await sessions.get_session(app_name=runner.app_name, user_id=user_id, session_id=session_id)
    if not session:
        raise ValueError("The agent session does not exist")
    await sessions.append_event(
        session,
        Event(author="system", actions=EventActions(state_delta={"active_agent_id": agent_id, **state})),
    )


async def branch_session(*, user_id: str, source_session_id: str, target_session_id: str, agent_id: str) -> None:
    if agent_engine_runtime.enabled(agent_id):
        await agent_engine_runtime.branch_session(user_id, source_session_id, target_session_id, agent_id)
        return
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


async def delete_agent_session(*, user_id: str, session_id: str) -> None:
    if agent_engine_runtime.enabled("edit"):
        await agent_engine_runtime.delete_session(user_id, session_id, "edit")
        return
    await sessions.delete_session(
        app_name=runner_for("edit").app_name,
        user_id=user_id,
        session_id=session_id,
    )


async def stream_agent_events(*, user_id: str, session_id: str, message: str, agent_id: str = "edit", timeline_shot: dict[str, object] | None = None, skill_manifest: str = "") -> AsyncIterator[str]:
    try:
        runner = runner_for(agent_id)
        if agent_engine_runtime.enabled(agent_id):
            session = await agent_engine_runtime.get_session(user_id, session_id, agent_id)
            session_state = dict(session.get("state") or {}) if session else {}
        else:
            session = await sessions.get_session(
                app_name=runner.app_name,
                user_id=user_id,
                session_id=session_id,
            )
            session_state = dict(session.state) if session else {}
        needs_title = not session_state.get("chat_title")
        assistant_text = ""
        parts = [types.Part.from_text(text=message)]
        if skill_manifest:
            parts.append(types.Part.from_text(text=skill_manifest))
        if timeline_shot:
            structured = {key: value for key, value in timeline_shot.items() if key != "image"}
            parts.append(types.Part.from_text(text=f"Verified Timeline Shot attachment:\n{json.dumps(structured, separators=(',', ':'))}"))
            parts.append(types.Part.from_bytes(data=base64.b64decode(str(timeline_shot["image"]).split(",", 1)[1]), mime_type="image/png"))
        content = types.Content(role="user", parts=parts)
        seen_tool_calls: set[str] = set()
        active_subagent = ""
        config = RunConfig(streaming_mode=StreamingMode.SSE)
        event_stream = agent_engine_runtime.stream_events(user_id=user_id, session_id=session_id, agent_id=agent_id, content=content) if agent_engine_runtime.enabled(agent_id) else runner.run_async(user_id=user_id, session_id=session_id, new_message=content, run_config=config)
        async for event in event_stream:
            if event.error_message:
                yield sse({"type": "error", "error": event.error_message})
                continue

            author_agent_id = AGENT_ID_BY_NAME.get(str(event.author or ""), "")
            if author_agent_id in SPECIALIST_AGENT_IDS and author_agent_id != active_subagent:
                active_subagent = author_agent_id
                acknowledgement = SPECIALIST_ACKNOWLEDGEMENTS[author_agent_id]
                assistant_text += acknowledgement
                yield sse(specialist_start_event(author_agent_id))

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

            for call in event.get_function_calls():
                tool_call_id = call.id or call.name
                if tool_call_id in seen_tool_calls:
                    continue
                seen_tool_calls.add(tool_call_id)
                delegated_agent_id = AGENT_ID_BY_NAME.get(call.name or "", "")
                if delegated_agent_id in SPECIALIST_AGENT_IDS:
                    if delegated_agent_id != active_subagent:
                        active_subagent = delegated_agent_id
                        acknowledgement = SPECIALIST_ACKNOWLEDGEMENTS[delegated_agent_id]
                        assistant_text += acknowledgement
                        yield sse(specialist_start_event(delegated_agent_id))
                    continue
                if call.name == "finish_task":
                    continue
                yield sse({
                    "type": "tool_call",
                    "id": tool_call_id,
                    "name": call.name,
                    "args": dict(call.args or {}),
                    "surface": "timeline" if call.name in TIMELINE_ACTIVITY_TOOLS else "other",
                })

            for response in event.get_function_responses():
                if response.name in SPECIALIST_AGENT_NAMES:
                    if active_subagent:
                        yield sse({"type": "agent_return", "agent": "edit", "title": "Agent"})
                        active_subagent = ""
                    continue
                if response.name == "finish_task":
                    continue
                yield sse({
                    "type": "tool_response",
                    "id": response.id or response.name,
                    "name": response.name,
                    "result": response.response or {},
                    "surface": "timeline" if response.name in TIMELINE_ACTIVITY_TOOLS else "other",
                })

        if needs_title and assistant_text.strip():
            title = await chat_title(message, assistant_text)
            if agent_engine_runtime.enabled(agent_id):
                await agent_engine_runtime.append_state(user_id, session_id, agent_id, {"chat_title": title})
                yield sse({"type": "title", "title": title})
            else:
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


def specialist_start_event(agent_id: str) -> dict[str, str]:
    title = agent_id.capitalize() + " Agent"
    return {
        "type": "agent_start",
        "agent": agent_id,
        "title": title,
        "acknowledgement": SPECIALIST_ACKNOWLEDGEMENTS[agent_id],
    }


def sse(event: dict[str, object]) -> str:
    return f"data: {json.dumps(event, default=str)}\n\n"


def runner_for(agent_id: str) -> Runner:
    try:
        return runners[agent_id]
    except KeyError as error:
        raise ValueError(f"Unknown agent: {agent_id}") from error


async def chat_title(user_message: str, assistant_message: str) -> str:
    prompt = f"Name this chat in 2 to 5 words. Return only the title, without quotes or punctuation.\n\nUser: {user_message}\nAssistant: {assistant_message[:1200]}"
    response = await genai.Client(
        vertexai=True,
        project=settings.google_cloud_project,
        location=settings.google_cloud_location,
    ).aio.models.generate_content(
        model="gemini-3-flash-preview",
        contents=prompt,
        config=types.GenerateContentConfig(
            max_output_tokens=24,
            temperature=0.2,
            thinking_config=types.ThinkingConfig(
                thinking_level=types.ThinkingLevel.MINIMAL,
            ),
        ),
    )
    title = " ".join((response.text or "").strip().strip('"').split())
    return title[:60] or "New chat"
