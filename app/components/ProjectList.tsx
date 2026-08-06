import type { AmplifierProject } from "../types/workspace";
import { ProjectCard } from "./ProjectCard";
import styles from "./ProjectList.module.css";

export function ProjectList({ projects, onDelete, onOpen }: { projects: AmplifierProject[]; onDelete: (id: string) => void; onOpen: (id: string) => void }) {
  return <section className={styles.projects} aria-label="Projects">{projects.length ? <nav aria-label="Projects">{projects.map((project) => <ProjectCard key={project.id} onDelete={onDelete} onOpen={onOpen} project={project} />)}</nav> : null}</section>;
}
