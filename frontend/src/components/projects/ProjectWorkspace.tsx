"use client";
import Link from "next/link";
import { useCallback, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Camera, Layers3, Pencil, Plus, Trash2 } from "lucide-react";
import { useResource } from "@/hooks/useResource";
import { registry } from "@/lib/registry";
import { errorMessage } from "@/lib/api";
import { ImageManager } from "@/components/ui/ImageManager";
import { StepEditor } from "./StepEditor";
import { ProjectForm } from "./ProjectForm";

export function ProjectWorkspace({ projectId }: { projectId: string }) {
  const loadProject = useCallback(() => registry.project(projectId), [projectId]);
  const project = useResource(loadProject);
  const blocks = useResource(registry.blocks);
  const [editing, setEditing] = useState<string | null>(null);
  const [editProject, setEditProject] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const selected = project.data?.steps.find((step) => step.id === editing);
  async function move(id: string, offset: number) {
    if (!project.data) return;
    const ids = project.data.steps.map((step) => step.id);
    const index = ids.indexOf(id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setBusy(true); setError(null);
    try { await registry.reorderSteps(projectId, ids); project.reload(); setNotice("Step order saved."); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  async function remove(id: string, title: string) {
    if (!window.confirm(`Delete step “${title}” and its reference photos? Registered blocks will be kept.`)) return;
    setBusy(true); setError(null);
    try { await registry.deleteStep(projectId, id); if (editing === id) setEditing(null); project.reload(); setNotice("Step deleted."); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  if (!project.data) return <div className="empty-state">{project.error ? <p role="alert">{project.error}</p> : <p role="status">Loading project…</p>}<button className="button secondary" onClick={project.reload}>Retry</button><Link href="/projects">Back to projects</Link></div>;
  return <>
    <div className="collection-toolbar"><Link className="text-button" href="/projects"><ArrowLeft size={14} /> All projects</Link><Link className="button primary" href={`/?project=${projectId}`}><Camera size={16} /> Open in workspace</Link></div>
    <section className="panel project-summary"><div><p className="eyebrow">YOUR CONSTRUCTION</p><h2>{project.data.name}</h2><p className="muted">{project.data.description || "Add instructions to turn your idea into a repeatable build."}</p></div><button className="button secondary" onClick={() => setEditProject(!editProject)}><Pencil size={14} /> Edit project details</button></section>
    {editProject && <section className="panel standalone-form"><ProjectForm project={project.data} onCancel={() => setEditProject(false)} onSave={async (input) => { await registry.saveProject(input, projectId); project.reload(); setEditProject(false); setNotice("Project saved."); }} /></section>}
    <div className="collection-toolbar"><h2>{project.data.steps.length} construction steps</h2><button className="button primary" onClick={() => { setEditing("new"); setNotice(null); }}><Plus size={16} /> Add step</button></div>
    {(error || project.error || blocks.error) && <p role="alert" className="form-error">{error || project.error || blocks.error} <button className="text-button" onClick={() => { project.reload(); blocks.reload(); }}>Reload data</button></p>}
    {notice && <p className="success-note" role="status">{notice}</p>}
    <div className={`collection-layout ${editing ? "has-editor" : ""}`}><div className="step-list">
      {!project.data.steps.length && <div className="empty-state"><Layers3 size={32} /><h2>Every build starts with a first step</h2><p>Add instructions, choose your registered blocks and upload a correct reference photograph.</p></div>}
      {project.data.steps.map((step, index) => <article key={step.id} className="panel step-card" aria-label={`Step ${step.position}: ${step.title}`}>
        <div className="step-card-heading"><span className="step-number">{String(step.position).padStart(2, "0")}</span><h3>{step.title}</h3><div className="step-order-buttons"><button className="icon-button" disabled={busy || index === 0} onClick={() => void move(step.id, -1)} aria-label={`Move ${step.title} up`}><ArrowUp size={16} /></button><button className="icon-button" disabled={busy || index === project.data!.steps.length - 1} onClick={() => void move(step.id, 1)} aria-label={`Move ${step.title} down`}><ArrowDown size={16} /></button></div></div>
        <p className="step-instruction">{step.instruction}</p><div className="required-chips">{step.required_blocks.map((item) => <span className="tag" key={item.block_id}>{item.required_quantity} × {item.block.name}</span>)}{!step.required_blocks.length && <span className="muted">No blocks assigned.</span>}</div>
        <div className="card-actions"><span className="muted">{step.reference_images.length} reference photos</span><button className="button secondary" disabled={busy} onClick={() => setEditing(step.id)} aria-label={`Edit step ${step.title}`}><Pencil size={14} /> Edit step</button><button className="icon-button danger" disabled={busy} onClick={() => void remove(step.id, step.title)} aria-label={`Delete step ${step.title}`}><Trash2 size={16} /></button></div>
      </article>)}
    </div>
    {editing && <aside className="panel editor-panel"><div className="panel-heading"><h2>{editing === "new" ? "New construction step" : "Edit construction step"}</h2></div>
      {(editing === "new" || selected) && blocks.data ? <>
        <StepEditor key={editing} step={selected} blocks={blocks.data} onCancel={() => setEditing(null)} onSave={async (input) => { const saved = await registry.saveStep(projectId, input, selected?.id); project.reload(); setEditing(saved.id); setNotice("Step saved. Manage reference photographs below."); }} />
        {selected && <ImageManager key={`images:${selected.id}`} images={selected.reference_images}
          endpoint={`/api/projects/${projectId}/steps/${selected.id}/images`} onChange={project.reload}
          onSelect={(image) => registry.selectStepReference(projectId, selected.id, image.id)} />}
      </> : <p className="empty-state">{blocks.error || "Loading editor…"}</p>}
    </aside>}
    </div>
  </>;
}
