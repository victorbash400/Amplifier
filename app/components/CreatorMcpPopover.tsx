"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { loadMcpStatus, type McpStatus } from "../lib/mcp";
import styles from "./CreatorMcpPopover.module.css";

const toolDescriptions: Record<string, string> = {
  clickhouse_read_project_silence_ranges: "Quiet ranges for narration placement",
  clickhouse_read_project_speaker_turns: "Timed speakers and dialogue changes",
  clickhouse_read_project_transcript: "Indexed dialogue with source timing",
  clickhouse_search_project_moments: "Hybrid search across indexed media",
};

export function CreatorMcpPopover({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<McpStatus>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    void loadMcpStatus().then((result) => { if (active) setStatus(result); }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Could not read MCP status"); });
    return () => { active = false; window.removeEventListener("keydown", close); };
  }, [onClose]);

  return <section aria-label="MCP connections" className={styles.popover}>
    <header><span><strong>ClickHouse MCP</strong><small>{status?.status || "Checking connection"}</small></span><button aria-label="Close MCP connections" onClick={onClose} type="button"><X size={14} /></button></header>
    {error || status?.error ? <p className={styles.error}>{error || status?.error}</p> : status?.tools?.length ? <><p className={styles.label}>Available tools</p><ul>{status.tools.map((tool) => <li key={tool}><strong>{friendlyName(tool)}</strong><small>{toolDescriptions[tool] || "Project-scoped ClickHouse evidence"}</small></li>)}</ul></> : null}
  </section>;
}

function friendlyName(value: string) {
  return value.replace(/^clickhouse_/, "").split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}
