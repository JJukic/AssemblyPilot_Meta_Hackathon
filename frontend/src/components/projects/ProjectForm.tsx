"use client";
import { useState } from "react";
import type { Project, ProjectInput } from "@/types/projects";
import { errorMessage } from "@/lib/api";

export function ProjectForm({ project, onSave, onCancel }: {
  project?: Project; onSave: (input: ProjectInput) => Promise<void>; onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    if (!name) { setError("Project name cannot be empty."); return; }
    setBusy(true); setError(null);
    try { await onSave({ name, description: String(data.get("description") ?? "").trim() || null }); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  return <form className="editor-form" onSubmit={submit} aria-label="Project details"><fieldset disabled={busy}>
    <label className="field"><span>Project name *</span><input name="name" required maxLength={160} defaultValue={project?.name} placeholder="My first bridge" /></label>
    <label className="field"><span>Description</span><textarea name="description" rows={3} maxLength={4000} defaultValue={project?.description ?? ""} placeholder="What are you building?" /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="form-actions"><button className="button secondary" type="button" onClick={onCancel}>Cancel</button><button className="button primary" type="submit">{busy ? "Saving…" : "Save project"}</button></div>
  </fieldset></form>;
}
