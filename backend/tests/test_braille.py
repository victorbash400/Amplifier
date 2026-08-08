import asyncio
import shutil
import unittest
from unittest.mock import AsyncMock, patch

from app.braille import _brf_document, _translate, braille_transcript


@unittest.skipUnless(shutil.which("lou_translate"), "Liblouis is not installed")
class BrailleTranslationTests(unittest.TestCase):
    def test_translates_each_line_to_unicode_and_brf(self) -> None:
        source = ["Your entire life can change.", "Coffee is ready."]

        unicode_lines = _translate(source, "unicode.dis")
        brf_lines = _translate(source, "en-us-brf.dis")

        self.assertEqual(len(unicode_lines), 2)
        self.assertTrue(all(any("\u2800" <= character <= "\u28ff" for character in line) for line in unicode_lines))
        self.assertTrue(all(line.isascii() for line in brf_lines))

    def test_brf_document_keeps_cue_timestamps(self) -> None:
        document = _brf_document([
            {"brfTime": "#JJ3JB TO #JJ3JD", "brf": ",COFFEE IS R1DY4"},
            {"brfTime": "#JA3JE TO #JA3JH", "brf": ",NEXT CUE4"},
        ])

        self.assertEqual(document, "#JJ3JB TO #JJ3JD\n,COFFEE IS R1DY4\n\n#JA3JE TO #JA3JH\n,NEXT CUE4\n")

    def test_builds_a_timed_braille_track(self) -> None:
        transcript = [{"id": "cue-1", "start": 2.1, "end": 4.2, "text": "Coffee is ready."}]

        with patch("app.braille.asset_transcript", new=AsyncMock(return_value=transcript)):
            result = asyncio.run(braille_transcript("project", "asset"))

        cue = result["cues"][0]
        self.assertTrue(any("\u2800" <= character <= "\u28ff" for character in cue["text"]))
        self.assertTrue(cue["brf"].isascii())
        self.assertIn(cue["brfTime"], result["brf"])


if __name__ == "__main__":
    unittest.main()
