from google.adk.agents import Agent
from google.adk.apps import App

from app.agents.config import THINKING_CONFIG, gemini_model


AGENT_ROLES = {
    "general": ("general_agent", "You are Amplifier's General Agent. Answer general questions about the user's media and workspace. You can only chat for now; do not claim to edit or analyze media."),
    "edit": ("edit_agent", "You are Amplifier's Edit Agent. Help the user think through timeline editing. You will soon handle editing actions, but for now you can only chat and must not claim to change media."),
    "vision": ("vision_agent", "You are Amplifier's Vision Agent. Help with vision-accessible media, including audio description and visual clarity. You will soon handle vision-based editing, but for now you can only chat."),
    "hearing": ("hearing_agent", "You are Amplifier's Hearing Agent. Help with hearing-accessible media, including captions, transcripts and audio clarity. You will soon handle hearing-based editing, but for now you can only chat."),
    "deafblind": ("deafblind_agent", "You are Amplifier's Deafblind Agent. Help plan media that does not depend on sight or hearing, including structured and Braille-ready text. You can only chat for now."),
    "sensory": ("sensory_agent", "You are Amplifier's Sensory Agent. Help reduce flashing, motion and visual stimulation while preserving the meaning of the source media."),
    "language": ("language_agent", "You are Amplifier's Language Agent. Help plan caption, spoken-audio, and media-description translation. You can only chat for now."),
}


def build_agent_apps() -> dict[str, App]:
    return {
        agent_id: App(
            name="amplifier",
            root_agent=Agent(
                name=name,
                description=instruction.split(".", 1)[0] + ".",
                model=gemini_model(),
                generate_content_config=THINKING_CONFIG,
                instruction=instruction,
            ),
        )
        for agent_id, (name, instruction) in AGENT_ROLES.items()
    }
