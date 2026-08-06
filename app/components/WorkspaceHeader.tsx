import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Plus } from "lucide-react";
import { AmplifierBrand } from "./AmplifierBrand";
import { FolderIcon } from "./icons/FolderIcon";
import styles from "./WorkspaceHeader.module.css";

type WorkspaceHeaderProps = {
  projectOpen: boolean;
  assetsOpen: boolean;
  creatorOpen: boolean;
  onHome: () => void;
  onNewProject: () => void;
  onToggleAssets: () => void;
  onToggleCreator: () => void;
};

export function WorkspaceHeader({ assetsOpen, creatorOpen, projectOpen, onHome, onNewProject, onToggleAssets, onToggleCreator }: WorkspaceHeaderProps) {
  return (
    <header className={styles.header} data-workspace={projectOpen}>
      <nav aria-label="Project navigation">
        {projectOpen && <><button aria-label="Projects" className={styles.projectButton} onClick={onHome} type="button"><FolderIcon size="topbar" /></button><button aria-pressed={assetsOpen} onClick={onToggleAssets} type="button">{assetsOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}Assets</button></>}
      </nav>
      <AmplifierBrand />
      <nav className={styles.actions} aria-label="Workspace actions">
        {projectOpen ? <button aria-pressed={creatorOpen} onClick={onToggleCreator} type="button">{creatorOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}Creator</button> : <button onClick={onNewProject} type="button"><Plus size={15} />New project</button>}
      </nav>
    </header>
  );
}
