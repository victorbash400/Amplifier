"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent, RefObject } from "react";
import styles from "./TimelinePanel.module.css";

export function TimelineHorizontalScrollbar({ scale, viewportRef }: { scale: number; viewportRef: RefObject<HTMLElement | null> }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef(0);
  const [position, setPosition] = useState(0);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = () => setPosition(viewport.scrollWidth > viewport.clientWidth ? viewport.scrollLeft / (viewport.scrollWidth - viewport.clientWidth) : 0);
    update();
    viewport.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => { viewport.removeEventListener("scroll", update); observer.disconnect(); };
  }, [scale, viewportRef]);

  const thumbWidth = 100 / scale;
  const thumbLeft = position * (100 - thumbWidth);

  function move(event: PointerEvent<HTMLButtonElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const track = trackRef.current;
    const viewport = viewportRef.current;
    if (!track || !viewport) return;
    const available = track.clientWidth - event.currentTarget.offsetWidth;
    const left = Math.max(0, Math.min(available, event.clientX - track.getBoundingClientRect().left - dragOffset.current));
    viewport.scrollLeft = available > 0 ? left / available * (viewport.scrollWidth - viewport.clientWidth) : 0;
  }

  return <div aria-label="Timeline horizontal scrollbar" className={styles.horizontalScrollbar} ref={trackRef}><button aria-label="Scroll timeline horizontally" className={styles.horizontalScrollbarThumb} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); dragOffset.current = event.clientX - event.currentTarget.getBoundingClientRect().left; }} onPointerMove={move} style={{ left: `${thumbLeft}%`, width: `${thumbWidth}%` }} type="button" /></div>;
}
