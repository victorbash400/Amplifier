import { Check } from "lucide-react";
import type { ProjectFolder } from "../types/workspace";
import { FolderIcon } from "./icons/FolderIcon";
import styles from "./TimelineExportDestinationPicker.module.css";

export function TimelineExportDestinationPicker({ folders, onSelect, selectedId }: { folders: ProjectFolder[]; onSelect: (id: string) => void; selectedId: string }) {
  const destinations = [{ id: "root", name: "Project root", color: "olive" as const }, ...folders];
  return <fieldset className={styles.picker}><legend>Location</legend>{destinations.map((destination) => {
    const selected = destination.id === selectedId;
    return <button aria-pressed={selected} key={destination.id} onClick={() => onSelect(destination.id)} type="button"><FolderIcon color={destination.color} size="button" /><span>{destination.name}</span>{selected && <Check aria-hidden="true" size={14} strokeWidth={2.25} />}</button>;
  })}</fieldset>;
}
