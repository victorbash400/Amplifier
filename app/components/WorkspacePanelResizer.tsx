"use client";

import type { KeyboardEvent, PointerEvent, RefObject } from "react";
import styles from "./WorkspacePanelResizer.module.css";

const defaultShare = 48;
const minimumViewer = 190;
const minimumTimeline = 260;

export function WorkspacePanelResizer({ containerRef, onChange, onCommit, value }: { containerRef: RefObject<HTMLElement | null>; onChange: (value: number) => void; onCommit: (value: number) => void; value: number }) {
  function shareAt(clientY: number) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return value;
    const usable = Math.max(1, rect.height - 30);
    const minimum = Math.min(45, minimumViewer / usable * 100);
    const maximum = Math.max(55, 100 - minimumTimeline / usable * 100);
    return Math.max(minimum, Math.min(maximum, (clientY - rect.top - 10) / usable * 100));
  }

  function resize(event: PointerEvent<HTMLButtonElement>) {
    if (event.type === "pointerdown") event.currentTarget.setPointerCapture(event.pointerId);
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    onChange(shareAt(event.clientY));
  }

  function finish(event: PointerEvent<HTMLButtonElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const next = shareAt(event.clientY);
    event.currentTarget.releasePointerCapture(event.pointerId);
    onChange(next);
    onCommit(next);
  }

  function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const change = event.key === "ArrowUp" ? -2 : event.key === "ArrowDown" ? 2 : 0;
    if (!change) return;
    event.preventDefault();
    const next = Math.max(30, Math.min(70, value + change));
    onChange(next);
    onCommit(next);
  }

  function reset() { onChange(defaultShare); onCommit(defaultShare); }

  return <button aria-label="Resize viewers and timeline" aria-orientation="horizontal" aria-valuemax={70} aria-valuemin={30} aria-valuenow={Math.round(value)} className={styles.resizer} onDoubleClick={reset} onKeyDown={keyDown} onPointerDown={resize} onPointerMove={resize} onPointerUp={finish} role="separator" title="Drag to resize viewers and timeline. Double-click to reset." type="button"><span /></button>;
}
