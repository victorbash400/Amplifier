from __future__ import annotations

import os
import sys
from pathlib import Path

import vertexai
from google.cloud.aiplatform_v1.types.env_var import SecretRef
from google.protobuf.json_format import ParseError
from vertexai import agent_engines


PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT", "amplifier-20260806")
LOCATION = os.environ.get("AMPLIFIER_AGENT_ENGINE_LOCATION", "europe-west1")
STAGING_BUCKET = os.environ.get("AMPLIFIER_GCS_BUCKET", "amplifier-20260806-assets")
BACKEND_URL = os.environ["AMPLIFIER_REMOTE_TOOL_URL"].rstrip("/")
SERVICE_ACCOUNT = os.environ["AMPLIFIER_AGENT_SERVICE_ACCOUNT"]
RESOURCE_NAME = os.environ.get("AMPLIFIER_AGENT_ENGINE_RESOURCE", "").strip()
BACKEND_ROOT = Path(__file__).resolve().parents[1] / "backend"

os.environ.setdefault("AMPLIFIER_INTERNAL_SECRET", "resolved-by-secret-manager")
os.environ["AMPLIFIER_BACKEND_ORIGIN"] = BACKEND_URL
os.chdir(BACKEND_ROOT)
sys.path.insert(0, str(BACKEND_ROOT))

from app.agents import agent_apps


vertexai.init(project=PROJECT, location=LOCATION, staging_bucket=f"gs://{STAGING_BUCKET}", api_transport="rest")
application = agent_engines.AdkApp(
    agent=agent_apps["edit"].root_agent,
    app_name="amplifier",
    enable_tracing=True,
)
deploy = agent_engines.update if RESOURCE_NAME else agent_engines.create
deploy_args = (RESOURCE_NAME,) if RESOURCE_NAME else (application,)
deploy_kwargs = {
    "display_name": "Amplifier Agent",
    "description": "Amplifier ADK edit coordinator and accessibility specialists",
    "requirements": "requirements.txt",
    "extra_packages": ["app"],
    "env_vars": {
        "AMPLIFIER_AGENT_MODEL": "gemini-3.1-pro-preview",
        "AMPLIFIER_AGENT_MODEL_LOCATION": "global",
        "AMPLIFIER_REMOTE_TOOL_URL": BACKEND_URL,
        "AMPLIFIER_BACKEND_ORIGIN": BACKEND_URL,
        "AMPLIFIER_INTERNAL_SECRET": SecretRef(secret="amplifier-internal-secret", version="latest"),
        "GOOGLE_CLOUD_AGENT_ENGINE_ENABLE_TELEMETRY": "true",
    },
    "service_account": SERVICE_ACCOUNT,
    "min_instances": 1,
    "max_instances": 4,
    "container_concurrency": 8,
    "resource_limits": {"cpu": "2", "memory": "4Gi"},
}
if RESOURCE_NAME:
    deploy_kwargs["agent_engine"] = application
try:
    remote = deploy(*deploy_args, **deploy_kwargs)
    print(remote.resource_name)
except ParseError as error:
    if not RESOURCE_NAME or "effectiveIdentity" not in str(error):
        raise
    print(RESOURCE_NAME)
