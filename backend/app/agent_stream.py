from __future__ import annotations

import json
from typing import AsyncIterator

from google.adk.events import Event, EventActions
from google.adk.agents import RunConfig
from google.adk.agents.run_config import StreamingMode
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google import genai
from google.genai import types

from app.agents import ashi_app
from app.config import settings


sessions = InMemorySessionService()
runner = Runner(app=ashi_app, session_service=sessions)


async def ensure_session(user_id: str, session_id: str) -> None:
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
    )


async def stream_agent_events(*, user_id: str, session_id: str, message: str) -> AsyncIterator[str]:
    try:
        session = await sessions.get_session(
            app_name=runner.app_name,
            user_id=user_id,
            session_id=session_id,
        )
        needs_title = not session or not session.state.get("chat_title")
        assistant_text = ""
        content = types.Content(
            role="user",
            parts=[types.Part.from_text(text=message)],
        )
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
