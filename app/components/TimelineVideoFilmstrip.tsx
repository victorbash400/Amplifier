"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { assetUrl } from "../lib/assetUploads";
import type { ProjectFile } from "../types/workspace";
import styles from "./TimelinePanel.module.css";

export function TimelineVideoFilmstrip({ asset, duration, trimStart }: { asset: ProjectFile; duration: number; trimStart: number }) {
  const [frames, setFrames] = useState<string[]>([]);
  const frameCount = Math.min(6, Math.max(3, Math.ceil(duration)));
  useEffect(() => {
    let cancelled = false;
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.onloadedmetadata = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 160;
      canvas.height = 90;
      const context = canvas.getContext("2d");
      if (!context) return;
      const nextFrames: string[] = [];
      let index = 0;
      const capture = () => {
        if (cancelled) return;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        nextFrames.push(canvas.toDataURL("image/jpeg", 0.72));
        index += 1;
        if (index === frameCount) return setFrames(nextFrames);
        video.currentTime = Math.min(trimStart + (duration * (index + .5)) / frameCount, Math.max(0, video.duration - .05));
      };
      video.onseeked = capture;
      video.currentTime = Math.min(trimStart + duration / (frameCount * 2), Math.max(0, video.duration - .05));
    };
    const start = () => { video.src = assetUrl(asset); };
    const idleId = typeof requestIdleCallback === "function" ? requestIdleCallback(start, { timeout: 800 }) : undefined;
    const timeoutId = idleId === undefined ? globalThis.setTimeout(start, 0) : undefined;
    return () => { cancelled = true; if (idleId !== undefined) cancelIdleCallback(idleId); if (timeoutId !== undefined) clearTimeout(timeoutId); video.removeAttribute("src"); video.load(); };
  }, [asset, duration, frameCount, trimStart]);
  return <span className={styles.filmstrip}>{frames.map((frame, index) => <span key={`${asset.id}-${index}`}><Image alt="" fill sizes="120px" src={frame} unoptimized /></span>)}</span>;
}
