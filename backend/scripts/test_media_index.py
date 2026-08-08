from __future__ import annotations

import argparse
import asyncio
import json
import mimetypes
import sys
import time
from pathlib import Path


backend = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(backend))

from app.media_indexing import build_local_index  # noqa: E402
from app.media_search import _embed_documents, embed_query  # noqa: E402


async def main() -> None:
    parser = argparse.ArgumentParser(description="Run Amplifier's media indexer without the UI, GCS, or ClickHouse")
    parser.add_argument("files", nargs="+", type=Path)
    parser.add_argument("--query", action="append", default=[])
    args = parser.parse_args()
    searchable = []
    for source in args.files:
        content_type = mimetypes.guess_type(source.name)[0] or "application/octet-stream"
        started = time.perf_counter()
        media_index = await build_local_index(source, content_type)
        print(json.dumps({
            "file": str(source),
            "content_type": content_type,
            "elapsed_seconds": round(time.perf_counter() - started, 2),
            "summary": media_index.summary,
            "silence": [item.__dict__ for item in media_index.silence],
            "moments": [moment.__dict__ for moment in media_index.moments],
        }, indent=2))
        searchable.extend((source.name, moment) for moment in media_index.moments)
    if args.query and searchable:
        embeddings = await _embed_documents([f"{name}. {moment.description}. {moment.transcript}" for name, moment in searchable])
        for query in args.query:
            query_embedding = await embed_query(query)
            ranked = sorted(zip(searchable, embeddings, strict=True), key=lambda item: _score(query_embedding, item[1]), reverse=True)[:3]
            print(json.dumps({"query": query, "results": [{
                "file": name,
                "start": moment.start,
                "end": moment.end,
                "description": moment.description,
                "transcript": moment.transcript,
                "score": round(_score(query_embedding, embedding), 4),
            } for ((name, moment), embedding) in ranked]}, indent=2))


def _score(left: list[float], right: list[float]) -> float:
    return sum(a * b for a, b in zip(left, right, strict=True))


if __name__ == "__main__":
    asyncio.run(main())
