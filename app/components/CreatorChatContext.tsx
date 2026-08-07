import styles from "./CreatorChatInput.module.css";

export function CreatorChatContext({ agentName, contextNames }: { agentName: string; contextNames: string[] }) {
  return (
    <header className={styles.context}>
      <strong>{agentName}</strong>
      {contextNames.length ? (
        <>
          <span>Attached</span>
          {contextNames.map((name) => <span key={name}>{name}</span>)}
        </>
      ) : null}
    </header>
  );
}
