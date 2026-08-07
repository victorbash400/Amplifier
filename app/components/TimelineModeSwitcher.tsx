"use client";

import Image from "next/image";
import styles from "./TimelineModeSwitcher.module.css";

const modes = [
  { id: "edit", label: "Edit", icons: ["/timeline-svgrepo-com.svg"] },
  { id: "vision", label: "Vision", icons: ["/accessible-media-icons/blind-eyes-svgrepo-com.svg"] },
  { id: "hearing", label: "Hearing", icons: ["/accessible-media-icons/deaf-solid-svgrepo-com.svg"] },
  { id: "deafblind", label: "Deafblind", icons: ["/accessible-media-icons/blind-eyes-svgrepo-com.svg", "/accessible-media-icons/deaf-solid-svgrepo-com.svg"] },
  { id: "cognitive", label: "Cognitive", icons: ["/accessible-media-icons/brain-14-svgrepo-com.svg"] },
  { id: "vision-cognitive", label: "Vision + Cognitive", icons: ["/accessible-media-icons/blind-eyes-svgrepo-com.svg", "/accessible-media-icons/brain-14-svgrepo-com.svg"] },
  { id: "hearing-cognitive", label: "Hearing + Cognitive", icons: ["/accessible-media-icons/deaf-solid-svgrepo-com.svg", "/accessible-media-icons/brain-14-svgrepo-com.svg"] },
  { id: "deafblind-cognitive", label: "Deafblind + Cognitive", icons: ["/accessible-media-icons/blind-eyes-svgrepo-com.svg", "/accessible-media-icons/deaf-solid-svgrepo-com.svg", "/accessible-media-icons/brain-14-svgrepo-com.svg"] },
  { id: "sensory", label: "Sensory", icons: ["/accessible-media-icons/sensory.svg"] },
] as const;

export type TimelineMode = typeof modes[number]["id"];

export function TimelineModeSwitcher({ onChange, selected }: { onChange: (mode: TimelineMode) => void; selected: TimelineMode }) {
  return <nav aria-label="Timeline modes" className={styles.switcher}>{modes.map((mode) => {
    const icon = mode.icons.length > 1 ? <span className={styles.pairedIcons}>{mode.icons.map((source) => <Image alt="" height={20} key={source} src={source} width={20} />)}</span> : <Image alt="" height={20} src={mode.icons[0]} width={20} />;
    return <button aria-label={mode.label} aria-pressed={selected === mode.id} className={styles.mode} key={mode.id} onClick={() => onChange(mode.id)} type="button">{icon}<span>{mode.label}</span></button>;
  })}</nav>;
}
