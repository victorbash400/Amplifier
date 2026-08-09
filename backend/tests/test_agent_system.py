import tempfile
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from app import accounts, timeline_service
from app.accounts import create_account, save_workspace
from app.agents.media_agents import TOOL_NAMES_BY_AGENT, authorize_tool_call
from app.agent_tools import apply_braille_text, apply_captions, apply_contrast, inspect_asset, insert_asset_at_playhead, insert_asset_next_to, insert_media_moment, list_project_assets, reduce_flash, translate_captions, move_clip
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
        context = SimpleNamespace(state={"active_agent_id": "vision", "account_id": self.account["id"], "project_id": self.project_id})
        denied = await authorize_tool_call(SimpleNamespace(name="move_clip"), {}, context)
        self.assertEqual(denied["code"], "tool_not_allowed")

    async def test_timeline_shot_is_verified_without_an_extra_model(self) -> None:
        timeline = {"revision": 4, "clips": [{"id": "clip-a", "assetId": self.asset_id, "start": 0, "duration": 4, "lane": 0, "sourceDuration": 12, "trimStart": 0, "role": "visual", "volume": 1}], "trackCounts": {"audio": 1, "visual": 1}}
        shot = {"id": "shot-a", "projectId": self.project_id, "revision": 4, "image": "data:image/png;base64,AA==", "clips": [{"id": "clip-a", "assetId": self.asset_id, "start": 0, "duration": 4, "trimStart": 0, "role": "visual", "lane": 0}]}
        verified = verify_timeline_shot(shot, self.project_id, timeline)
        self.assertFalse(verified["stale"])
        stale = verify_timeline_shot({**shot, "revision": 3}, self.project_id, timeline)
        self.assertTrue(stale["stale"])


if __name__ == "__main__":
    unittest.main()
