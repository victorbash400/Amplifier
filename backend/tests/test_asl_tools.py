import unittest

from app.asl_tools import AslCue, AslNotebook, AslPlan, AslPreflightError, _preflight_cues, _validate_notebook, _validate_sigml, _validated_cues


VALID_SIGML = """<?xml version="1.0" encoding="utf-8"?>
<sigml><hamgestural_sign gloss="I"><sign_manual><handconfig handshape="finger2" thumbpos="across"/><handconfig extfidir="il"/><handconfig palmor="r"/><location_bodyarm location="chest" contact="touch"/></sign_manual></hamgestural_sign></sigml>"""


class AslToolTests(unittest.TestCase):
    def test_accepts_cwasa_sigml(self) -> None:
        _validate_sigml(VALID_SIGML)

    def test_accepts_nested_cwasa_location(self) -> None:
        _validate_sigml("""<sigml><hamgestural_sign gloss="INTERNET"><sign_manual><handconfig handshape="pinchall"/><handconstellation contact="touch"><location_hand digits="3" location="tip"/><location_bodyarm contact="close" location="shouldertop"/></handconstellation></sign_manual></hamgestural_sign></sigml>""")

    def test_accepts_motion_from_the_previous_sign_location(self) -> None:
        _validate_sigml("""<sigml><hamgestural_sign gloss="GROW"><sign_manual><handconfig handshape="flattened"/><hammove_directional direction="u"/></sign_manual></hamgestural_sign></sigml>""")

    def test_rejects_xml_without_signs(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "incomplete"):
            _validate_sigml("<sigml />")

    def test_rejects_doctype(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "unsupported"):
            _validate_sigml("<!DOCTYPE sigml><sigml><hamgestural_sign gloss='x'/></sigml>")

    def test_preserves_source_cue_timing(self) -> None:
        plan = AslPlan(cues=[AslCue(id="one", start=1, end=3, gloss="I", sigml=VALID_SIGML)])
        self.assertEqual(_validated_cues(plan, [{"id": "one", "start": 1, "end": 3, "text": "I"}])[0]["id"], "one")

    def test_rejects_changed_cue_timing(self) -> None:
        plan = AslPlan(cues=[AslCue(id="one", start=1.5, end=3, gloss="I", sigml=VALID_SIGML)])
        with self.assertRaisesRegex(RuntimeError, "timing"):
            _validated_cues(plan, [{"id": "one", "start": 1, "end": 3, "text": "I"}])

    def test_preflight_normalizes_and_sorts_source_cues(self) -> None:
        cues = _preflight_cues([
            {"id": "two", "start": 3, "end": 4, "text": "Second"},
            {"id": "one", "start": 1, "end": 2, "text": "First"},
        ])
        self.assertEqual([cue["id"] for cue in cues], ["one", "two"])

    def test_preflight_rejects_duplicate_ids_before_generation(self) -> None:
        with self.assertRaisesRegex(AslPreflightError, "duplicated"):
            _preflight_cues([
                {"id": "one", "start": 1, "end": 2, "text": "First"},
                {"id": "one", "start": 2, "end": 3, "text": "Second"},
            ])

    def test_preflight_rejects_invalid_timing_before_generation(self) -> None:
        with self.assertRaisesRegex(AslPreflightError, "timing"):
            _preflight_cues([{"id": "one", "start": 2, "end": 1, "text": "First"}])

    def test_notebook_accepts_valid_saved_prefix(self) -> None:
        source = [
            {"id": "one", "start": 1, "end": 2, "text": "First"},
            {"id": "two", "start": 2, "end": 3, "text": "Second"},
        ]
        notebook = AslNotebook(
            version=3,
            source="description",
            evidence_hash="hash",
            expected_ids=["one", "two"],
            completed=[AslCue(id="one", start=1, end=2, gloss="FIRST", sigml=VALID_SIGML)],
            status="failed",
            next_index=1,
        )
        _validate_notebook(notebook, "description", "hash", ["one", "two"], source)

    def test_notebook_rejects_non_prefix_progress(self) -> None:
        source = [
            {"id": "one", "start": 1, "end": 2, "text": "First"},
            {"id": "two", "start": 2, "end": 3, "text": "Second"},
        ]
        notebook = AslNotebook(
            version=3,
            source="description",
            evidence_hash="hash",
            expected_ids=["one", "two"],
            completed=[AslCue(id="two", start=2, end=3, gloss="SECOND", sigml=VALID_SIGML)],
            status="failed",
            next_index=1,
        )
        with self.assertRaisesRegex(RuntimeError, "order"):
            _validate_notebook(notebook, "description", "hash", ["one", "two"], source)


if __name__ == "__main__":
    unittest.main()
