from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from app.timeline_renderer import RenderClip, _ffmpeg_command


class TimelineRendererTests(unittest.TestCase):
    def test_builds_composer_style_video_and_audio_mix(self) -> None:
        clips = [
            RenderClip("video", "shot.mp4", "video/mp4", 2, 4, 1, 0, "visual", contrast=1.2),
            RenderClip("audio", "voice.mp3", "audio/mpeg", 2, 4, .5, 1, "audio", volume=.6),
        ]
        command = _ffmpeg_command(clips, [Path("shot.mp4"), Path("voice.mp3")], [True, True], Path("render.mp4"), 6)
        filters = command[command.index("-filter_complex") + 1]
        self.assertIn("color=c=black:s=1280x720:r=30:d=6", filters)
        self.assertIn("trim=start=1:duration=4", filters)
        self.assertIn("eq=contrast=1.2", filters)
        self.assertIn("atrim=start=0.5:duration=4", filters)
        self.assertIn("volume=0.6", filters)
        self.assertIn("adelay=2000:all=1", filters)
        self.assertIn("amix=inputs=1:normalize=0", filters)
        self.assertIn("+faststart", command)

    def test_muted_audio_is_not_mixed(self) -> None:
        clip = RenderClip("audio", "voice.mp3", "audio/mpeg", 0, 3, 0, 1, "audio", volume=0)
        command = _ffmpeg_command([clip], [Path("voice.mp3")], [True], Path("render.mp4"), 3)
        filters = command[command.index("-filter_complex") + 1]
        self.assertIn("anullsrc=channel_layout=stereo", filters)
        self.assertNotIn("amix=", filters)

    def test_linked_video_and_audio_share_one_ffmpeg_input(self) -> None:
        clips = [
            RenderClip("video", "shot.mp4", "video/mp4", 0, 3, 0, 0, "visual"),
            RenderClip("video", "shot.mp4", "video/mp4", 0, 3, 0, 1, "audio"),
        ]
        command = _ffmpeg_command(clips, [Path("shot.mp4")], [True], Path("render.mp4"), 3, [0, 0])
        filters = command[command.index("-filter_complex") + 1]
        self.assertEqual(command.count("-i"), 1)
        self.assertIn("[0:v]", filters)
        self.assertIn("[0:a]", filters)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg is not installed")
    def test_ffmpeg_renders_a_playable_master(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.mp4"
            output = root / "output.mp4"
            subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x180:d=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-y", str(source)], check=True)
            clips = [RenderClip("video", "source.mp4", "video/mp4", 0, 1, 0, 0, "visual", color_preset="all-channels"), RenderClip("video", "source.mp4", "video/mp4", 0, 1, 0, 1, "audio")]
            command = _ffmpeg_command(clips, [source], [True], output, 1, [0, 0])
            subprocess.run(command, capture_output=True, text=True, timeout=30, check=True)
            probe = subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", str(output)], text=True)
        self.assertEqual(probe.strip().splitlines(), ["video", "audio"])


if __name__ == "__main__":
    unittest.main()
