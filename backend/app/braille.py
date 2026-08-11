import asyncio
import shutil
import subprocess

from app.transcript_service import transcript_for_asset


TRANSLATION_TABLE = "en-ueb-g2.ctb"


async def braille_transcript(project_id: str, asset_id: str, object_key: str | None = None) -> dict[str, object]:
    cues = await transcript_for_asset(project_id, asset_id, object_key)
    if not cues:
        return {"cues": [], "brf": ""}

    source_lines = [_single_line(str(cue["text"])) for cue in cues]
    timestamp_lines = [f"{_timestamp(float(cue['start']))} to {_timestamp(float(cue['end']))}" for cue in cues]
    unicode_lines, brf_lines, brf_timestamps = await asyncio.gather(
        asyncio.to_thread(_translate, source_lines, "unicode.dis"),
        asyncio.to_thread(_translate, source_lines, "en-us-brf.dis"),
        asyncio.to_thread(_translate, timestamp_lines, "en-us-brf.dis"),
    )
    translated = [
        {**cue, "text": unicode_lines[index], "brf": brf_lines[index], "brfTime": brf_timestamps[index]}
        for index, cue in enumerate(cues)
    ]
    return {"cues": translated, "brf": _brf_document(translated)}


def _translate(lines: list[str], display_table: str) -> list[str]:
    executable = shutil.which("lou_translate")
    if not executable:
        raise RuntimeError("Braille translation requires Liblouis (lou_translate)")
    result = subprocess.run(
        [executable, f"{display_table},{TRANSLATION_TABLE}"],
        input="\n".join(lines) + "\n",
        capture_output=True,
        check=False,
        text=True,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "Liblouis could not translate the transcript")
    translated = result.stdout.splitlines()
    if len(translated) != len(lines):
        raise RuntimeError("Liblouis returned an incomplete Braille transcript")
    return translated


def _brf_document(cues: list[dict[str, object]]) -> str:
    blocks = [f"{cue['brfTime']}\n{cue['brf']}" for cue in cues]
    return "\n\n".join(blocks) + "\n"


def _single_line(value: str) -> str:
    return " ".join(value.split())


def _timestamp(value: float) -> str:
    seconds = max(0, round(value))
    return f"{seconds // 60:02d}:{seconds % 60:02d}"
