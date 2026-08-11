import asyncio
from pathlib import Path
import shutil
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from app.language_tools import LanguagePreflightError, SpeakerTurn, VoicePresentation, _bounded_turns, _canonicalize_speakers, _fit_audio, _preflight_turns, _speaker_voice, _translate_turns, _turns_from_results


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

    def test_google_zero_based_speaker_labels_are_canonicalized(self) -> None:
        turns = _canonicalize_speakers([
            SpeakerTurn(0, 1, "First", 0),
            SpeakerTurn(1, 2, "Second", 2),
        ])
        self.assertEqual([turn.speaker for turn in turns], [1, 2])

    def test_diarized_turns_are_bounded_to_verified_media_duration(self) -> None:
        turns = _bounded_turns([
            SpeakerTurn(4, 6, "Ends at boundary", 0),
            SpeakerTurn(7, 8, "After file", 1),
        ], 5)
        self.assertEqual(turns, [SpeakerTurn(4, 5, "Ends at boundary", 0)])

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

    def test_voice_profile_has_no_model_controlled_speaker_id(self) -> None:
        self.assertEqual(VoicePresentation.model_validate_json('{"presentation":"neutral"}').presentation, "neutral")
        self.assertNotIn("speaker", VoicePresentation.model_json_schema()["properties"])

    def test_preflight_sorts_and_normalizes_diarized_turns(self) -> None:
        turns = _preflight_turns([
            SpeakerTurn(3, 4, " second   turn ", 2),
            SpeakerTurn(1, 2, "first turn", 1),
        ], 5)
        self.assertEqual([(turn.speaker, turn.text) for turn in turns], [(1, "first turn"), (2, "second turn")])

    def test_preflight_rejects_invalid_speaker_before_generation(self) -> None:
        with self.assertRaisesRegex(LanguagePreflightError, "speaker ID"):
            _preflight_turns([SpeakerTurn(1, 2, "hello", 0)], 3)

    def test_preflight_rejects_turn_past_media_duration(self) -> None:
        with self.assertRaisesRegex(LanguagePreflightError, "media duration"):
            _preflight_turns([SpeakerTurn(1, 5, "hello", 1)], 3)

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
