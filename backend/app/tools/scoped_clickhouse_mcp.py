from __future__ import annotations

import hmac
import json
from typing import Any
from urllib.parse import urlparse

from google.adk.tools.mcp_tool.mcp_session_manager import StreamableHTTPConnectionParams
from google.adk.tools.mcp_tool.mcp_toolset import McpToolset
from mcp.server.fastmcp import Context, FastMCP
from mcp.server.transport_security import TransportSecuritySettings

from app.accounts import account_owns_project, project_asset
from app.clickhouse import clickhouse_client
from app.config import environment, settings
from app.language_tools import _speaker_turns
from app.media_search import SEARCH_SCHEMA_VERSION, asset_transcript, search_assets


backend_origin = environment("AMPLIFIER_BACKEND_ORIGIN", "http://127.0.0.1:8000").rstrip("/")
backend_host = urlparse(backend_origin).netloc
scoped_clickhouse_server = FastMCP(
    "Amplifier ClickHouse",
    stateless_http=True,
    json_response=True,
    streamable_http_path="/",
    transport_security=TransportSecuritySettings(
        allowed_hosts=[backend_host],
        allowed_origins=[backend_origin],
    ),
)


async def _scope(context: Context) -> tuple[str, str]:
    request = context.request_context.request
    headers = getattr(request, "headers", {})
    account_id = str(headers.get("x-amplifier-account") or "")
    project_id = str(headers.get("x-amplifier-project") or "")
    secret = str(headers.get("x-amplifier-mcp-secret") or "")
    if not settings.internal_secret or not hmac.compare_digest(secret, settings.internal_secret):
        raise ValueError("MCP authentication failed")
    if not account_id or not project_id or not await account_owns_project(account_id, project_id):
        raise ValueError("MCP project scope is invalid")
    return account_id, project_id


@scoped_clickhouse_server.tool()
async def search_project_moments(query: str, ctx: Context) -> list[dict[str, Any]]:
    """Search indexed media moments only inside the verified active project."""
    _, project_id = await _scope(ctx)
    results = await search_assets(project_id, query, limit=12)
    return [{key: item.get(key) for key in ("asset_id", "asset_name", "start", "end", "description", "transcript", "score")} for item in results]


@scoped_clickhouse_server.tool()
async def read_project_transcript(asset_id: str, ctx: Context) -> list[dict[str, Any]]:
    """Read indexed transcript cues for an asset owned by the active project."""
    account_id, project_id = await _scope(ctx)
    if not await project_asset(account_id, project_id, asset_id):
        raise ValueError("Asset not found in the active project")
    return await asset_transcript(project_id, asset_id)


@scoped_clickhouse_server.tool()
async def read_project_silence_ranges(asset_id: str, ctx: Context) -> list[dict[str, float]]:
    """Read cached silence ranges for an asset owned by the active project."""
    account_id, project_id = await _scope(ctx)
    if not await project_asset(account_id, project_id, asset_id):
        raise ValueError("Asset not found in the active project")
    client = await clickhouse_client()
    try:
        result = await client.query("SELECT silence_ranges FROM asset_search_index FINAL WHERE project_id = {project_id:String} AND asset_id = {asset_id:String} AND schema_version = {schema_version:UInt16} AND status = 'ready' LIMIT 1", parameters={"project_id": project_id, "asset_id": asset_id, "schema_version": SEARCH_SCHEMA_VERSION})
        if not result.result_rows:
            return []
        value = result.result_rows[0][0]
        if isinstance(value, str):
            value = json.loads(value or "[]")
        return value if isinstance(value, list) else []
    finally:
        await client.close()


@scoped_clickhouse_server.tool()
async def read_project_speaker_turns(asset_id: str, ctx: Context) -> list[dict[str, Any]]:
    """Read cached or diarized speaker turns for an owned active-project asset."""
    account_id, project_id = await _scope(ctx)
    asset = await project_asset(account_id, project_id, asset_id)
    if not asset:
        raise ValueError("Asset not found in the active project")
    turns = await _speaker_turns(project_id, asset_id, str(asset.get("objectKey") or ""), str(asset.get("generation") or ""), asset.get("duration"))
    return [turn.__dict__ for turn in turns]


async def scoped_headers(context: Any) -> dict[str, str]:
    return {"X-Amplifier-Account": str(context.state.get("account_id") or ""), "X-Amplifier-Project": str(context.state.get("project_id") or ""), "X-Amplifier-MCP-Secret": settings.internal_secret}


SCOPED_MCP_TOOL_NAMES = {"search_project_moments", "read_project_transcript", "read_project_silence_ranges", "read_project_speaker_turns"}
scoped_clickhouse_mcp = McpToolset(
    connection_params=StreamableHTTPConnectionParams(url=f"{backend_origin}/mcp/", timeout=10, sse_read_timeout=300),
    tool_filter=sorted(SCOPED_MCP_TOOL_NAMES),
    tool_name_prefix="clickhouse",
    header_provider=scoped_headers,
)
