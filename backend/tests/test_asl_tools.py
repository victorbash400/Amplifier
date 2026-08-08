import unittest

from app.asl_tools import AslCue, AslPlan, _validate_sigml, _validated_cues


VALID_SIGML = """<?xml version="1.0" encoding="utf-8"?>
<sigml><hamgestural_sign gloss="I"><sign_manual><handconfig handshape="finger2" thumbpos="across"/><handconfig extfidir="il"/><handconfig palmor="r"/><location_bodyarm location="chest" contact="touch"/></sign_manual></hamgestural_sign></sigml>"""


class AslToolTests(unittest.TestCase):
    def test_accepts_cwasa_sigml(self) -> None:
        _validate_sigml(VALID_SIGML)

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


if __name__ == "__main__":
    unittest.main()
