"use client";

import { Link2 } from "lucide-react";
import type { MutableRefObject, PointerEvent } from "react";
import { TimelineClipMedia } from "./TimelineClipMedia";
import type { TimelineClip } from "./timelineTypes";
import { trackTop } from "./timelineTracks";
import styles from "./TimelinePanel.module.css";

export type TimelineClipHandlers = { onBeginEdit: (kind: "move" | "trim", id: string) => void; onEndEdit: () => void; onMove: (id: string, clientX: number, clientY: number) => void; onSelect: (id: string) => void; onTrim: (id: string, edge: "start" | "end", clientX: number) => void };

export function TimelineClipItem({ clip, dragOffsetRef, handlers, selected, timelineDuration }: { clip: TimelineClip; dragOffsetRef: MutableRefObject<number>; handlers: TimelineClipHandlers; selected: boolean; timelineDuration: number }) {
  function start(event: PointerEvent<HTMLElement>) { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); dragOffsetRef.current = ((event.clientX - event.currentTarget.getBoundingClientRect().left) / event.currentTarget.getBoundingClientRect().width) * clip.duration; handlers.onBeginEdit("move", clip.id); handlers.onSelect(clip.id); }
  function move(event: PointerEvent<HTMLElement>) { if (event.currentTarget.hasPointerCapture(event.pointerId)) handlers.onMove(clip.id, event.clientX, event.clientY); }
  function trim(event: PointerEvent<HTMLButtonElement>, edge: "start" | "end") { event.stopPropagation(); if (event.type === "pointerdown") { event.currentTarget.setPointerCapture(event.pointerId); handlers.onBeginEdit("trim", clip.id); } if (event.currentTarget.hasPointerCapture(event.pointerId)) handlers.onTrim(clip.id, edge, event.clientX); }
  return <article className={styles.clip} data-role={clip.role} data-selected={selected} onPointerCancel={handlers.onEndEdit} onPointerDown={start} onPointerMove={move} onPointerUp={handlers.onEndEdit} style={{ left: `${(clip.start / timelineDuration) * 100}%`, top: `calc(${trackTop(clip.role, clip.lane)} + 4px)`, width: `${(clip.duration / timelineDuration) * 100}%` }}><button aria-label={`Trim start of ${clip.asset.name}`} className={styles.trimHandle} data-edge="start" onPointerDown={(event) => trim(event, "start")} onPointerMove={(event) => trim(event, "start")} type="button" /><TimelineClipMedia asset={clip.asset} duration={clip.duration} role={clip.role} trimStart={clip.trimStart} />{clip.linkId && <span aria-label="Linked clip" className={styles.linkBadge}><Link2 size={9} /></span>}<strong>{clip.asset.name}</strong><button aria-label={`Trim end of ${clip.asset.name}`} className={styles.trimHandle} data-edge="end" onPointerDown={(event) => trim(event, "end")} onPointerMove={(event) => trim(event, "end")} type="button" /></article>;
}
