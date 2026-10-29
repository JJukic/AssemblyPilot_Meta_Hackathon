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
  const existing = step?.spatial_constraint;
  const [geometryEnabled, setGeometryEnabled] = useState(!!existing);
  const [targetId, setTargetId] = useState(existing?.target_block_id ?? "");
  const [referenceId, setReferenceId] = useState(existing?.reference_block_id ?? "");
  const [direction, setDirection] = useState<"board_positive_x" | "board_positive_y">(existing?.positive_direction ?? "board_positive_x");
  const [expectedOffset, setExpectedOffset] = useState(String(existing?.expected_stud_offset ?? 0));
  const [tolerance, setTolerance] = useState(String(existing?.tolerance_studs ?? 0.15));
  const [referenceHeight, setReferenceHeight] = useState(String(existing?.reference_surface_height_mm ?? ""));
  const [targetHeight, setTargetHeight] = useState(String(existing?.target_surface_height_mm ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const instruction = String(form.get("instruction") ?? "").trim();
    if (!title || !instruction) { setError("Title and instruction cannot be empty."); return; }
    const assignments = [...selected].map((id) => ({
      block_id: id, required_quantity: Number(form.get(`quantity-${id}`)),
    }));
    let spatialConstraint: StepInput["spatial_constraint"] = null;
    if (geometryEnabled) {
      const target = blocks.find((item) => item.id === targetId);
      const reference = blocks.find((item) => item.id === referenceId);
      const values = [Number(expectedOffset), Number(tolerance), Number(referenceHeight), Number(targetHeight)];
      if (!target || !reference || target.id === reference.id || values.some((value) => !Number.isFinite(value))) {
        setError("Choose two different assigned blocks and enter finite geometry values."); return;
      }
      if (assignments.some((item) => [targetId, referenceId].includes(item.block_id) && item.required_quantity !== 1)) {
        setError("Geometric target and reference quantities must both be 1."); return;
      }
      spatialConstraint = {
        target_block_id: targetId, reference_block_id: referenceId,
        constraint_type: "relative_stud_offset" as const, axis: "longitudinal" as const,
        positive_direction: direction, expected_stud_offset: values[0], tolerance_studs: values[1],
        reference_surface_height_mm: values[2], target_surface_height_mm: values[3],
      };
    }
    setBusy(true); setError(null);
    try {
      await onSave({ title, instruction, required_blocks: assignments, spatial_constraint: spatialConstraint });
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
    <section className="geometry-editor" aria-labelledby="geometry-editor-heading">
      <h3 id="geometry-editor-heading" className="form-subtitle">Geometric constraint</h3>
      <label className="calibration-confirm"><input type="checkbox" checked={geometryEnabled} onChange={(event) => setGeometryEnabled(event.target.checked)} /> Enable a stud-offset check for this step</label>
      {geometryEnabled && <>
        <p className="muted">First supported mode: two assigned, color-distinct rectangular 2×4 blocks, quantity 1, with known 9.6 mm-style heights. The signed longitudinal axis points toward the selected board direction.</p>
        <div className="form-grid">
          <label className="field"><span>Reference block *</span><select required value={referenceId} onChange={(event) => { const id = event.target.value; setReferenceId(id); const block = blocks.find((item) => item.id === id); if (block?.height_mm) { setReferenceHeight(String(block.height_mm)); const target = blocks.find((item) => item.id === targetId); if (target?.height_mm) setTargetHeight(String(block.height_mm + target.height_mm)); } }}><option value="">Choose assigned block</option>{blocks.filter((block) => selected.has(block.id)).map((block) => <option key={block.id} value={block.id}>{block.name} · {block.color}</option>)}</select></label>
          <label className="field"><span>Target block *</span><select required value={targetId} onChange={(event) => { const id = event.target.value; setTargetId(id); const block = blocks.find((item) => item.id === id); const reference = blocks.find((item) => item.id === referenceId); if (block?.height_mm && reference?.height_mm) setTargetHeight(String(reference.height_mm + block.height_mm)); }}><option value="">Choose assigned block</option>{blocks.filter((block) => selected.has(block.id)).map((block) => <option key={block.id} value={block.id}>{block.name} · {block.color}</option>)}</select></label>
          <label className="field"><span>Positive longitudinal direction *</span><select value={direction} onChange={(event) => setDirection(event.target.value as typeof direction)}><option value="board_positive_x">Board +X</option><option value="board_positive_y">Board +Y</option></select></label>
          <label className="field"><span>Expected signed offset (studs) *</span><input type="number" min={-32} max={32} step="any" value={expectedOffset} onChange={(event) => setExpectedOffset(event.target.value)} /></label>
          <label className="field"><span>Tolerance (studs) *</span><input type="number" min={0.01} max={0.5} step="any" value={tolerance} onChange={(event) => setTolerance(event.target.value)} /></label>
          <label className="field"><span>Reference stud-surface Z (mm) *</span><input type="number" min={0.01} max={200} step="any" value={referenceHeight} onChange={(event) => setReferenceHeight(event.target.value)} /></label>
          <label className="field"><span>Target stud-surface Z (mm) *</span><input type="number" min={0.01} max={200} step="any" value={targetHeight} onChange={(event) => setTargetHeight(event.target.value)} /></label>
        </div>
      </>}
    </section>
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="form-actions"><button type="button" className="button secondary" onClick={onCancel}>Close editor</button><button type="submit" className="button primary">{busy ? "Saving…" : "Save step"}</button></div>
    {!step && <p className="muted">Save the step, then upload a photograph of the correct construction.</p>}
  </fieldset></form>;
}
