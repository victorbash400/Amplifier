from __future__ import annotations

from typing import Any, Callable

import httpx
from google.adk.tools import FunctionTool, ToolContext

from app.config import settings


_client: httpx.AsyncClient | None = None


async def _http_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=httpx.Timeout(900, connect=10))
    return _client


class RemoteFunctionTool(FunctionTool):
    """Keep the local function schema while executing in the media backend."""

    def __init__(self, function: Callable[..., Any], agent_id: str):
        super().__init__(function)
        self.agent_id = agent_id

    async def run_async(self, *, args: dict[str, Any], tool_context: ToolContext) -> Any:
        if not settings.remote_tool_url or not settings.internal_secret:
            raise RuntimeError("Remote agent tools are not configured")
        response = await (await _http_client()).post(
            f"{settings.remote_tool_url.rstrip('/')}/agent/tools/{self.name}",
            headers={"X-Amplifier-Agent-Secret": settings.internal_secret},
            json={
                "agent_id": self.agent_id,
                "function_call_id": tool_context.function_call_id,
                "args": args,
                "state": tool_context.state.to_dict(),
            },
        )
        if response.is_error:
            detail = response.json().get("detail", response.text) if response.headers.get("content-type", "").startswith("application/json") else response.text
            raise RuntimeError(f"Amplifier tool backend returned {response.status_code}: {detail}")
        return response.json()


def agent_tools(functions: list[Callable[..., Any]], agent_id: str) -> list[Callable[..., Any] | RemoteFunctionTool]:
    if not settings.remote_tool_url:
        return functions
    return [RemoteFunctionTool(function, agent_id) for function in functions]
