import styles from "./CreatorChatDeleteDialog.module.css";

type CreatorChatDeleteDialogProps = {
  busy: boolean;
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function CreatorChatDeleteDialog({ busy, name, onCancel, onConfirm }: CreatorChatDeleteDialogProps) {
  return <section aria-labelledby="delete-chat-title" aria-modal="true" className={styles.backdrop} role="dialog"><section className={styles.dialog}><h2 id="delete-chat-title">Delete chat?</h2><p><strong>{name}</strong> and its agent history will be permanently removed.</p><footer><button disabled={busy} onClick={onCancel} type="button">Cancel</button><button className={styles.delete} disabled={busy} onClick={onConfirm} type="button">{busy ? "Deleting…" : "Delete"}</button></footer></section></section>;
}
