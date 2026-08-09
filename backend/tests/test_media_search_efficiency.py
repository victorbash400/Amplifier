import asyncio
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app.media_search import _embed_contents


class MediaSearchEfficiencyTests(unittest.TestCase):
    def test_embeddings_are_batched_instead_of_requested_per_moment(self) -> None:
        models = MagicMock()
        async def embed_content(*, contents, **_kwargs):
            return SimpleNamespace(embeddings=[SimpleNamespace(values=[1.0] + [0.0] * 767) for _ in contents])
        models.embed_content = AsyncMock(side_effect=embed_content)
        client = MagicMock()
        client.aio.models = models
        client.aio.aclose = AsyncMock()
        with patch("app.media_search.genai.Client", return_value=client):
            embeddings = asyncio.run(_embed_contents([f"moment {index}" for index in range(101)], "RETRIEVAL_DOCUMENT"))
        self.assertEqual(len(embeddings), 101)
        self.assertEqual(models.embed_content.await_count, 2)


if __name__ == "__main__":
    unittest.main()
