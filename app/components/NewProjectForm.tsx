"use client";

import { FormEvent, useState } from "react";
import styles from "./NewProjectForm.module.css";

export function NewProjectForm({ onCancel, onCreate }: { onCancel: () => void; onCreate: (name: string) => void }) {
  const [name, setName] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const projectName = name.trim();
    if (projectName) onCreate(projectName);
  }

  return <form className={styles.form} onSubmit={submit}><label htmlFor="project-name">Project name</label><input autoFocus id="project-name" onChange={(event) => setName(event.target.value)} value={name} /><footer><button onClick={onCancel} type="button">Cancel</button><button disabled={!name.trim()} type="submit">Create project</button></footer></form>;
}
