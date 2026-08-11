import json
import tempfile
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from google.adk.events import Event
from google.adk.features import FeatureName, is_feature_enabled
from google.adk.models.llm_response import LlmResponse
from google.genai import types

from app import accounts, skills, timeline_service
from app.accounts import create_account, save_workspace
from app.agents.config import without_partial_task_calls
from app.agents.media_agents import SpecialistTaskResult, TOOL_NAMES_BY_AGENT, authorize_tool_call, build_agent_apps, record_tool_result, return_tool_error
from app.agent_stream import chat_title, delete_agent_session, specialist_start_event, stream_agent_events
from app.agent_tools import AgentToolError, apply_braille_text, apply_captions, apply_contrast, inspect_asset, insert_asset_at_playhead, insert_asset_next_to, insert_media_moment, list_project_assets, read_attached_skill, read_selection, read_timeline_shot, reduce_flash, select_timeline_clip, translate_audio, translate_captions, move_clip
from app.skills import copy_chat_skills, create_skill, delete_chat_skills, set_chat_skills, skill_context, skill_detail
from app.timeline_service import TimelineConflict, apply_operation, sync_timeline
from app.main import verify_timeline_shot


class AgentSystemTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        database = Path(self.directory.name) / "accounts.db"
        accounts.DATABASE_PATH = database
        timeline_service.DATABASE_PATH = database
        accounts._schema_ready = False
        timeline_service._schema_ready = False
        skills._schema_path = None
        self.account = await create_account("owner@example.com", "password1", "Owner")
        self.other = await create_account("other@example.com", "password2", "Other")
        self.project_id = "project-a"
        self.asset_id = "asset-a"
        await save_workspace(self.account["id"], {
            "projects": [{"id": self.project_id, "name": "Project A", "color": "green"}],
            "folders": [],
            "files": [{"id": self.asset_id, "projectId": self.project_id, "folderId": "root", "name": "clip.mp4", "size": 100, "type": "video/mp4", "duration": 12, "hasAudio": True, "objectKey": f"projects/{self.project_id}/assets/{self.asset_id}/clip.mp4"}],
        })

    async def asyncTearDown(self) -> None:
        self.directory.cleanup()

    async def test_project_registry_prevents_cross_account_claim(self) -> None:
        with self.assertRaisesRegex(ValueError, "another account"):
            await save_workspace(self.other["id"], {"projects": [{"id": self.project_id, "name": "Stolen"}], "folders": [], "files": []})

    async def test_timeline_revision_and_idempotency(self) -> None:
        document = {"revision": 0, "clips": [{"id": "clip-a", "assetId": self.asset_id, "start": 0, "duration": 4, "lane": 0, "sourceDuration": 12, "trimStart": 0, "role": "visual", "volume": 1}], "trackCounts": {"audio": 1, "visual": 1}}
        synced = await sync_timeline(self.account["id"], self.project_id, 0, document)
        self.assertEqual(synced["revision"], 1)
        result = await apply_operation(self.account["id"], self.project_id, 1, {"kind": "move", "clip_id": "clip-a", "start": 3, "lane": 0}, "call-1")
        self.assertEqual(result["timeline"]["revision"], 2)
        self.assertEqual(result["timeline"]["clips"][0]["start"], 3)
        duplicate = await apply_operation(self.account["id"], self.project_id, 1, {"kind": "move", "clip_id": "clip-a", "start": 9, "lane": 0}, "call-1")
        self.assertEqual(duplicate, result)
        with self.assertRaises(TimelineConflict):
            await apply_operation(self.account["id"], self.project_id, 1, {"kind": "delete", "clip_id": "clip-a"}, "call-2")

    async def test_edit_agent_tool_uses_verified_session_context(self) -> None:
        document = {"revision": 0, "clips": [{"id": "clip-a", "assetId": self.asset_id, "start": 0, "duration": 4, "lane": 0, "sourceDuration": 12, "trimStart": 0, "role": "visual", "volume": 1}], "trackCounts": {"audio": 1, "visual": 1}}
        await sync_timeline(self.account["id"], self.project_id, 0, document)
        context = SimpleNamespace(state={"account_id": self.account["id"], "project_id": self.project_id, "timeline_revision": 1, "selected_clip_ids": ["clip-a"]}, function_call_id="tool-call-1")
        result = await move_clip("clip-a", 2.5, 0, context)
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["timeline"]["clips"][0]["start"], 2.5)
        self.assertEqual(context.state["timeline_revision"], 2)

    async def test_edit_agent_can_browse_and_place_complete_assets(self) -> None:
        context = SimpleNamespace(state={"account_id": self.account["id"], "project_id": self.project_id, "timeline_revision": 0, "selected_clip_ids": [], "playhead": 5}, function_call_id="insert-playhead")
        listed = await list_project_assets("all", "", context)
        self.assertEqual(listed["assets"][0]["id"], self.asset_id)
        self.assertNotIn("objectKey", listed["assets"][0])
        inspected = await inspect_asset(self.asset_id, context)
        self.assertTrue(inspected["asset"]["hasAudio"])

        inserted = await insert_asset_at_playhead(self.asset_id, 0, True, context)
        self.assertEqual(inserted["status"], "completed")
        self.assertEqual({clip["role"] for clip in inserted["timeline"]["clips"]}, {"visual", "audio"})
        self.assertEqual({clip["start"] for clip in inserted["timeline"]["clips"]}, {5})
        self.assertEqual(len({clip["linkId"] for clip in inserted["timeline"]["clips"]}), 1)
        await record_tool_result(SimpleNamespace(name="insert_asset_at_playhead"), {}, context, inserted)
        self.assertEqual(set(context.state["selected_clip_ids"]), {clip["id"] for clip in inserted["timeline"]["clips"]})
        selected = await read_selection(context)
        self.assertEqual(len(selected["clips"]), 2)
        shot = await read_timeline_shot(context)
        self.assertEqual({clip["assetName"] for clip in shot["shot"]["clips"]}, {"clip.mp4"})

        context.function_call_id = "collision"
        collision = await insert_asset_at_playhead(self.asset_id, 0, True, context)
        self.assertEqual(collision["code"], "timeline_collision")
        self.assertEqual(collision["suggestedStart"], 17)
        self.assertEqual(context.state["timeline_revision"], 1)

        anchor_id = next(clip["id"] for clip in inserted["timeline"]["clips"] if clip["role"] == "visual")
        context.function_call_id = "insert-after"
        after = await insert_asset_next_to(self.asset_id, anchor_id, "after", 0, True, context)
        self.assertEqual(after["status"], "completed")
        self.assertEqual(max(clip["start"] for clip in after["timeline"]["clips"]), 17)

        context.function_call_id = "insert-moment"
        moment = await insert_media_moment(self.asset_id, 3, 5, 0, 2, True, context)
        moment_clips = [clip for clip in moment["timeline"]["clips"] if clip["lane"] == 2]
        self.assertEqual({clip["duration"] for clip in moment_clips}, {2})
        self.assertEqual({clip["trimStart"] for clip in moment_clips}, {3})
        self.assertEqual(moment["timeline"]["trackCounts"], {"audio": 3, "visual": 3})

    async def test_agent_can_focus_a_known_clip_and_linked_group(self) -> None:
        document = {"revision": 0, "clips": [{"id": "visual-a", "assetId": self.asset_id, "start": 2, "duration": 4, "lane": 0, "sourceDuration": 12, "trimStart": 0, "role": "visual", "volume": 1, "linkId": "linked-a"}, {"id": "audio-a", "assetId": self.asset_id, "start": 2, "duration": 4, "lane": 0, "sourceDuration": 12, "trimStart": 0, "role": "audio", "volume": 1, "linkId": "linked-a"}], "trackCounts": {"audio": 1, "visual": 1}}
        await sync_timeline(self.account["id"], self.project_id, 0, document)
        context = SimpleNamespace(state={"account_id": self.account["id"], "project_id": self.project_id, "timeline_revision": 1, "selected_clip_ids": [], "playhead": 0}, function_call_id="focus-1")

        focused = await select_timeline_clip("audio-a", context)

        self.assertEqual(set(focused["selection"]["clipIds"]), {"visual-a", "audio-a"})
        self.assertEqual(context.state["playhead"], 2)
        self.assertEqual({clip["id"] for clip in (await read_selection(context))["clips"]}, {"visual-a", "audio-a"})

    async def test_language_dub_is_one_atomic_timeline_change(self) -> None:
        document = {"revision": 0, "clips": [{"id": "visual-a", "assetId": self.asset_id, "start": 0, "duration": 4, "lane": 0, "sourceDuration": 12, "trimStart": 0, "role": "visual", "volume": 1, "linkId": "linked-a"}, {"id": "audio-a", "assetId": self.asset_id, "start": 0, "duration": 4, "lane": 0, "sourceDuration": 12, "trimStart": 0, "role": "audio", "volume": 1, "linkId": "linked-a"}], "trackCounts": {"audio": 1, "visual": 1}}
        await sync_timeline(self.account["id"], self.project_id, 0, document)
        context = SimpleNamespace(state={"account_id": self.account["id"], "project_id": self.project_id, "timeline_revision": 1, "selected_clip_ids": ["visual-a", "audio-a"]}, function_call_id="language-dub")
        generated = {"id": "dub-asset", "projectId": self.project_id, "folderId": "root", "name": "clip - Spanish.wav", "size": 80, "type": "audio/wav", "duration": 4, "objectKey": f"projects/{self.project_id}/assets/dub-asset/spanish.wav"}

        with patch("app.agent_tools.uuid4", side_effect=["dub-asset", "dub-clip"]), patch("app.agent_tools.generate_language_track", new=AsyncMock(return_value={"asset": generated})):
            result = await translate_audio("es", context)

        clips = {clip["id"]: clip for clip in result["timeline"]["clips"]}
        self.assertEqual(result["timeline"]["revision"], 2)
        self.assertEqual(clips["visual-a"]["assetId"], self.asset_id)
        self.assertEqual(clips["audio-a"]["volume"], 0)
        self.assertEqual(clips["dub-clip"]["assetId"], "dub-asset")
        self.assertEqual(result["selection"]["clipIds"], ["dub-clip"])
        self.assertEqual(result["message"], "Added translated dialogue and muted the original audio.")

    async def test_specialist_tools_commit_canonical_results(self) -> None:
        document = {"revision": 0, "clips": [{"id": "clip-a", "assetId": self.asset_id, "start": 0, "duration": 4, "lane": 0, "sourceDuration": 12, "trimStart": 0, "role": "visual", "volume": 1}], "trackCounts": {"audio": 1, "visual": 1}}
        await sync_timeline(self.account["id"], self.project_id, 0, document)
        context = SimpleNamespace(state={"account_id": self.account["id"], "project_id": self.project_id, "timeline_revision": 1, "selected_clip_ids": ["clip-a"]}, function_call_id="vision-1")

        vision = await apply_contrast(1.4, context)
        self.assertEqual(vision["timeline"]["clips"][0]["visionAdjustments"]["contrast"], 1.4)

        context.function_call_id = "hearing-1"
        with patch("app.agent_tools.transcript_for_asset", new=AsyncMock(return_value=[{"start": 0, "end": 1, "text": "Hello"}])):
            hearing = await apply_captions(context)
        self.assertEqual(hearing["timeline"]["captionTrack"]["kind"], "captions")

        context.function_call_id = "deafblind-1"
        with patch("app.agent_tools.braille_transcript", new=AsyncMock(return_value={"cues": [{"start": 0, "end": 1, "text": "Hello", "braille": "⠓⠑⠇⠇⠕"}]})):
            deafblind = await apply_braille_text(context)
        self.assertEqual(deafblind["timeline"]["captionTrack"]["kind"], "braille")

        context.function_call_id = "language-1"
        with patch("app.agent_tools.generate_language_track", new=AsyncMock(return_value={"cues": [{"start": 0, "end": 1, "text": "Hola"}]})):
            language = await translate_captions("es", context)
        self.assertEqual(language["timeline"]["captionTrack"]["language"], "es")

        generated = {"id": "generated-a", "projectId": self.project_id, "folderId": "root", "name": "clip - reduced flash.mp4", "size": 100, "type": "video/mp4", "duration": 4, "objectKey": f"projects/{self.project_id}/assets/generated-a/clip.mp4"}
        context.function_call_id = "sensory-1"
        with patch("app.agent_tools.uuid4", return_value="generated-a"), patch("app.agent_tools.generate_sensory_video", new=AsyncMock(return_value=generated)):
            sensory = await reduce_flash(context)
        self.assertEqual(sensory["timeline"]["clips"][0]["assetId"], "generated-a")
        self.assertEqual(sensory["timeline"]["revision"], 6)

    async def test_specialists_have_distinct_allowlists(self) -> None:
        self.assertIn("move_clip", TOOL_NAMES_BY_AGENT["edit"])
        self.assertIn("list_project_assets", TOOL_NAMES_BY_AGENT["edit"])
        self.assertIn("insert_media_moment", TOOL_NAMES_BY_AGENT["edit"])
        self.assertNotIn("move_clip", TOOL_NAMES_BY_AGENT["vision"])
        self.assertIn("apply_captions", TOOL_NAMES_BY_AGENT["hearing"])
        self.assertIn("apply_braille_text", TOOL_NAMES_BY_AGENT["deafblind"])
        self.assertIn("reduce_flash", TOOL_NAMES_BY_AGENT["sensory"])
        self.assertIn("translate_audio", TOOL_NAMES_BY_AGENT["language"])
        self.assertTrue(all("select_timeline_clip" in TOOL_NAMES_BY_AGENT[agent_id] for agent_id in TOOL_NAMES_BY_AGENT))
        context = SimpleNamespace(agent_name="vision_agent", state={"active_agent_id": "edit", "account_id": self.account["id"], "project_id": self.project_id})
        denied = await authorize_tool_call(SimpleNamespace(name="move_clip"), {}, context)
        self.assertEqual(denied["code"], "tool_not_allowed")

    async def test_every_agent_has_the_tools_for_its_complete_job(self) -> None:
        required = {
            "edit": {"read_timeline_shot", "read_selection", "select_timeline_clip", "list_project_assets", "inspect_asset", "search_media", "insert_asset_at_playhead", "insert_asset_next_to", "insert_media_moment", "move_clip", "trim_clip", "split_clip", "delete_clip", "replace_clip", "replace_clip_track", "set_volume"},
            "vision": {"read_timeline_shot", "read_selection", "select_timeline_clip", "inspect_visual_issue", "apply_audio_description", "apply_spoken_text", "apply_contrast", "apply_colour_safe", "apply_large_text"},
            "hearing": {"read_timeline_shot", "read_selection", "select_timeline_clip", "read_transcript", "apply_captions", "apply_asl", "apply_noise_reduction"},
            "deafblind": {"read_timeline_shot", "read_selection", "select_timeline_clip", "read_transcript", "apply_braille_text", "apply_structured_description", "apply_labels", "apply_navigation", "apply_tactile_cues"},
            "sensory": {"read_timeline_shot", "read_selection", "select_timeline_clip", "inspect_sensory_issue", "reduce_flash", "reduce_motion", "stabilize", "reduce_cuts", "reduce_stimulus", "create_static_version"},
            "language": {"read_timeline_shot", "read_selection", "select_timeline_clip", "read_speaker_turns", "translate_captions", "translate_audio", "translate_descriptions"},
        }

        for agent_id, tool_names in required.items():
            self.assertTrue(tool_names <= TOOL_NAMES_BY_AGENT[agent_id], f"{agent_id} is missing {sorted(tool_names - TOOL_NAMES_BY_AGENT[agent_id])}")

    async def test_edit_coordinates_task_specialists_without_expanding_permissions(self) -> None:
        apps = build_agent_apps()
        self.assertNotIn("general", apps)
        edit = apps["edit"].root_agent
        self.assertEqual(edit.mode, "chat")
        self.assertEqual(
            [(agent.name, agent.mode) for agent in edit.sub_agents],
            [
                ("vision_agent", "task"),
                ("hearing_agent", "task"),
                ("deafblind_agent", "task"),
                ("sensory_agent", "task"),
                ("language_agent", "task"),
            ],
        )
        self.assertEqual(edit.sub_agents[0].mode, "task")
        self.assertIs(edit.sub_agents[0].output_schema, SpecialistTaskResult)
        self.assertTrue(is_feature_enabled(FeatureName.PROGRESSIVE_SSE_STREAMING))
        self.assertEqual(apps["vision"].root_agent.mode, "chat")
        self.assertEqual(apps["vision"].root_agent.sub_agents, [])

        edit_context = SimpleNamespace(agent_name="edit_agent", state={"account_id": self.account["id"], "project_id": self.project_id})
        self.assertIsNone(await authorize_tool_call(SimpleNamespace(name="vision_agent"), {}, edit_context))

        specialist_context = SimpleNamespace(agent_name="vision_agent", state={"active_agent_id": "edit", "account_id": self.account["id"], "project_id": self.project_id})
        self.assertIsNone(await authorize_tool_call(SimpleNamespace(name="finish_task"), {}, specialist_context))
        denied = await authorize_tool_call(SimpleNamespace(name="move_clip"), {}, specialist_context)
        self.assertEqual(denied["code"], "tool_not_allowed")

        missing = AgentToolError("selection_required", "No clip selected", "Select an exact clip", retryable=True)
        response = await return_tool_error(SimpleNamespace(name="apply_contrast"), {}, specialist_context, missing)
        self.assertEqual(response, {"status": "failed", "code": "selection_required", "error": "No clip selected", "retryable": True, "action": "Select an exact clip"})

    async def test_partial_task_calls_wait_for_the_complete_stream_event(self) -> None:
        partial_task = LlmResponse(
            partial=True,
            content=types.Content(
                role="model",
                parts=[types.Part.from_function_call(name="hearing_agent", args={"request": "Caption this"})],
            ),
        )
        complete_task = partial_task.model_copy(update={"partial": False})
        partial_tool = LlmResponse(
            partial=True,
            content=types.Content(
                role="model",
                parts=[types.Part.from_function_call(name="read_timeline", args={})],
            ),
        )

        self.assertIsNone(without_partial_task_calls(partial_task))
        self.assertIs(without_partial_task_calls(complete_task), complete_task)
        self.assertIs(without_partial_task_calls(partial_tool), partial_tool)

    async def test_specialist_stream_event_acknowledges_before_work(self) -> None:
        event = specialist_start_event("hearing")
        self.assertEqual(event["type"], "agent_start")
        self.assertEqual(event["agent"], "hearing")
        self.assertEqual(event["title"], "Hearing Agent")
        self.assertIn("handling", event["acknowledgement"])

    async def test_delegated_stream_starts_before_specialist_tools_and_returns_to_edit(self) -> None:
        events = [
            Event(author="edit_agent", partial=True, content=types.Content(role="model", parts=[types.Part.from_text(text="I will ask Hearing Agent to inspect the captions.")])),
            Event(author="edit_agent", content=types.Content(role="model", parts=[types.Part.from_function_call(name="hearing_agent", args={"request": "Add captions"})])),
            Event(author="hearing_agent", content=types.Content(role="model", parts=[types.Part.from_function_call(name="apply_captions", args={})])),
            Event(author="hearing_agent", content=types.Content(role="model", parts=[types.Part.from_function_response(name="apply_captions", response={"status": "completed"})])),
            Event(author="hearing_agent", partial=True, content=types.Content(role="model", parts=[types.Part.from_text(text="Captions added.")])),
            Event(author="hearing_agent", content=types.Content(role="model", parts=[types.Part.from_function_call(name="finish_task", args={"output": "Captions added"})])),
            Event(author="edit_agent", content=types.Content(role="model", parts=[types.Part.from_function_response(name="hearing_agent", response={"output": "Captions added"})])),
        ]

        class FakeRunner:
            app_name = "amplifier"

            async def run_async(self, **kwargs):
                del kwargs
                for item in events:
                    yield item

        session = SimpleNamespace(state={"chat_title": "Existing"})
        with patch("app.agent_stream.runner_for", return_value=FakeRunner()), patch("app.agent_stream.sessions.get_session", new=AsyncMock(return_value=session)):
            streamed = [json.loads(item.removeprefix("data: ")) async for item in stream_agent_events(user_id=self.account["id"], session_id="chat-a", message="Caption this", agent_id="edit")]

        event_types = [item["type"] for item in streamed]
        self.assertEqual(event_types[:6], ["content", "agent_start", "tool_call", "tool_response", "content", "agent_return"])
        self.assertEqual(streamed[1]["agent"], "hearing")
        self.assertEqual(streamed[2]["name"], "apply_captions")
        self.assertEqual(streamed[2]["surface"], "timeline")
        self.assertEqual(streamed[3]["surface"], "timeline")
        self.assertNotIn("finish_task", [item.get("name") for item in streamed])

    async def test_skills_are_account_scoped_attached_and_instructional_only(self) -> None:
        initial = await skill_context(self.account["id"], self.project_id, "chat-a")
        bundled_ids = {skill["id"] for skill in initial["available_skills"] if not skill["editable"]}
        self.assertIn("clickhouse-media-discovery", bundled_ids)
        self.assertIn("timeline-editing", bundled_ids)

        custom = await create_skill(self.account["id"], "# Precise cuts\n\nKeep cuts on sentence boundaries.")
        selected = await set_chat_skills(self.account["id"], self.project_id, "chat-a", ["timeline-editing", custom["id"]])
        self.assertEqual(selected["selected_skill_ids"], ["timeline-editing", custom["id"]])
        self.assertNotIn("allowed_tool_names", selected)

        context = SimpleNamespace(agent_name="edit_agent", state={"active_agent_id": "edit", "account_id": self.account["id"], "project_id": self.project_id, "attached_skills": [item.__dict__ for item in selected["selected_skill_documents"]]})
        skill_result = await read_attached_skill(custom["id"], context)
        self.assertIn("sentence boundaries", skill_result["instructions"])
        self.assertIsNone(await authorize_tool_call(SimpleNamespace(name="move_clip"), {}, context))
        self.assertIsNone(await authorize_tool_call(SimpleNamespace(name="insert_asset"), {}, context))

        with self.assertRaises(LookupError):
            await skill_detail(self.other["id"], custom["id"])

        await copy_chat_skills(self.account["id"], "chat-a", "chat-b")
        branch = await skill_context(self.account["id"], self.project_id, "chat-b")
        self.assertEqual(branch["selected_skill_ids"], selected["selected_skill_ids"])

    async def test_timeline_shot_is_verified_without_an_extra_model(self) -> None:
        timeline = {"revision": 4, "clips": [{"id": "clip-a", "assetId": self.asset_id, "start": 0, "duration": 4, "lane": 0, "sourceDuration": 12, "trimStart": 0, "role": "visual", "volume": 1}], "trackCounts": {"audio": 1, "visual": 1}}
        shot = {"id": "shot-a", "projectId": self.project_id, "revision": 4, "image": "data:image/png;base64,AA==", "clips": [{"id": "clip-a", "assetId": self.asset_id, "start": 0, "duration": 4, "trimStart": 0, "role": "visual", "lane": 0}]}
        verified = verify_timeline_shot(shot, self.project_id, timeline)
        self.assertFalse(verified["stale"])
        stale = verify_timeline_shot({**shot, "revision": 3}, self.project_id, timeline)
        self.assertTrue(stale["stale"])

    async def test_chat_title_uses_one_flash_call(self) -> None:
        client = MagicMock()
        client.aio.models.generate_content = AsyncMock(return_value=SimpleNamespace(text='  "Precise Timeline Editing"  '))
        with patch("app.agent_stream.genai.Client", return_value=client):
            title = await chat_title("Tighten the opening", "I shortened the first clip.")

        self.assertEqual(title, "Precise Timeline Editing")
        client.aio.models.generate_content.assert_awaited_once()
        request = client.aio.models.generate_content.await_args.kwargs
        self.assertEqual(request["model"], "gemini-3-flash-preview")
        self.assertIn("Tighten the opening", request["contents"])
        self.assertIn("I shortened the first clip.", request["contents"])

    async def test_chat_deletion_removes_session_and_skill_attachments(self) -> None:
        await set_chat_skills(self.account["id"], self.project_id, "chat-a", ["timeline-editing"])
        with patch("app.agent_stream.sessions.delete_session", new=AsyncMock()) as delete_session:
            await delete_agent_session(user_id=self.account["id"], session_id="chat-a")
        delete_session.assert_awaited_once_with(app_name="amplifier", user_id=self.account["id"], session_id="chat-a")

        await delete_chat_skills(self.account["id"], "chat-a")
        context = await skill_context(self.account["id"], self.project_id, "chat-a")
        self.assertEqual(context["selected_skill_ids"], [])


if __name__ == "__main__":
    unittest.main()
