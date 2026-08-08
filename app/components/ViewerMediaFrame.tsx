import Image from "next/image";
import { FileText, Music2 } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { assetUrl } from "../lib/assetUploads";
import type { ProjectFile } from "../types/workspace";
import type { TimelineVisionAdjustments } from "./timelineTypes";
import styles from "./ViewerMonitor.module.css";

type Orientation = "horizontal" | "vertical" | "square";

export function ViewerMediaFrame({ asset, children, onMediaElement, visionAdjustments }: { asset?: ProjectFile; children?: ReactNode; onMediaElement: (media: HTMLMediaElement | null) => void; visionAdjustments?: TimelineVisionAdjustments }) {
  const [orientation, setOrientation] = useState<Orientation>("horizontal");
  const url = asset ? assetUrl(asset) : "";
  const style = visionAdjustments ? { filter: cssVisionFilter(visionAdjustments) } : undefined;
  return <output className={styles.stage} aria-label={asset ? `${asset.name} preview` : "Viewer is empty"}><span className={styles.frame} data-orientation={orientation}>{asset?.type.startsWith("video/") && <video className={styles.video} onLoadedMetadata={(event) => setOrientation(mediaOrientation(event.currentTarget.videoWidth, event.currentTarget.videoHeight))} playsInline preload="metadata" ref={onMediaElement} src={url} style={style} />}{asset?.type.startsWith("image/") && <Image alt="" className={styles.image} fill onLoad={(event) => setOrientation(mediaOrientation(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight))} sizes="50vw" src={url} style={style} unoptimized />}{asset?.type.startsWith("audio/") && <><audio preload="metadata" ref={onMediaElement} src={url} /><span className={styles.placeholder}><Music2 size={28} />{asset.name}</span></>}{asset && !asset.type.startsWith("video/") && !asset.type.startsWith("image/") && !asset.type.startsWith("audio/") && <span className={styles.placeholder}><FileText size={28} />{asset.name}</span>}{children}</span></output>;
}

function cssVisionFilter(adjustments: TimelineVisionAdjustments) {
  const color = adjustments.colorPreset === "red-green" ? "saturate(1.65) hue-rotate(-10deg)" : adjustments.colorPreset === "blue-yellow" ? "saturate(1.6) hue-rotate(18deg)" : adjustments.colorPreset === "all-channels" ? "saturate(1.45)" : "";
  return `contrast(${adjustments.contrast ?? 1}) ${color}`.trim();
}

function mediaOrientation(width: number, height: number): Orientation {
  if (!width || !height) return "horizontal";
  const ratio = width / height;
  if (ratio < 0.9) return "vertical";
  if (ratio <= 1.1) return "square";
  return "horizontal";
}
