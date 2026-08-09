import { Accessibility, Activity, AudioLines, Captions, CaseUpper, Contrast, Eye, FileText, Focus, Image, Navigation, Scissors, Tags, Vibrate, Video, Volume1, Volume2, ZapOff } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import NextImage from "next/image";
import type { TimelineMode } from "./TimelineModeSwitcher";
import { TimelineAslSourcePicker, type AslSource } from "./TimelineAslSourcePicker";
import { TimelineHearingNoiseControl } from "./TimelineHearingNoiseControl";
import { TimelineVisionColorFilter } from "./TimelineVisionColorFilter";
import { TimelineVisionContrastControl } from "./TimelineVisionContrastControl";
import type { TimelineVisionAdjustments } from "./timelineTypes";
import styles from "./TimelinePanel.module.css";

export type VisionToolAction = "audio-description" | "spoken-text" | "transcript" | "braille" | "larger-text" | "contrast" | "color-safe";
export type VisionColorPreset = "red-green" | "blue-yellow" | "all-channels";
export type HearingToolAction = "captions" | "transcript" | "asl" | "noise-reduce";
export type SensoryToolAction = "reduce-flash" | "reduce-motion" | "stabilize" | "fewer-cuts" | "less-stimulus" | "static-version";
type Tool = { Icon: LucideIcon; label: string; shortLabel: string; action?: VisionToolAction | HearingToolAction | SensoryToolAction; iconSrc?: string };
const brailleIcon = "/accessible-media-icons/braille-svgrepo-com.svg";
const aslIcon = "/accessible-media-icons/sign-language-interpretation-svgrepo-com.svg";

const modeTools: Record<Exclude<TimelineMode, "edit">, Tool[]> = {
  vision: [
    tool("Audio description", "Audio describe", AudioLines, "audio-description"), tool("Spoken on-screen text", "Spoken text", Volume2, "spoken-text"), tool("Descriptive transcript", "Transcript", FileText, "transcript"), tool("Braille transcript", "Braille", Accessibility, "braille", brailleIcon), tool("Larger text", "Larger text", CaseUpper, "larger-text"), tool("Higher contrast", "Contrast", Contrast, "contrast"), tool("Colour-safe visuals", "Colour safe", Contrast, "color-safe"),
  ],
  hearing: [
    tool("Captions", "Captions", Captions, "captions"), tool("Transcript", "Transcript", FileText, "transcript"), tool("ASL interpretation", "ASL", Accessibility, "asl", aslIcon), tool("Reduced background noise", "Noise reduce", Volume1, "noise-reduce"),
  ],
  deafblind: [
    tool("Braille-ready transcript", "Braille", Accessibility, undefined, brailleIcon), tool("Structured descriptive transcript", "Structured text", FileText), tool("Speaker and scene labels", "Labels", Tags), tool("Explicit sound descriptions", "Sound desc.", AudioLines), tool("Explicit visual descriptions", "Visual desc.", Eye), tool("Chapters and navigation landmarks", "Navigation", Navigation), tool("Large-print version", "Large print", CaseUpper), tool("Haptic or tactile cue metadata", "Tactile cues", Vibrate),
  ],
  sensory: [
    tool("Reduce flashing", "Reduce flash", ZapOff, "reduce-flash"), tool("Reduce motion", "Reduce motion", Activity, "reduce-motion"), tool("Stabilize footage", "Stabilize", Video, "stabilize"), tool("Reduce rapid cutting", "Fewer cuts", Scissors, "fewer-cuts"), tool("Reduce background stimulation", "Less stimulus", Focus, "less-stimulus"), tool("Create a static alternative", "Static version", Image, "static-version"),
  ],
  language: [],
};

export function TimelineAccessibilityTools({ clipSelected, mode, noiseReduction, onContrastChange, onHearingAction, onNoiseReduction, onSensoryAction, onVisionAction, visionAdjustments, working }: { clipSelected: boolean; mode: Exclude<TimelineMode, "edit">; noiseReduction?: number; onContrastChange?: (value: number) => void; onHearingAction?: (action: HearingToolAction, source?: AslSource) => void; onNoiseReduction?: (value: number) => void; onSensoryAction?: (action: SensoryToolAction) => void; onVisionAction?: (action: VisionToolAction, preset?: VisionColorPreset) => void; visionAdjustments?: TimelineVisionAdjustments; working?: VisionToolAction | HearingToolAction | SensoryToolAction }) {
  return <nav aria-label={`${mode} tools`} className={styles.accessibilityTools}>{modeTools[mode].map(({ Icon, action, iconSrc, label, shortLabel }) => {
    const unavailable = (mode === "vision" || mode === "hearing") && !action;
    if (mode === "vision" && action === "contrast") return <TimelineVisionContrastControl disabled={!clipSelected || Boolean(working)} key={label} onChange={(value) => onContrastChange?.(value)} value={visionAdjustments?.contrast ?? 1} />;
    if (mode === "vision" && action === "color-safe") return <TimelineVisionColorFilter disabled={!clipSelected || Boolean(working)} key={label} onApply={(preset) => onVisionAction?.(action, preset)} value={visionAdjustments?.colorPreset} />;
    if (mode === "hearing" && action === "asl") return <TimelineAslSourcePicker disabled={!clipSelected || Boolean(working)} key={label} onSelect={(source) => onHearingAction?.(action, source)} working={working === action} />;
    if (mode === "hearing" && action === "noise-reduce") return <TimelineHearingNoiseControl disabled={!clipSelected || Boolean(working)} key={label} onApply={(value) => onNoiseReduction?.(value)} value={noiseReduction ?? 0} />;
    return <button aria-label={label} aria-pressed={action && working === action || undefined} disabled={!clipSelected || unavailable || Boolean(working)} key={label} onClick={() => { if (mode === "vision" && action) onVisionAction?.(action as VisionToolAction); if (mode === "hearing" && (action === "captions" || action === "transcript")) onHearingAction?.(action); if (mode === "sensory" && action) onSensoryAction?.(action as SensoryToolAction); }} title={!clipSelected ? `Select a relevant clip to use ${label.toLowerCase()}` : unavailable ? `Next ${mode} pass` : label} type="button">{iconSrc ? <NextImage alt="" height={15} src={iconSrc} width={15} /> : <Icon size={15} />}<span>{shortLabel}</span></button>;
  })}</nav>;
}

function tool(label: string, shortLabel: string, Icon: LucideIcon, action?: VisionToolAction | HearingToolAction | SensoryToolAction, iconSrc?: string): Tool {
  return { Icon, label, shortLabel, action, iconSrc };
}
