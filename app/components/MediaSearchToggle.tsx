import Image from "next/image";
import styles from "./MediaSearchToggle.module.css";

export function MediaSearchToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return <button aria-label={active ? "Return to file search" : "Search inside media"} aria-pressed={active} className={styles.toggle} onClick={onToggle} title={active ? "File search" : "Search inside media"} type="button"><Image alt="" height={17} src="/accessible-media-icons/search-document-svgrepo-com.svg" width={17} /></button>;
}
