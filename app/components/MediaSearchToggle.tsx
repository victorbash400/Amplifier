import Image from "next/image";
import styles from "./MediaSearchToggle.module.css";

export function MediaSearchToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return <button aria-label={active ? "Return to file search" : "Open Moment Search"} aria-pressed={active} className={styles.toggle} onClick={onToggle} title={active ? "File search" : "Moment Search"} type="button"><Image alt="" height={17} src="/accessible-media-icons/data-svgrepo-com.svg" width={17} /></button>;
}
