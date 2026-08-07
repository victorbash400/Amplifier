import { GitBranch, MessageCircleMore, SquarePen, X } from "lucide-react";
import type { CreatorAgentId } from "./creatorAgentTypes";
import { creatorAgentName } from "./creatorAgentTypes";
import styles from "./CreatorAgentChoice.module.css";

type CreatorAgentChoiceProps = {
  agentId: CreatorAgentId;
  disabled: boolean;
  onBranch: () => void;
  onCancel: () => void;
  onContinue: () => void;
  onNewChat: () => void;
};

export function CreatorAgentChoice({ agentId, disabled, onBranch, onCancel, onContinue, onNewChat }: CreatorAgentChoiceProps) {
  return (
    <section aria-label={`Open ${creatorAgentName(agentId)}`} className={styles.choice}>
      <p>{creatorAgentName(agentId)}</p>
      <button aria-label="Cancel agent switch" className={styles.close} disabled={disabled} onClick={onCancel} type="button">
        <X aria-hidden="true" />
      </button>
      <button disabled={disabled} onClick={onContinue} type="button">
        <MessageCircleMore aria-hidden="true" />
        <span>Continue in this chat</span>
      </button>
      <button disabled={disabled} onClick={onBranch} type="button">
        <GitBranch aria-hidden="true" />
        <span>Branch in new chat</span>
      </button>
      <button disabled={disabled} onClick={onNewChat} type="button">
        <SquarePen aria-hidden="true" />
        <span>Start new chat</span>
      </button>
    </section>
  );
}
