from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


backend_root = Path(__file__).resolve().parents[1]
load_dotenv(backend_root / ".env")


def environment(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


@dataclass(frozen=True)
class Settings:
    google_cloud_project: str
    google_cloud_location: str
    google_speech_location: str
    agent_model: str
    gcs_bucket: str
    clickhouse_host: str
    clickhouse_user: str
    clickhouse_password: str
    clickhouse_database: str
    agent_session_database_url: str


settings = Settings(
    google_cloud_project=environment("GOOGLE_CLOUD_PROJECT", "amplifier-20260806"),
    google_cloud_location=environment("GOOGLE_CLOUD_LOCATION", "global"),
    google_speech_location=environment("GOOGLE_SPEECH_LOCATION", "us"),
    agent_model=environment("AMPLIFIER_AGENT_MODEL", "gemini-3.1-pro-preview"),
    gcs_bucket=environment("AMPLIFIER_GCS_BUCKET", "amplifier-20260806-assets"),
    clickhouse_host=environment("CLICKHOUSE_HOST"),
    clickhouse_user=environment("CLICKHOUSE_USER", "default"),
    clickhouse_password=environment("CLICKHOUSE_PASSWORD"),
    clickhouse_database=environment("CLICKHOUSE_DATABASE", "amplifier"),
    agent_session_database_url=environment(
        "AMPLIFIER_AGENT_SESSION_DATABASE_URL",
        f"sqlite+aiosqlite:///{backend_root / 'amplifier_sessions.db'}",
    ),
)

os.environ["GOOGLE_GENAI_USE_VERTEXAI"] = "TRUE"
os.environ["GOOGLE_CLOUD_PROJECT"] = settings.google_cloud_project
os.environ["GOOGLE_CLOUD_LOCATION"] = settings.google_cloud_location
