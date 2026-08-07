import { Accessibility, Activity, AudioLines, AudioWaveform, BadgeInfo, BookOpen, Captions, CaseUpper, CircleAlert, Clock3, Contrast, Eye, FileText, Focus, Gauge, Image, Languages, ListMusic, ListTree, MessageSquareText, Music, Navigation, Palette, PanelsTopLeft, Pin, Rows3, ScanSearch, Scissors, SkipForward, Speech, Tags, TextQuote, UserRound, Vibrate, Video, Volume1, Volume2, ZapOff } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { TimelineMode } from "./TimelineModeSwitcher";
import styles from "./TimelinePanel.module.css";

type Tool = { Icon: LucideIcon; label: string; shortLabel: string };

const modeTools: Record<Exclude<TimelineMode, "edit">, Tool[]> = {
  vision: [
    tool("Audio description", "Audio describe", AudioLines), tool("Extended audio description", "Extended AD", Clock3), tool("Spoken on-screen text", "Spoken text", Volume2), tool("Descriptive transcript", "Transcript", FileText), tool("Braille-ready description", "Braille", Accessibility), tool("Larger text", "Larger text", CaseUpper), tool("Higher contrast", "Contrast", Contrast), tool("Colour-safe visuals", "Colour safe", Palette), tool("Zoomed or reframed video", "Reframe", ScanSearch),
  ],
  hearing: [
    tool("Captions", "Captions", Captions), tool("Speaker identification", "Speakers", UserRound), tool("Sound-effect captions", "Sound effects", AudioWaveform), tool("Music descriptions", "Music desc.", Music), tool("Lyrics", "Lyrics", ListMusic), tool("Transcript", "Transcript", FileText), tool("Sign-language interpretation", "Sign language", Languages), tool("Dialogue enhancement", "Dialogue", Speech), tool("Reduced background noise", "Noise reduce", Volume1),
  ],
  deafblind: [
    tool("Braille-ready transcript", "Braille", Accessibility), tool("Structured descriptive transcript", "Structured text", FileText), tool("Speaker and scene labels", "Labels", Tags), tool("Explicit sound descriptions", "Sound desc.", AudioLines), tool("Explicit visual descriptions", "Visual desc.", Eye), tool("Chapters and navigation landmarks", "Navigation", Navigation), tool("Large-print version", "Large print", CaseUpper), tool("Haptic or tactile cue metadata", "Tactile cues", Vibrate),
  ],
  cognitive: [
    tool("Plain-language captions", "Plain captions", Captions), tool("Simplified transcript", "Simple text", FileText), tool("Scene summaries", "Summaries", TextQuote), tool("Chaptering", "Chapters", BookOpen), tool("Recaps", "Recaps", Clock3), tool("Slower presentation", "Slow down", Gauge), tool("Clear speaker names", "Speakers", UserRound), tool("Explanations of implied events", "Explain", BadgeInfo), tool("Reduced visual clutter", "Less clutter", Focus), tool("Alternative reading levels", "Reading level", Languages),
  ],
  "vision-cognitive": [
    tool("Concise audio description", "Concise AD", AudioLines), tool("Plain-language audio description", "Plain AD", MessageSquareText), tool("Slower narration", "Slow narration", Gauge), tool("Explicit character naming", "Characters", UserRound), tool("Simplified scene descriptions", "Simple scenes", Eye), tool("Braille-ready easy-read text", "Easy Braille", Accessibility), tool("Short chapter summaries", "Short summaries", BookOpen), tool("Reduced competing sound during narration", "Reduce sound", Volume1),
  ],
  "hearing-cognitive": [
    tool("Plain-language captions", "Plain captions", Captions), tool("Shorter caption segments", "Short captions", Rows3), tool("Reduced reading speed", "Reading speed", Gauge), tool("Persistent speaker labels", "Speaker labels", Pin), tool("Simplified sound descriptions", "Simple sounds", AudioWaveform), tool("Icons paired with text", "Icons + text", Image), tool("Scene recaps", "Scene recaps", Clock3), tool("Clean transcripts", "Clean text", FileText), tool("Sign language alongside simplified text", "Sign + text", Languages),
  ],
  "deafblind-cognitive": [
    tool("Easy-read Braille-ready transcript", "Easy Braille", Accessibility), tool("Short structured descriptions", "Short desc.", FileText), tool("Explicit speakers, actions and scene changes", "Explicit cues", Tags), tool("Simple chronological language", "Chronology", ListTree), tool("Strong chapter structure", "Chapters", BookOpen), tool("Navigation landmarks", "Landmarks", Navigation), tool("Optional symbol-supported text", "Symbols", PanelsTopLeft), tool("No dependence on colour, sound or visual position", "Channel safe", Contrast),
  ],
  sensory: [
    tool("Flash detection and reduction", "Reduce flash", ZapOff), tool("Motion reduction", "Reduce motion", Activity), tool("Stabilized footage", "Stabilize", Video), tool("Reduced rapid cutting", "Fewer cuts", Scissors), tool("Loudness smoothing", "Smooth audio", Volume1), tool("Removal or attenuation of sudden peaks", "Reduce peaks", AudioWaveform), tool("Reduced background stimulation", "Less stimulus", Focus), tool("Trigger markers", "Triggers", CircleAlert), tool("Skip regions", "Skip regions", SkipForward), tool("Static alternatives", "Static version", Image),
  ],
};

export function TimelineAccessibilityTools({ clipSelected, mode }: { clipSelected: boolean; mode: Exclude<TimelineMode, "edit"> }) {
  return <nav aria-label={`${mode} tools`} className={styles.accessibilityTools}>{modeTools[mode].map(({ Icon, label, shortLabel }) => <button aria-label={label} disabled={!clipSelected} key={label} title={clipSelected ? label : `Select a relevant clip to use ${label.toLowerCase()}`} type="button"><Icon size={15} /><span>{shortLabel}</span></button>)}</nav>;
}

function tool(label: string, shortLabel: string, Icon: LucideIcon): Tool {
  return { Icon, label, shortLabel };
}
