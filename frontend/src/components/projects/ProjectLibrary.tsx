"use client";
import Link from "next/link";
import { useState } from "react";
import { FolderPlus, Plus } from "lucide-react";
import { useResource } from "@/hooks/useResource";
import { registry } from "@/lib/registry";
import { errorMessage } from "@/lib/api";
import { ProjectCard } from "./ProjectCard";
import { ProjectForm } from "./ProjectForm";

export function ProjectLibrary() {
  const { data, error, reload } = useResource(registry.projects);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  async function remove(id: string, name: string) {
    if (!window.confirm(`Delete “${name}”, all its steps and step photos? Reusable blocks will be kept.`)) return;
    setBusy(true); setActionError(null);
    try { await registry.deleteProject(id); if (editing === id) setEditing(null); reload(); setNotice("Project deleted. Reusable blocks were kept."); }
    catch (cause) { setActionError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  return <>
    <div className="collection-toolbar"><p className="muted">{data ? `${data.length} projects in your workspace` : "Loading projects…"}</p><Link className="button primary" href="/setup"><Plus size={16} /> New project</Link></div>
    {(error || actionError) && <p role="alert" className="form-error">{actionError || error} <button className="text-button" onClick={reload}>Retry loading</button></p>}
    {notice && <p role="status" className="success-note">{notice}</p>}
    <div className={`collection-layout ${editing ? "has-editor" : ""}`}>
      <div>{data?.length === 0 && <div className="empty-state"><FolderPlus size={32} /><h2>Make room for your next build</h2><p>Create a project, add construction steps, then select reusable blocks from your library.</p></div>}
        <div className="project-grid">{data?.map((project) => <ProjectCard key={project.id} project={project} busy={busy} onEdit={() => setEditing(project.id)} onDelete={() => void remove(project.id, project.name)} />)}</div>
      </div>
      {editing && <aside className="panel editor-panel"><div className="panel-heading"><h2>{editing === "new" ? "Create a project" : "Edit project"}</h2></div><ProjectForm key={editing} project={data?.find((p) => p.id === editing)} onCancel={() => setEditing(null)} onSave={async (input) => { await registry.saveProject(input, editing === "new" ? undefined : editing); reload(); setEditing(null); setNotice("Project saved."); }} /></aside>}
    </div>
  </>;
}
