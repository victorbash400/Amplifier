"use client";

import { useState } from "react";
import type { ProjectFolder } from "../types/workspace";
import { TimelineExportDestinationPicker } from "./TimelineExportDestinationPicker";
import styles from "./TimelineExportModal.module.css";

export function TimelineExportModal({ busy, captionsAvailable, error, folders, initialName, onCancel, onSave }: { busy: boolean; captionsAvailable: boolean; error?: string; folders: ProjectFolder[]; initialName: string; onCancel: () => void; onSave: (name: string, folderId: string, includeCaptions: boolean) => void }) {
  const [folderId, setFolderId] = useState("root");
  const [name, setName] = useState(initialName);
  const [includeCaptions, setIncludeCaptions] = useState(captionsAvailable);
  return <section aria-labelledby="timeline-export-title" aria-modal="true" className={styles.backdrop} role="dialog"><form className={styles.modal} onSubmit={(event) => { event.preventDefault(); onSave(name.trim(), folderId, includeCaptions); }}><header><section><h2 id="timeline-export-title">Export video</h2><p>Render this timeline as an MP4 in your project.</p></section></header><label className={styles.name}>Name<input autoFocus disabled={busy} maxLength={100} onChange={(event) => setName(event.target.value)} value={name} /></label>{captionsAvailable && <label className={styles.option}><input checked={includeCaptions} disabled={busy} onChange={(event) => setIncludeCaptions(event.target.checked)} type="checkbox" /><span>Burn captions into video</span></label>}{busy && <section aria-label="Export in progress" aria-valuetext="Rendering video" className={styles.progress} role="progressbar"><i /></section>}{error && <p className={styles.error} role="alert">{error}</p>}<TimelineExportDestinationPicker folders={folders} onSelect={setFolderId} selectedId={folderId} /><footer><button className={styles.cancel} disabled={busy} onClick={onCancel} type="button">Cancel</button><button className={styles.save} disabled={busy || !name.trim()} type="submit">{busy ? "Rendering…" : "Export MP4"}</button></footer></form></section>;
}
