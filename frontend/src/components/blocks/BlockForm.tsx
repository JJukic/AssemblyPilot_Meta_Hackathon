"use client";
import { useState } from "react";
import type { BlockInput, BuildingBlock } from "@/types/blocks";
import { errorMessage } from "@/lib/api";

export function BlockForm({ block, onSave, onCancel }: {
  block?: BuildingBlock; onSave: (data: BlockInput) => Promise<void>; onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    const optionalNumber = (name: string) => text(name) === "" ? null : Number(text(name));
    if (!text("name")) { setError("Name cannot be empty."); return; }
    setBusy(true); setError(null);
    try {
      await onSave({ name: text("name"), description: text("description") || null,
        color: text("color"), category: text("category"), shape: text("shape"),
        studs_x: optionalNumber("studs_x"), studs_y: optionalNumber("studs_y"),
        height_mm: optionalNumber("height_mm"), default_quantity: Number(text("default_quantity")) });
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="editor-form" aria-label="Block details">
    <fieldset disabled={busy}>
      <label className="field"><span>Name *</span><input name="name" required maxLength={160} defaultValue={block?.name} placeholder="Blue 2×4 brick" /></label>
      <label className="field"><span>Description</span><textarea name="description" rows={2} maxLength={4000} defaultValue={block?.description ?? ""} placeholder="Notes that help identify this block" /></label>
      <div className="form-grid">
        <label className="field"><span>Color *</span><input name="color" required maxLength={80} defaultValue={block?.color ?? "blue"} /></label>
        <label className="field"><span>Category *</span><input name="category" required maxLength={80} defaultValue={block?.category ?? "brick"} list="block-categories" /></label>
        <datalist id="block-categories"><option value="brick" /><option value="plate" /><option value="tile" /><option value="slope" /><option value="custom" /></datalist>
        <label className="field"><span>Shape *</span><input name="shape" required maxLength={80} defaultValue={block?.shape ?? "rectangular"} /></label>
        <label className="field"><span>Default quantity *</span><input name="default_quantity" type="number" required min={1} max={100000} step={1} defaultValue={block?.default_quantity ?? 1} /></label>
        <label className="field"><span>Studs X</span><input name="studs_x" type="number" min={0} max={1000} step={1} defaultValue={block?.studs_x ?? ""} /></label>
        <label className="field"><span>Studs Y</span><input name="studs_y" type="number" min={0} max={1000} step={1} defaultValue={block?.studs_y ?? ""} /></label>
        <label className="field"><span>Height (mm)</span><input name="height_mm" type="number" min={0} max={100000} step="any" defaultValue={block?.height_mm ?? ""} /></label>
      </div>
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="form-actions"><button className="button secondary" type="button" onClick={onCancel}>Close editor</button><button className="button primary" type="submit">{busy ? "Saving…" : "Save block"}</button></div>
    </fieldset>
    {!block && <p className="muted">Save the block, then add reference photographs here.</p>}
  </form>;
}
