import unittest

from app.media_indexing import IndexedMoment, _align_video, _audio_moments
from app.media_transcription import TranscriptSegment, TranscriptWord


class MediaIndexingTests(unittest.TestCase):
    def test_audio_transcript_words_are_split_into_seekable_windows(self) -> None:
        transcript = [TranscriptSegment(
            start=0.2,
            end=4.4,
            text="one two three",
            words=(
                TranscriptWord(start=0.2, end=0.5, text="one"),
                TranscriptWord(start=2.1, end=2.4, text="two"),
                TranscriptWord(start=4.1, end=4.4, text="three"),
            ),
        )]

        moments = _audio_moments(transcript)

        self.assertEqual(
            moments,
            [
                IndexedMoment(start=0, end=2, transcript="one"),
                IndexedMoment(start=2, end=4, transcript="two"),
                IndexedMoment(start=4, end=6, transcript="three"),
            ],
        )

    def test_video_transcript_words_are_assigned_to_one_window(self) -> None:
        descriptions = [
            IndexedMoment(start=0, end=2, description="First"),
            IndexedMoment(start=2, end=4, description="Second"),
        ]
        transcript = [TranscriptSegment(
            start=1.5,
            end=2.5,
            text="coffee arrives",
            words=(
                TranscriptWord(start=1.5, end=2.1, text="coffee"),
                TranscriptWord(start=2.1, end=2.5, text="arrives"),
            ),
        )]

        moments = _align_video(descriptions, transcript)

        self.assertEqual(moments[0].transcript, "coffee")
        self.assertEqual(moments[1].transcript, "arrives")


if __name__ == "__main__":
    unittest.main()
