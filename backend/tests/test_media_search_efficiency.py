import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app.media_search import _embed_contents, queue_asset


class MediaSearchEfficiencyTests(unittest.TestCase):
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
