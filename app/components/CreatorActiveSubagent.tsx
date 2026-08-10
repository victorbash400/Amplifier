import Image from "next/image";
import { ArrowRight } from "lucide-react";
import type { CreatorSpecialistAgentId } from "./creatorAgentTypes";
import styles from "./CreatorActiveSubagent.module.css";

const specialistIcons: Record<CreatorSpecialistAgentId, string[]> = {
  vision: ["/accessible-media-icons/blind-eyes-svgrepo-com.svg"],
  hearing: ["/accessible-media-icons/deaf-solid-svgrepo-com.svg"],
  deafblind: ["/accessible-media-icons/blind-eyes-svgrepo-com.svg", "/accessible-media-icons/deaf-solid-svgrepo-com.svg"],
  sensory: ["/accessible-media-icons/brain-svgrepo-com.svg"],
  language: ["/accessible-media-icons/language-svgrepo-com.svg"],
};

type CreatorActiveSubagentProps = {
  agentId?: CreatorSpecialistAgentId;
};

export function CreatorActiveSubagent({ agentId }: CreatorActiveSubagentProps) {
  if (!agentId) return null;
  const name = agentId === "deafblind" ? "Deafblind" : `${agentId[0].toUpperCase()}${agentId.slice(1)}`;
  return (
    <span className={styles.indicator} role="status" aria-label={`${name} Agent active`}>
      <ArrowRight aria-hidden="true" size={12} />
      <span className={styles.icons} aria-hidden="true">
        {specialistIcons[agentId].map((icon) => <Image alt="" height={13} key={icon} src={icon} width={13} />)}
      </span>
      {name}
    </span>
  );
}
