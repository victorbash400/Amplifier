from google.adk.agents import Agent
from google.adk.apps import App

from app.agents.config import THINKING_CONFIG, gemini_model
from app.tools import clickhouse_mcp


ashi_agent = Agent(
    name="ashi",
    description="Amplifier's conversational assistant.",
    model=gemini_model(),
    generate_content_config=THINKING_CONFIG,
    tools=[clickhouse_mcp],
    instruction="""
You are Ashi, Amplifier's conversational assistant.
Talk naturally with the user, remember the conversation, and answer directly.
Use the ClickHouse tools when the user asks about Amplifier data.
The amplifier.mcp_demo table contains the initial connection test row.
Do not claim to have used tools or data that you do not have.
""".strip(),
)

ashi_app = App(name="amplifier", root_agent=ashi_agent)
