import Link from "next/link";
import { ArrowRight, FolderOpen, Pencil, Trash2 } from "lucide-react";
import type { Project } from "@/types/projects";

export function ProjectCard({ project, onEdit, onDelete, busy }: {
  project: Project; onEdit: () => void; onDelete: () => void; busy: boolean;
}) {
  return <article className="panel project-card"><div className="project-symbol"><FolderOpen size={25} /></div><h2>{project.name}</h2><p className="muted">{project.description || "A new construction, ready for your instructions."}</p><span className="tag">{project.step_count} {project.step_count === 1 ? "STEP" : "STEPS"}</span>
    <div className="card-actions"><Link className="button primary" href={`/projects/${project.id}`}>Open project <ArrowRight size={14} /></Link><button className="icon-button" disabled={busy} onClick={onEdit} aria-label={`Edit ${project.name}`}><Pencil size={16} /></button><button className="icon-button danger" disabled={busy} onClick={onDelete} aria-label={`Delete ${project.name}`}><Trash2 size={16} /></button></div>
  </article>;
}
