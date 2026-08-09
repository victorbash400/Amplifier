import asyncio
from pathlib import Path
import shutil
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from app.language_tools import SpeakerTurn, _fit_audio, _speaker_voice, _translate_turns, _turns_from_results


class LanguageToolTests(unittest.TestCase):
    def test_speaker_voices_match_presentation_and_stay_distinct(self) -> None:
        self.assertEqual(_speaker_voice(1, "masculine"), "Charon")
        self.assertEqual(_speaker_voice(2, "masculine"), "Fenrir")
        self.assertEqual(_speaker_voice(1, "feminine"), "Aoede")
        self.assertEqual(_speaker_voice(2, "feminine"), "Kore")

    def test_missing_word_end_uses_the_next_word_boundary(self) -> None:
        def offset(seconds: float):
            return SimpleNamespace(seconds=int(seconds), microseconds=round((seconds % 1) * 1_000_000))
        words = [SimpleNamespace(word="Hello", speaker_label="1", start_offset=offset(1), end_offset=offset(1)), SimpleNamespace(word="there", speaker_label="1", start_offset=offset(1.4), end_offset=offset(1.8))]
        results = [SimpleNamespace(alternatives=[SimpleNamespace(words=words)])]
        self.assertEqual(_turns_from_results(results), [SpeakerTurn(1, 1.8, "Hello there", 1)])

    def test_translation_keeps_one_result_per_speaker_turn(self) -> None:
        response = MagicMock()
        response.translations = [MagicMock(translated_text="Hola mundo"), MagicMock(translated_text="Buen día")]
        client = MagicMock()
        client.translate_text.return_value = response
        turns = [SpeakerTurn(1, 2, "Hello world", 1), SpeakerTurn(2, 3, "Good morning", 2)]
        with patch("app.language_tools.translate_v3.TranslationServiceClient", return_value=client):
            translated = asyncio.run(_translate_turns(turns, "es"))
        self.assertEqual(translated, ["Hola mundo", "Buen día"])
        request = client.translate_text.call_args.kwargs["request"]
        self.assertEqual(request["contents"], ["Hello world", "Good morning"])
        self.assertTrue(request["model"].endswith("/models/general/translation-llm"))

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg is not installed")
    def test_fitted_audio_does_not_exceed_its_source_turn(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.mp3"
            subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-y", str(source)], check=True)
            fitted = _fit_audio(source.read_bytes(), .75)
            output = Path(directory) / "output.mp3"
            output.write_bytes(fitted)
            duration = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(output)], text=True).strip())
        self.assertLessEqual(duration, .82)


if __name__ == "__main__":
    unittest.main()
