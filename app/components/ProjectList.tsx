import type { AmplifierProject } from "../types/workspace";
import { AmplifierBrand } from "./AmplifierBrand";
import { ProjectCard } from "./ProjectCard";
import styles from "./ProjectList.module.css";

export function ProjectList({ projects, onDelete, onOpen }: { projects: AmplifierProject[]; onDelete: (id: string) => void; onOpen: (id: string) => void }) {
  return <section className={styles.projects} aria-label="Projects">{projects.length ? <nav aria-label="Projects">{projects.map((project) => <ProjectCard key={project.id} onDelete={onDelete} onOpen={onOpen} project={project} />)}</nav> : <section className={styles.empty}><AmplifierBrand size="hero" /><h1>Access and possibility</h1><p>Optimizing media for the full range of human needs and abilities.</p></section>}</section>;
}
