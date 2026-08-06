from google.adk.models import Gemini
from google.genai import types

from app.config import settings


def gemini_model() -> Gemini:
    return Gemini(
        model=settings.agent_model,
        retry_options=types.HttpRetryOptions(attempts=3),
    )


THINKING_CONFIG = types.GenerateContentConfig(
    thinking_config=types.ThinkingConfig(
        include_thoughts=True,
        thinking_level="medium",
    ),
)
