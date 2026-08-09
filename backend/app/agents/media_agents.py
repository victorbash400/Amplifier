from __future__ import annotations

from typing import Any

from google.adk.agents import Agent
from google.adk.apps import App

from app.agent_tools import MUTATION_TOOLS, TOOLS_BY_AGENT, TOOL_NAMES_BY_AGENT
from app.agents.config import THINKING_CONFIG, gemini_model
from app.tools.scoped_clickhouse_mcp import SCOPED_MCP_TOOL_NAMES, scoped_clickhouse_mcp


SHARED_BEHAVIOR = """
Work directly inside the verified active Amplifier project. Use the exact clip IDs, times, lanes, and revision returned by tools; never invent them. Before your first mutation tool call, tell the user in one concise sentence what you are about to change. Then act without repeating a plan. Use the smallest tool that completes the request. Prefer a specialist domain tool that already reads indexed evidence over making separate ClickHouse calls; use the scoped ClickHouse tools only for additional read-only evidence. A completed tool result already contains the validated canonical timeline, so do not reread it merely to check the edit. If a tool returns failed, explain the concrete error and the useful next action; never claim the edit happened. Keep the final answer short and state only what actually changed.
""".strip()
MCP_TOOL_NAMES = {f"clickhouse_{name}" for name in SCOPED_MCP_TOOL_NAMES}


AGENT_ROLES = {
    "general": ("general_agent", "Answer questions about the active project and find relevant indexed media. You are read-only and must not claim to change the timeline."),
    "edit": ("edit_agent", "Browse and inspect owned project files, find indexed moments, and perform structural timeline editing: insert at exact times or the playhead, place before or after clips, insert source moments, move, trim, split, delete, replace, and change audio levels. Preserve linked audio and video unless the user explicitly requests otherwise."),
    "vision": ("vision_agent", "Resolve vision-accessibility needs using audio description, spoken on-screen text, contrast, colour-safe presentation, and large text. Apply metadata instantly when rendering is unnecessary."),
    "hearing": ("hearing_agent", "Resolve hearing-accessibility needs using captions, transcripts, ASL cues, and noise reduction. Preserve cue timing and source meaning."),
    "deafblind": ("deafblind_agent", "Create media access that does not depend on sight or hearing using Braille-ready text, structured descriptions, labels, navigation, and tactile-cue metadata."),
    "sensory": ("sensory_agent", "Reduce flashing, motion, shake, rapid cuts, clutter, and stimulation while preserving the essential content and timing."),
    "language": ("language_agent", "Translate captions, dialogue audio, and audio descriptions. Preserve speaker turns, timing, and distinct voice presentation."),
}


async def authorize_tool_call(tool: Any, args: dict[str, Any], tool_context: Any) -> dict[str, Any] | None:
    del args
    agent_id = str(tool_context.state.get("active_agent_id") or "")
    if not tool_context.state.get("account_id") or not tool_context.state.get("project_id"):
        return {"status": "failed", "code": "missing_context", "error": "The active project context is unavailable.", "retryable": False, "action": "Open a project and try again."}
    if tool.name not in TOOL_NAMES_BY_AGENT.get(agent_id, set()) | MCP_TOOL_NAMES:
        return {"status": "failed", "code": "tool_not_allowed", "error": f"{agent_id or 'This'} agent cannot use {tool.name}.", "retryable": False, "action": "Use the matching timeline specialist."}
    return None


async def record_tool_result(tool: Any, args: dict[str, Any], tool_context: Any, tool_response: dict[str, Any]) -> dict[str, Any] | None:
    del tool, args
    if isinstance(tool_response, dict) and tool_response.get("timeline", {}).get("revision") is not None:
        tool_context.state["timeline_revision"] = int(tool_response["timeline"]["revision"])
    return tool_response


async def return_tool_error(tool: Any, args: dict[str, Any], tool_context: Any, error: Exception) -> dict[str, Any]:
    del tool, args, tool_context
    return {"status": "failed", "code": "tool_error", "error": str(error), "retryable": False, "action": "Correct the request using the verified selection and try once more."}


def build_agent(agent_id: str, name: str, role: str) -> Agent:
    mutation_names = sorted(TOOL_NAMES_BY_AGENT[agent_id] & MUTATION_TOOLS)
    mutation_note = f" Your mutation tools are: {', '.join(mutation_names)}." if mutation_names else ""
    return Agent(
        name=name,
        description=role.split(".", 1)[0] + ".",
        model=gemini_model(),
        mode="chat",
        instruction=f"{role}\n\n{SHARED_BEHAVIOR}{mutation_note}",
        tools=[*TOOLS_BY_AGENT[agent_id], scoped_clickhouse_mcp],
        generate_content_config=THINKING_CONFIG,
        before_tool_callback=authorize_tool_call,
        after_tool_callback=record_tool_result,
        on_tool_error_callback=return_tool_error,
    )


def build_agent_apps() -> dict[str, App]:
    return {agent_id: App(name="amplifier", root_agent=build_agent(agent_id, name, role)) for agent_id, (name, role) in AGENT_ROLES.items()}
