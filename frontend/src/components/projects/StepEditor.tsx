"use client";
import Link from "next/link";
import { useState } from "react";
import type { BuildingBlock } from "@/types/blocks";
import type { ProjectStep, StepInput } from "@/types/projects";
import { errorMessage } from "@/lib/api";

export function StepEditor({ step, blocks, onSave, onCancel }: {
  step?: ProjectStep; blocks: BuildingBlock[]; onSave: (data: StepInput) => Promise<void>; onCancel: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(step?.required_blocks.map((item) => item.block_id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const instruction = String(form.get("instruction") ?? "").trim();
    if (!title || !instruction) { setError("Title and instruction cannot be empty."); return; }
    setBusy(true); setError(null);
    try {
      await onSave({ title, instruction, required_blocks: [...selected].map((id) => ({
        block_id: id, required_quantity: Number(form.get(`quantity-${id}`)),
      })) });
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  return <form className="editor-form" onSubmit={submit} aria-label="Step details"><fieldset disabled={busy}>
    <label className="field"><span>Step title *</span><input name="title" required maxLength={160} defaultValue={step?.title} placeholder="Build the base" /></label>
    <label className="field"><span>Instruction *</span><textarea name="instruction" required maxLength={10000} rows={4} defaultValue={step?.instruction} placeholder="Describe how to place and connect these blocks." /></label>
    <h3 className="form-subtitle">Required blocks</h3><p className="muted">Choose the blocks added in this step and their quantities.</p>
    {!blocks.length && <p className="empty-caption">No registered blocks yet. <Link href="/blocks">Add blocks to your library</Link> or save this step without assignments.</p>}
    <div className="block-assignment-list">{blocks.map((block) => <div key={block.id} className="block-assignment">
      <label><input type="checkbox" checked={selected.has(block.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(block.id); else next.delete(block.id); return next; })} /><span>{block.name}<small>{block.color} · {block.category}</small></span></label>
      <input name={`quantity-${block.id}`} type="number" aria-label={`Quantity for ${block.name}`} disabled={!selected.has(block.id)} required={selected.has(block.id)} min={1} max={100000} step={1} defaultValue={step?.required_blocks.find((item) => item.block_id === block.id)?.required_quantity ?? block.default_quantity} />
    </div>)}</div>
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="form-actions"><button type="button" className="button secondary" onClick={onCancel}>Close editor</button><button type="submit" className="button primary">{busy ? "Saving…" : "Save step"}</button></div>
    {!step && <p className="muted">Save the step, then upload a photograph of the correct construction.</p>}
  </fieldset></form>;
}
