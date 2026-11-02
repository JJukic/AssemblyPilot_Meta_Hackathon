"use client";
import { useEffect, useMemo, useState } from "react";
import { errorMessage } from "@/lib/api";
import { getPlacements, getScene, savePlacements, validPlacement, type Placement } from "@/lib/ar/data";
import {
  blockLabel, duplicateBlock, nextFreeInstance, proxyBlock, stackHelp, validateHologram,
  type RequiredBlock,
} from "@/lib/ar/hologram";
import { HologramPreview } from "@/components/ar/HologramPreview";
import type { ProjectStep } from "@/types/projects";

/**
 * Step hologram editor: every block placed IN this step (several allowed).
 * Earlier steps' blocks are shown grey for context and stacking only.
 * Position Y is the bottom face of the block body (metres above the
 * confirmed tabletop origin). Guidance only — never inspection evidence.
 */
export function PlacementEditor({ projectId, step }: { projectId: string; step: ProjectStep }) {
  const [loadedStep, setLoadedStep] = useState("");
  const [blocks, setBlocks] = useState<Placement[]>([]);
  // Earlier steps' blocks with an unambiguous label (their names belong to other steps).
  const [earlier, setEarlier] = useState<{ label: string; placement: Placement }[]>([]);
  const [selected, setSelected] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState("");
  const required: RequiredBlock[] = useMemo(
    () => step.required_blocks.map((b) => ({ block_id: b.block_id, required_quantity: b.required_quantity, name: b.block.name, color: b.block.color })),
    [step.required_blocks],
  );
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const own = await getPlacements(projectId, step.id);
        // Earlier steps for context; an invalid current hologram must not hide that.
        const scene = await getScene(projectId, step.id).catch(() => null);
        if (!active) return;
        setBlocks(own.placements);
        setEarlier((scene?.blocks ?? [])
          .filter((b) => b.step_id !== step.id && validPlacement(b.placement))
          .map((b) => ({ label: `step ${b.step_position} block #${b.placement.instance}`, placement: b.placement })));
        setSelected(0);
        setConfirmed(false);
      } catch (e) {
        if (active) setStatus(errorMessage(e));
      } finally {
        if (active) setLoadedStep(step.id);
      }
    })();
    return () => {
      active = false;
    };
  }, [projectId, step.id]);

  const value = blocks[selected] ?? null;
  const errors = validateHologram(blocks, required);
  const labels = blocks.map((p, i) => `${i + 1} · ${blockLabel(p, required)}`);
  const help = value
    ? stackHelp(value, [
        ...earlier,
        ...blocks.map((p, i) => ({ label: labels[i], placement: p })),
      ])
    : null;

  function edit(next: Placement[], keepSelection = selected) {
    setBlocks(next);
    setSelected(Math.max(0, Math.min(keepSelection, next.length - 1)));
    setConfirmed(false);
  }
  function change(update: Partial<Placement>) {
    if (!value) return;
    edit(blocks.map((p, i) => (i === selected ? { ...p, ...update } : p)));
  }
  function add() {
    const slot = nextFreeInstance(required, blocks);
    if (!slot) return setStatus("Every required block instance of this step already has a hologram block.");
    edit([...blocks, proxyBlock(slot)], blocks.length);
    setStatus("Added an approximate 10 cm proxy — enter measured values before relying on it.");
  }
  function duplicate() {
    if (!value) return;
    const copy = duplicateBlock(value, required, blocks);
    if (!copy) return setStatus("No free block instance left in this step to duplicate into.");
    edit([...blocks, copy], blocks.length);
    setStatus(`Duplicated block ${selected + 1} beside it at the same height. Check its position.`);
  }
  function remove() {
    if (!value) return;
    edit(blocks.filter((_, i) => i !== selected), selected - 1);
  }
  async function save(next: Placement[], message: string) {
    try {
      const saved = await savePlacements(projectId, step.id, next);
      setBlocks(saved.placements);
      setSelected((s) => Math.max(0, Math.min(s, saved.placements.length - 1)));
      setConfirmed(false);
      setStatus(message);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }
  const instances = value ? required.find((r) => r.block_id === value.target_block_id)?.required_quantity ?? 1 : 1;

  return (
    <details className="panel ar-editor">
      <summary>Spatial AR hologram (optional)</summary>
      <p>
        Metres relative to a manually confirmed HoloLens tabletop origin: X right, Y up, Z toward you.
        <strong> Position Y is the bottom face of the block</strong> (0 = on the tabletop). A block resting on
        another one has its bottom at that block&apos;s body top (bottom Y + body height; studs are not counted).
        Add every block placed in this step; earlier steps appear grey for context. No camera calibration is reused,
        and the hologram never verifies a step.
      </p>
      {loadedStep !== step.id ? (
        <p>Loading hologram…</p>
      ) : !blocks.length ? (
        <button className="button secondary" disabled={!step.required_blocks.length} onClick={add}>
          Author placement with a 10 cm proxy
        </button>
      ) : (
        <>
          <div className="hologram-blocks" role="radiogroup" aria-label="Hologram blocks">
            {blocks.map((p, i) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={i === selected}
                className={`button ${i === selected ? "primary" : "secondary"} hologram-block`}
                onClick={() => setSelected(i)}
              >
                {labels[i]} · {p.evidence} · bottom Y {(p.position_m[1] * 1000).toFixed(1)} mm
              </button>
            ))}
          </div>
          <div className="form-actions">
            <button className="button secondary" onClick={add} disabled={!nextFreeInstance(required, blocks)}>Add block</button>
            <button className="button secondary" onClick={duplicate} disabled={!value}>Duplicate block {selected + 1}</button>
            <button className="button danger" onClick={remove} disabled={!value}>Remove block {selected + 1}</button>
          </div>
          {value && (
            <fieldset className="hologram-fields">
              <legend>Block {selected + 1} — {blockLabel(value, required)}</legend>
              <div className="form-grid">
                <label className="field">
                  AR target
                  <select value={value.target_block_id} onChange={(e) => change({ target_block_id: e.target.value, instance: 1, studs: null })}>
                    {step.required_blocks.map((b) => (
                      <option key={b.block_id} value={b.block_id}>{b.block.name} · {b.block.color}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Instance number
                  <input type="number" min={1} max={instances} value={value.instance} onChange={(e) => change({ instance: Number(e.target.value) })} />
                </label>
                <label className="field">
                  Dimension evidence
                  <select value={value.evidence} onChange={(e) => change({ evidence: e.target.value as Placement["evidence"], studs: null })}>
                    <option value="approximate">Approximate alignment proxy — not measured</option>
                    <option value="measured">I measured this rectangular block</option>
                  </select>
                </label>
              </div>
              <div className="form-grid">
                {(["x_mm", "y_mm", "z_mm"] as const).map((axis, i) => (
                  <label className="field" key={axis}>
                    {["Length X (mm)", "Body height Y (mm, excluding studs)", "Depth Z (mm)"][i]}
                    <input type="number" min={0.1} max={1000} value={value.dimensions[axis]}
                      onChange={(e) => change({ dimensions: { ...value.dimensions, [axis]: Number(e.target.value) } })} />
                  </label>
                ))}
              </div>
              <div className="form-grid">
                {["X", "Y", "Z"].map((axis, i) => (
                  <label className="field" key={axis}>
                    {i === 1 ? "Position Y (m) — bottom face" : `Position ${axis} (m)`}
                    <input type="number" step={0.0001} min={i === 1 ? 0 : -2} max={2} value={value.position_m[i]}
                      onChange={(e) => change({ position_m: value.position_m.map((v, n) => (n === i ? Number(e.target.value) : v)) })} />
                  </label>
                ))}
                {["X", "Y", "Z"].map((axis, i) => (
                  <label className="field" key={axis}>
                    Rotation {axis} (degrees)
                    <input type="number" min={-180} max={180} value={value.rotation_deg[i]}
                      onChange={(e) => change({ rotation_deg: value.rotation_deg.map((v, n) => (n === i ? Number(e.target.value) : v)) })} />
                  </label>
                ))}
              </div>
              {help && (
                <section className={`height-help height-${help.status}`} aria-label="Height help">
                  <p role="status">{help.explanation}</p>
                  {help.suggestions.map((s) => (
                    <button key={s.label} className="button secondary" onClick={() => change({ position_m: [value.position_m[0], s.yM, value.position_m[2]] })}>
                      Set bottom Y to the top of {s.label} ({(s.yM * 1000).toFixed(1)} mm){s.fromApproximate ? " — from approximate dimensions" : ""}
                    </button>
                  ))}
                </section>
              )}
              <p>
                Stud geometry is optional. Enter measured stud spacing/diameter/height only after registering the grid in
                Block Library.
              </p>
              <label>
                <input type="checkbox" disabled={value.evidence !== "measured"} checked={!!value.studs}
                  onChange={(e) => change({ studs: e.target.checked ? { x: 1, z: 1, pitch_mm: 0, diameter_mm: 0, height_mm: 0 } : null })} />{" "}
                Add confirmed stud grid
              </label>
              {value.studs && (
                <div className="form-grid">
                  {(["x", "z", "pitch_mm", "diameter_mm", "height_mm"] as const).map((key) => (
                    <label className="field" key={key}>
                      Stud {key}
                      <input type="number" min={0.1} value={value.studs![key]}
                        onChange={(e) => change({ studs: { ...value.studs!, [key]: Number(e.target.value) } })} />
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
          )}
          <p>Click the top view to move the selected block (X/Z). Numbers match the block list.</p>
          <HologramPreview
            assembled={earlier.map((e) => e.placement)}
            current={blocks}
            selected={selected}
            onPickTop={(x, z) => value && change({ position_m: [x, value.position_m[1], z] })}
          />
          {errors.length > 0 && (
            <ul role="alert" aria-label="Hologram problems">
              {errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}
          <label className="field">
            <span>
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />{" "}
              I confirm the dimensions, evidence labels and intended placements of all blocks.
            </span>
          </label>
          <div className="form-actions">
            <button className="button primary" disabled={!confirmed || errors.length > 0}
              onClick={() => void save(blocks, "AR guidance saved. Existing verification must be refreshed; the hologram is not evidence.")}>
              Save AR hologram
            </button>
            <button className="button secondary" onClick={() => void save([], "Hologram removed for this step.")}>
              Remove AR hologram
            </button>
          </div>
        </>
      )}
      {status && <p role="status">{status}</p>}
    </details>
  );
}
