import { FileText, Film, ImageIcon, Music2 } from "lucide-react";

export function FileTypeIcon({ name, type }: { name: string; type: string }) {
  const extension = name.split(".").at(-1)?.toLowerCase();
  if (type.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "svg"].includes(extension || "")) return <ImageIcon size={14} />;
  if (type.startsWith("video/") || ["mp4", "mov", "webm"].includes(extension || "")) return <Film size={14} />;
  if (type.startsWith("audio/") || ["mp3", "wav", "m4a"].includes(extension || "")) return <Music2 size={14} />;
  return <FileText size={14} />;
}
