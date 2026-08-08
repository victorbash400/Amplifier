import { Accessibility, Activity, AudioLines, AudioWaveform, BadgeInfo, BookOpen, Captions, CaseUpper, CircleAlert, Clock3, Contrast, Eye, FileText, Focus, Gauge, Image, Languages, ListMusic, ListTree, MessageSquareText, Music, Navigation, PanelsTopLeft, Pin, Rows3, Scissors, SkipForward, Speech, Tags, TextQuote, UserRound, Vibrate, Video, Volume1, Volume2, ZapOff } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import NextImage from "next/image";
import type { TimelineMode } from "./TimelineModeSwitcher";
import { TimelineVisionColorFilter } from "./TimelineVisionColorFilter";
import { TimelineVisionContrastControl } from "./TimelineVisionContrastControl";
import type { TimelineVisionAdjustments } from "./timelineTypes";
import styles from "./TimelinePanel.module.css";

export type VisionToolAction = "audio-description" | "spoken-text" | "transcript" | "braille" | "larger-text" | "contrast" | "color-safe";
export type VisionColorPreset = "red-green" | "blue-yellow" | "all-channels";
type Tool = { Icon: LucideIcon; label: string; shortLabel: string; action?: VisionToolAction; iconSrc?: string };
const brailleIcon = "/accessible-media-icons/braille-svgrepo-com.svg";

const modeTools: Record<Exclude<TimelineMode, "edit">, Tool[]> = {
  vision: [
    tool("Audio description", "Audio describe", AudioLines, "audio-description"), tool("Spoken on-screen text", "Spoken text", Volume2, "spoken-text"), tool("Descriptive transcript", "Transcript", FileText, "transcript"), tool("Braille transcript", "Braille", Accessibility, "braille", brailleIcon), tool("Larger text", "Larger text", CaseUpper, "larger-text"), tool("Higher contrast", "Contrast", Contrast, "contrast"), tool("Colour-safe visuals", "Colour safe", Contrast, "color-safe"),
  ],
  hearing: [
    tool("Captions", "Captions", Captions), tool("Speaker identification", "Speakers", UserRound), tool("Sound-effect captions", "Sound effects", AudioWaveform), tool("Music descriptions", "Music desc.", Music), tool("Lyrics", "Lyrics", ListMusic), tool("Transcript", "Transcript", FileText), tool("Sign-language interpretation", "Sign language", Languages), tool("Dialogue enhancement", "Dialogue", Speech), tool("Reduced background noise", "Noise reduce", Volume1),
  ],
  deafblind: [
    tool("Braille-ready transcript", "Braille", Accessibility, undefined, brailleIcon), tool("Structured descriptive transcript", "Structured text", FileText), tool("Speaker and scene labels", "Labels", Tags), tool("Explicit sound descriptions", "Sound desc.", AudioLines), tool("Explicit visual descriptions", "Visual desc.", Eye), tool("Chapters and navigation landmarks", "Navigation", Navigation), tool("Large-print version", "Large print", CaseUpper), tool("Haptic or tactile cue metadata", "Tactile cues", Vibrate),
  ],
  cognitive: [
    tool("Plain-language captions", "Plain captions", Captions), tool("Simplified transcript", "Simple text", FileText), tool("Scene summaries", "Summaries", TextQuote), tool("Chaptering", "Chapters", BookOpen), tool("Recaps", "Recaps", Clock3), tool("Slower presentation", "Slow down", Gauge), tool("Clear speaker names", "Speakers", UserRound), tool("Explanations of implied events", "Explain", BadgeInfo), tool("Reduced visual clutter", "Less clutter", Focus), tool("Alternative reading levels", "Reading level", Languages),
  ],
  "vision-cognitive": [
    tool("Concise audio description", "Concise AD", AudioLines), tool("Plain-language audio description", "Plain AD", MessageSquareText), tool("Slower narration", "Slow narration", Gauge), tool("Explicit character naming", "Characters", UserRound), tool("Simplified scene descriptions", "Simple scenes", Eye), tool("Braille-ready easy-read text", "Easy Braille", Accessibility, undefined, brailleIcon), tool("Short chapter summaries", "Short summaries", BookOpen), tool("Reduced competing sound during narration", "Reduce sound", Volume1),
  ],
  "hearing-cognitive": [
    tool("Plain-language captions", "Plain captions", Captions), tool("Shorter caption segments", "Short captions", Rows3), tool("Reduced reading speed", "Reading speed", Gauge), tool("Persistent speaker labels", "Speaker labels", Pin), tool("Simplified sound descriptions", "Simple sounds", AudioWaveform), tool("Icons paired with text", "Icons + text", Image), tool("Scene recaps", "Scene recaps", Clock3), tool("Clean transcripts", "Clean text", FileText), tool("Sign language alongside simplified text", "Sign + text", Languages),
  ],
  "deafblind-cognitive": [
    tool("Easy-read Braille-ready transcript", "Easy Braille", Accessibility, undefined, brailleIcon), tool("Short structured descriptions", "Short desc.", FileText), tool("Explicit speakers, actions and scene changes", "Explicit cues", Tags), tool("Simple chronological language", "Chronology", ListTree), tool("Strong chapter structure", "Chapters", BookOpen), tool("Navigation landmarks", "Landmarks", Navigation), tool("Optional symbol-supported text", "Symbols", PanelsTopLeft), tool("No dependence on colour, sound or visual position", "Channel safe", Contrast),
  ],
  sensory: [
    tool("Flash detection and reduction", "Reduce flash", ZapOff), tool("Motion reduction", "Reduce motion", Activity), tool("Stabilized footage", "Stabilize", Video), tool("Reduced rapid cutting", "Fewer cuts", Scissors), tool("Loudness smoothing", "Smooth audio", Volume1), tool("Removal or attenuation of sudden peaks", "Reduce peaks", AudioWaveform), tool("Reduced background stimulation", "Less stimulus", Focus), tool("Trigger markers", "Triggers", CircleAlert), tool("Skip regions", "Skip regions", SkipForward), tool("Static alternatives", "Static version", Image),
  ],
};

export function TimelineAccessibilityTools({ clipSelected, mode, onContrastChange, onVisionAction, visionAdjustments, working }: { clipSelected: boolean; mode: Exclude<TimelineMode, "edit">; onContrastChange?: (value: number) => void; onVisionAction?: (action: VisionToolAction, preset?: VisionColorPreset) => void; visionAdjustments?: TimelineVisionAdjustments; working?: VisionToolAction }) {
  return <nav aria-label={`${mode} tools`} className={styles.accessibilityTools}>{modeTools[mode].map(({ Icon, action, iconSrc, label, shortLabel }) => {
    const unavailable = mode === "vision" && !action;
    if (mode === "vision" && action === "contrast") return <TimelineVisionContrastControl disabled={!clipSelected || Boolean(working)} key={label} onChange={(value) => onContrastChange?.(value)} value={visionAdjustments?.contrast ?? 1} />;
    if (mode === "vision" && action === "color-safe") return <TimelineVisionColorFilter disabled={!clipSelected || Boolean(working)} key={label} onApply={(preset) => onVisionAction?.(action, preset)} value={visionAdjustments?.colorPreset} />;
    return <button aria-label={label} aria-pressed={action && working === action || undefined} disabled={!clipSelected || unavailable || Boolean(working)} key={label} onClick={() => action && onVisionAction?.(action)} title={!clipSelected ? `Select a relevant clip to use ${label.toLowerCase()}` : unavailable ? "Next Vision pass" : label} type="button">{iconSrc ? <NextImage alt="" height={15} src={iconSrc} width={15} /> : <Icon size={15} />}<span>{shortLabel}</span></button>;
  })}</nav>;
}

function tool(label: string, shortLabel: string, Icon: LucideIcon, action?: VisionToolAction, iconSrc?: string): Tool {
  return { Icon, label, shortLabel, action, iconSrc };
}
