from collections.abc import AsyncGenerator

from google.adk.models import Gemini
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types

from app.config import settings


TASK_AGENT_TOOL_NAMES = frozenset({
    "vision_agent",
    "hearing_agent",
    "deafblind_agent",
    "sensory_agent",
    "language_agent",
})


def without_partial_task_calls(response: LlmResponse) -> LlmResponse | None:
    """Hold task delegation until ADK emits its complete aggregated call."""
    if not response.partial or not response.content or not response.content.parts:
        return response
    parts = [
        part
        for part in response.content.parts
        if not (
            part.function_call
            and part.function_call.name in TASK_AGENT_TOOL_NAMES
        )
    ]
    if not parts:
        return None
    if len(parts) == len(response.content.parts):
        return response
    return response.model_copy(
        update={"content": response.content.model_copy(update={"parts": parts})}
    )


class TaskSafeGemini(Gemini):
    """Preserve progressive SSE without ADK dispatching partial task calls."""

    async def generate_content_async(
        self,
        llm_request: LlmRequest,
        stream: bool = False,
    ) -> AsyncGenerator[LlmResponse, None]:
        async for response in super().generate_content_async(llm_request, stream):
            safe_response = without_partial_task_calls(response)
            if safe_response is not None:
                yield safe_response


def gemini_model() -> Gemini:
    return TaskSafeGemini(
        model=settings.agent_model,
        client_kwargs={
            "vertexai": True,
            "project": settings.google_cloud_project,
            "location": settings.agent_model_location,
        },
        retry_options=types.HttpRetryOptions(attempts=3),
    )


THINKING_CONFIG = types.GenerateContentConfig(
    thinking_config=types.ThinkingConfig(
        include_thoughts=True,
        thinking_level="medium",
    ),
)
