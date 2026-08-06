from __future__ import annotations

import os

from google.adk.tools.mcp_tool.mcp_session_manager import StdioConnectionParams
from google.adk.tools.mcp_tool.mcp_toolset import McpToolset
from mcp import StdioServerParameters

from app.config import backend_root, settings


def clickhouse_environment() -> dict[str, str]:
    return {
        **os.environ,
        "CLICKHOUSE_HOST": settings.clickhouse_host,
        "CLICKHOUSE_USER": settings.clickhouse_user,
        "CLICKHOUSE_PASSWORD": settings.clickhouse_password,
        "CLICKHOUSE_DATABASE": settings.clickhouse_database,
        "CLICKHOUSE_SECURE": "true",
    }


clickhouse_mcp = McpToolset(
    connection_params=StdioConnectionParams(
        server_params=StdioServerParameters(
            command=str(backend_root / ".venv" / "bin" / "mcp-clickhouse"),
            env=clickhouse_environment(),
        ),
        timeout=10,
    ),
    tool_filter=["list_databases", "list_tables", "run_query"],
)
