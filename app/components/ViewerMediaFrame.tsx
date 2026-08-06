import Image from "next/image";
import { FileText, Music2 } from "lucide-react";
import { useState } from "react";
import { assetUrl } from "../lib/assetUploads";
import type { ProjectFile } from "../types/workspace";
import styles from "./ViewerMonitor.module.css";

type Orientation = "horizontal" | "vertical" | "square";

export function ViewerMediaFrame({ asset, onMediaElement }: { asset?: ProjectFile; onMediaElement: (media: HTMLMediaElement | null) => void }) {
  const [orientation, setOrientation] = useState<Orientation>("horizontal");
  const url = asset ? assetUrl(asset) : "";
  return <output className={styles.stage} aria-label={asset ? `${asset.name} preview` : "Viewer is empty"}><span className={styles.frame} data-orientation={orientation}>{asset?.type.startsWith("video/") && <video className={styles.video} onLoadedMetadata={(event) => setOrientation(mediaOrientation(event.currentTarget.videoWidth, event.currentTarget.videoHeight))} playsInline preload="metadata" ref={onMediaElement} src={url} />}{asset?.type.startsWith("image/") && <Image alt="" className={styles.image} fill onLoad={(event) => setOrientation(mediaOrientation(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight))} sizes="50vw" src={url} unoptimized />}{asset?.type.startsWith("audio/") && <><audio preload="metadata" ref={onMediaElement} src={url} /><span className={styles.placeholder}><Music2 size={28} />{asset.name}</span></>}{asset && !asset.type.startsWith("video/") && !asset.type.startsWith("image/") && !asset.type.startsWith("audio/") && <span className={styles.placeholder}><FileText size={28} />{asset.name}</span>}</span></output>;
}

function mediaOrientation(width: number, height: number): Orientation {
  if (!width || !height) return "horizontal";
  const ratio = width / height;
  if (ratio < 0.9) return "vertical";
  if (ratio <= 1.1) return "square";
  return "horizontal";
}
