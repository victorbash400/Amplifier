"use client";

import styles from "./TimelineAgentScan.module.css";

export function TimelineAgentScan({ active }: { active: boolean }) {
  if (!active) return null;
  return <i aria-hidden="true" className={styles.scan} />;
}
