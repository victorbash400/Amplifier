import Image from "next/image";
import { FileText } from "lucide-react";
import { assetUrl } from "../lib/assetUploads";
import type { ProjectFile } from "../types/workspace";
import { TimelineAudioWaveform } from "./TimelineAudioWaveform";
import { TimelineVideoFilmstrip } from "./TimelineVideoFilmstrip";
import styles from "./TimelinePanel.module.css";

export function TimelineClipMedia({ asset, duration, role, trimStart }: { asset: ProjectFile; duration: number; role: "visual" | "audio"; trimStart: number }) {
  if (role === "audio") return <TimelineAudioWaveform asset={asset} duration={duration} trimStart={trimStart} />;
  if (asset.type.startsWith("image/")) return <Image alt="" className={styles.clipMedia} fill sizes="240px" src={assetUrl(asset)} unoptimized />;
  if (asset.type.startsWith("video/")) return <TimelineVideoFilmstrip asset={asset} duration={duration} trimStart={trimStart} />;
  if (asset.type.startsWith("audio/")) return <TimelineAudioWaveform asset={asset} duration={duration} trimStart={trimStart} />;
  return <span className={styles.clipPlaceholder}><FileText size={16} /></span>;
}
