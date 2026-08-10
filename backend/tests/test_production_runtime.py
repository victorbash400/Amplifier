from __future__ import annotations

import unittest

from app.agent_tools import insert_asset, translate_audio
from app.agent_engine_runtime import parse_stream_json
from app.database import _postgres_query
from app.remote_agent_tools import RemoteFunctionTool


class ProductionRuntimeTests(unittest.TestCase):
    def test_postgres_adapter_translates_parameters_and_timestamps(self) -> None:
        query = _postgres_query("INSERT INTO users (id, created_at) VALUES (?, datetime('now'))")
        self.assertEqual(query, "INSERT INTO users (id, created_at) VALUES ($1, CURRENT_TIMESTAMP::text)")

    def test_remote_tools_preserve_typed_adk_schemas(self) -> None:
        insert = RemoteFunctionTool(insert_asset, "edit")._get_declaration()
        translate = RemoteFunctionTool(translate_audio, "language")._get_declaration()
        self.assertEqual(set(insert.parameters_json_schema["properties"]), {"asset_id", "start", "lane", "include_audio"})
        self.assertEqual(set(translate.parameters_json_schema["properties"]), {"language"})
        self.assertNotIn("tool_context", insert.parameters_json_schema["properties"])

    def test_agent_engine_stream_parser_handles_fragmented_events(self) -> None:
        buffer, payloads = parse_stream_json("", b'{"author":"edit')
        self.assertEqual(payloads, [])
        buffer, payloads = parse_stream_json(buffer, b'_agent"}\n[{"author":"vision_agent"}]')
        self.assertEqual(buffer, "")
        self.assertEqual(payloads, [{"author": "edit_agent"}, {"author": "vision_agent"}])


if __name__ == "__main__":
    unittest.main()
