from __future__ import annotations

import math
import mimetypes
from dataclasses import dataclass
from pathlib import Path
import subprocess
import tempfile

from google.cloud import storage

from app.config import settings


@dataclass(frozen=True)
class RenderClip:
    object_key: str
    name: str
    content_type: str
    start: float
    duration: float
    trim_start: float
    lane: int
    role: str
    volume: float = 1
    contrast: float = 1
    color_preset: str | None = None


@dataclass(frozen=True)
class RenderCaption:
    start: float
    end: float
    text: str


def render_timeline(project_id: str, asset_id: str, name: str, clips: list[RenderClip], captions: list[RenderCaption] | None = None) -> dict[str, object]:
    if not clips:
        raise ValueError("Timeline has no clips")
    duration = max(clip.start + clip.duration for clip in clips)
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("Timeline duration is invalid")
    bucket = storage.Client(project=settings.google_cloud_project).bucket(settings.gcs_bucket)
    with tempfile.TemporaryDirectory(prefix="amplifier-render-") as directory:
        root = Path(directory)
        input_keys = list(dict.fromkeys(clip.object_key for clip in clips))
        input_index_by_key = {object_key: index for index, object_key in enumerate(input_keys)}
        clip_by_key = {clip.object_key: clip for clip in clips}
        input_clips = [clip_by_key[object_key] for object_key in input_keys]
        inputs = [_download_clip(bucket, root, index, clip) for index, clip in enumerate(input_clips)]
        input_indexes = [input_index_by_key[clip.object_key] for clip in clips]
        output = root / "render.mp4"
        subtitles = _write_subtitles(root, captions or [], duration)
        command = _ffmpeg_command(clips, inputs, [_has_audio(path) for path in inputs], output, duration, input_indexes, subtitles)
        process = subprocess.run(command, capture_output=True, text=True, timeout=max(180, int(duration * 8)), check=False)
        if process.returncode or not output.exists() or output.stat().st_size < 1:
            detail = process.stderr.strip().splitlines()[-1] if process.stderr.strip() else "Unknown FFmpeg error"
            raise RuntimeError(f"Timeline render failed: {detail}")
        object_key = f"projects/{project_id}/assets/{asset_id}/{name}"
        blob = bucket.blob(object_key)
        blob.metadata = {"project_id": project_id, "asset_id": asset_id, "timeline_render": "true", "duration": f"{duration:.3f}"}
        blob.upload_from_filename(output, content_type="video/mp4", if_generation_match=0)
        blob.reload()
        return {"object_key": object_key, "generation": str(blob.generation or ""), "size": int(blob.size or output.stat().st_size), "duration": duration}


def _download_clip(bucket: storage.Bucket, root: Path, index: int, clip: RenderClip) -> Path:
    extension = Path(clip.name).suffix or mimetypes.guess_extension(clip.content_type) or ".bin"
    path = root / f"input-{index}{extension}"
    bucket.blob(clip.object_key).download_to_filename(path)
    return path


def _ffmpeg_command(clips: list[RenderClip], inputs: list[Path], has_audio: list[bool], output: Path, duration: float, input_indexes: list[int] | None = None, subtitles: Path | None = None) -> list[str]:
    width, height, frame_rate = 1280, 720, 30
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"]
    for path in inputs:
        command.extend(["-i", str(path)])

    filters = [f"color=c=black:s={width}x{height}:r={frame_rate}:d={duration}[base]"]
    visual = "base"
    audio_streams: list[str] = []
    indexes = input_indexes or list(range(len(clips)))
    for index, clip in sorted(enumerate(clips), key=lambda item: (item[1].lane, item[1].start)):
        input_index = indexes[index]
        if clip.role == "visual" and clip.content_type.startswith(("video/", "image/")):
            source = f"v{index}"
            trim = f"loop=loop=-1:size=1:start=0,trim=duration={clip.duration}" if clip.content_type.startswith("image/") else f"trim=start={clip.trim_start}:duration={clip.duration}"
            adjustments = _visual_filters(clip)
            filters.append(f"[{input_index}:v]{trim},setpts=PTS-STARTPTS+{clip.start}/TB,{adjustments}scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2[{source}]")
            next_visual = f"mix{index}"
            filters.append(f"[{visual}][{source}]overlay=eof_action=pass:enable='between(t,{clip.start},{clip.start + clip.duration})'[{next_visual}]")
            visual = next_visual
        if clip.role == "audio" and clip.content_type.startswith(("video/", "audio/")) and has_audio[input_index] and clip.volume > 0:
            audio = f"a{index}"
            delay = round(clip.start * 1000)
            filters.append(f"[{input_index}:a]atrim=start={clip.trim_start}:duration={clip.duration},asetpts=PTS-STARTPTS,volume={clip.volume},adelay={delay}:all=1[{audio}]")
            audio_streams.append(audio)

    if subtitles:
        escaped_path = str(subtitles).replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")
        filters.append(f"[{visual}]subtitles='{escaped_path}'[captioned]")
        visual = "captioned"

    if audio_streams:
        joined = "".join(f"[{stream}]" for stream in audio_streams)
        filters.append(f"{joined}amix=inputs={len(audio_streams)}:normalize=0:dropout_transition=0[aout]")
    else:
        filters.append(f"anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration={duration}[aout]")

    command.extend(["-filter_complex", ";".join(filters), "-map", f"[{visual}]", "-map", "[aout]", "-t", str(duration), "-r", str(frame_rate), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(output)])
    return command


def _visual_filters(clip: RenderClip) -> str:
    filters = []
    if abs(clip.contrast - 1) >= .01:
        filters.append(f"eq=contrast={clip.contrast}")
    color = {"red-green": "colorcontrast=rc=0.35:gm=0.25:rcw=0.7:gmw=0.7:pl=0.8", "blue-yellow": "colorcontrast=by=0.4:byw=0.8:pl=0.8", "all-channels": "colorcontrast=rc=0.25:gm=0.2:by=0.25:rcw=0.6:gmw=0.6:byw=0.6:pl=0.8"}.get(clip.color_preset or "")
    if color:
        filters.append(color)
    return ",".join(filters) + ("," if filters else "")


def _write_subtitles(root: Path, captions: list[RenderCaption], duration: float) -> Path | None:
    valid = [cue for cue in captions if math.isfinite(cue.start) and math.isfinite(cue.end) and 0 <= cue.start < cue.end <= duration + .01 and cue.text.strip()]
    if not valid:
        return None
    path = root / "captions.ass"
    header = """[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,42,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,1,2,72,72,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events = [f"Dialogue: 0,{_ass_time(cue.start)},{_ass_time(cue.end)},Default,,0,0,0,,{_ass_text(cue.text)}" for cue in valid]
    path.write_text(header + "\n".join(events) + "\n", encoding="utf-8")
    return path


def _ass_time(seconds: float) -> str:
    centiseconds = round(seconds * 100)
    hours, remainder = divmod(centiseconds, 360000)
    minutes, remainder = divmod(remainder, 6000)
    whole_seconds, fraction = divmod(remainder, 100)
    return f"{hours}:{minutes:02d}:{whole_seconds:02d}.{fraction:02d}"


def _ass_text(text: str) -> str:
    return text.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}").replace("\r", "").replace("\n", "\\N")


def _has_audio(path: Path) -> bool:
    result = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_type", "-of", "csv=p=0", str(path)], capture_output=True, text=True, timeout=30, check=False)
    return result.returncode == 0 and result.stdout.strip() == "audio"
