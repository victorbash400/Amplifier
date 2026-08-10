import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app.media_search import _embed_contents, _moment_document, queue_asset, search_assets


class MediaSearchEfficiencyTests(unittest.TestCase):
    def test_moment_document_keeps_asset_context_and_timed_evidence(self) -> None:
        document = _moment_document("daylife.mp4", "A morning routine with coffee and pottery.", "A woman holds a mug.", "")
        self.assertIn("context: A morning routine with coffee and pottery.", document)
        self.assertIn("moment: A woman holds a mug.", document)

    def test_search_returns_multiple_ranked_moments_from_the_same_asset(self) -> None:
        rows = [
            (f"moment-{index}", "asset", "daylife.mp4", "key", "video/mp4", "root", f"thumb-{index}", index * 2, index * 2 + 2, f"frame {index}", "", 0.9 - index * 0.01)
            for index in range(6)
        ]
        client = MagicMock()
        client.query = AsyncMock(return_value=SimpleNamespace(result_rows=rows))
        client.close = AsyncMock()
        with patch("app.media_search.embed_query", AsyncMock(return_value=[1.0] + [0.0] * 767)), patch("app.media_search.clickhouse_client", AsyncMock(return_value=client)), patch("app.media_search._ensure_schema", AsyncMock()):
            results = asyncio.run(search_assets("project", "coffee", 18))
        self.assertEqual([result["moment_id"] for result in results], [f"moment-{index}" for index in range(6)])
        query = client.query.await_args.args[0]
        self.assertIn("ORDER BY score DESC", query)
        self.assertNotIn("asset_counts", query)

    def test_embedding_two_requests_one_content_per_media_moment(self) -> None:
        models = MagicMock()
        async def embed_content(*, contents, **_kwargs):
            self.assertIsInstance(contents, str)
            return SimpleNamespace(embeddings=[SimpleNamespace(values=[1.0] + [0.0] * 767)])
        models.embed_content = AsyncMock(side_effect=embed_content)
        client = MagicMock()
        client.aio.models = models
        client.aio.aclose = AsyncMock()
        with patch("app.media_search.genai.Client", return_value=client):
            embeddings = asyncio.run(_embed_contents([f"moment {index}" for index in range(101)], "RETRIEVAL_DOCUMENT"))
        self.assertEqual(len(embeddings), 101)
        self.assertEqual(models.embed_content.await_count, 101)

    def test_duplicate_queued_asset_is_reused(self) -> None:
        write = AsyncMock()
        with patch("app.media_search.advisory_lock", unlocked), patch("app.media_search._asset_index_state", AsyncMock(return_value=("queued", "Queued", ""))), patch("app.media_search._write_index_row", write):
            result = asyncio.run(queue_asset(project_id="project", asset_id="asset", object_key="projects/project/assets/asset/file.mp4", name="file.mp4", content_type="video/mp4", folder_id="root", force=True))
        self.assertTrue(result["reused"])
        write.assert_not_awaited()

    def test_failed_asset_is_queued_once_when_retrying(self) -> None:
        write = AsyncMock()
        with patch("app.media_search.advisory_lock", unlocked), patch("app.media_search._asset_index_state", AsyncMock(return_value=("failed", "Failed", "broken"))), patch("app.media_search._write_index_row", write):
            result = asyncio.run(queue_asset(project_id="project", asset_id="asset", object_key="projects/project/assets/asset/file.mp4", name="file.mp4", content_type="video/mp4", folder_id="root", force=True))
        self.assertFalse(result["reused"])
        write.assert_awaited_once()


@asynccontextmanager
async def unlocked(_name: str):
    yield


if __name__ == "__main__":
    unittest.main()
