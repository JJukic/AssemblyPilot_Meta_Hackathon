/**
 * Cumulative step hologram helpers (pure, testable).
 *
 * Coordinates: metres relative to the deliberately confirmed tabletop origin,
 * X right, Y up, Z toward the user. Position Y is the BOTTOM face of the
 * block body; the body top is Y + body height (dimensions.y_mm, studs
 * excluded), which is where a block stacked on it sits. Rotations pivot
 * about the block's bottom-centre point.
 *
 * Guidance only: nothing here measures a real part, guesses a real height
 * or verifies a step. Height suggestions are derived exclusively from other
 * AUTHORED blocks and are applied only by an explicit author action.
 */
import { validPlacement, type Placement, type Scene } from "./data";

export interface HologramView {
  /** Blocks of earlier steps — already assembled, drawn dimmed/neutral. */
  assembled: Placement[];
  /** Blocks placed in the current step — highlighted, state-coloured. */
  current: Placement[];
}

export const EMPTY_HOLOGRAM: HologramView = { assembled: [], current: [] };

/** Split a cumulative scene; invalid entries are never drawn. */
export function splitScene(scene: Scene | null, currentStepId: string | null): HologramView {
  if (!scene || !currentStepId) return EMPTY_HOLOGRAM;
  const ok = (p: Placement) => validPlacement(p);
  return {
    assembled: scene.blocks.filter((b) => b.step_id !== currentStepId).map((b) => b.placement).filter(ok),
    current: scene.blocks.filter((b) => b.step_id === currentStepId).map((b) => b.placement).filter(ok),
  };
}

export interface RequiredBlock {
  block_id: string;
  required_quantity: number;
  name?: string;
  color?: string;
}

export function blockLabel(p: Placement, required: RequiredBlock[]): string {
  const r = required.find((b) => b.block_id === p.target_block_id);
  return `${r?.name ?? "Block"}${r?.color ? ` · ${r.color}` : ""} #${p.instance}`;
}

/** Author-side mirror of the backend rules (the backend stays authoritative). */
export function validateHologram(placements: Placement[], required: RequiredBlock[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  placements.forEach((p, i) => {
    const n = i + 1;
    if (!validPlacement(p)) errors.push(`Block ${n}: dimensions, position, rotation or stud values are invalid.`);
    const r = required.find((b) => b.block_id === p.target_block_id);
    if (!r) errors.push(`Block ${n}: its target block is not assigned to this step.`);
    else if (p.instance > r.required_quantity)
      errors.push(`Block ${n}: instance ${p.instance} exceeds the ${r.required_quantity} required in this step.`);
    const key = `${p.target_block_id}#${p.instance}`;
    if (seen.has(key)) errors.push(`Block ${n}: this block instance is already placed in this step.`);
    seen.add(key);
    if (Array.isArray(p.position_m) && p.position_m[1] < 0)
      errors.push(`Block ${n}: Position Y is the bottom face and cannot be below the tabletop.`);
  });
  return errors;
}

/** Next unused (block, instance) of this step, preferring `preferBlockId`. */
export function nextFreeInstance(
  required: RequiredBlock[],
  placements: Placement[],
  preferBlockId?: string,
): { block_id: string; instance: number } | null {
  const order = [...required].sort((a, b) => (a.block_id === preferBlockId ? -1 : b.block_id === preferBlockId ? 1 : 0));
  for (const r of order)
    for (let i = 1; i <= r.required_quantity; i++)
      if (!placements.some((p) => p.target_block_id === r.block_id && p.instance === i)) return { block_id: r.block_id, instance: i };
  return null;
}

/** New block: an explicitly APPROXIMATE 10 cm proxy at the origin (never guessed real dimensions). */
export function proxyBlock(slot: { block_id: string; instance: number }): Placement {
  return {
    target_block_id: slot.block_id,
    instance: slot.instance,
    origin: "tabletop_session",
    method: "manual_authoring",
    evidence: "approximate",
    confirmed: true,
    dimensions: { x_mm: 100, y_mm: 100, z_mm: 100 },
    studs: null,
    position_m: [0, 0, 0],
    rotation_deg: [0, 0, 0],
  };
}

/** Duplicate an authored block for the next free instance, placed beside it at the same height. */
export function duplicateBlock(p: Placement, required: RequiredBlock[], placements: Placement[]): Placement | null {
  const slot = nextFreeInstance(required, placements, p.target_block_id);
  if (!slot) return null;
  const sameTarget = slot.block_id === p.target_block_id;
  return {
    ...structuredClone(p),
    target_block_id: slot.block_id,
    instance: slot.instance,
    // Another block type must not inherit this block's measurements or studs.
    ...(sameTarget ? {} : { evidence: "approximate" as const, studs: null, dimensions: { x_mm: 100, y_mm: 100, z_mm: 100 } }),
    position_m: [round(p.position_m[0] + (sameTarget ? p.dimensions.x_mm : 100) / 1000), p.position_m[1], p.position_m[2]],
  };
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;

interface Rect { x0: number; x1: number; z0: number; z1: number }

/** Axis-aligned tabletop footprint (mm) of a block rotated about Y (conservative for overlap). */
export function footprint(p: Placement): Rect {
  const a = (p.rotation_deg[1] * Math.PI) / 180;
  const hx = p.dimensions.x_mm / 2, hz = p.dimensions.z_mm / 2;
  const ex = Math.abs(Math.cos(a)) * hx + Math.abs(Math.sin(a)) * hz;
  const ez = Math.abs(Math.sin(a)) * hx + Math.abs(Math.cos(a)) * hz;
  const cx = p.position_m[0] * 1000, cz = p.position_m[2] * 1000;
  return { x0: cx - ex, x1: cx + ex, z0: cz - ez, z1: cz + ez };
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const d = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
  return w > 0.5 && d > 0.5 ? w * d : 0;
}

export interface StackNeighbour {
  label: string;
  /** Top of that block's body (= where a block resting on it has its bottom), mm. */
  topMm: number;
  evidence: Placement["evidence"];
  relation: "supports" | "below_with_gap" | "intersects" | "above";
}

export interface StackHelp {
  bottomMm: number;
  topMm: number;
  status: "on_table" | "stacked" | "floating" | "intersecting" | "tilted";
  explanation: string;
  neighbours: StackNeighbour[];
  /** Explicit "Set Y to the top of …" options (author must click; nothing is auto-applied). */
  suggestions: { label: string; yM: number; fromApproximate: boolean }[];
}

const TOL_MM = 0.5;

/**
 * Height help for one block against other authored blocks (this step and
 * earlier ones): what it rests on, gaps and intersections.
 */
export function stackHelp(target: Placement, others: { label: string; placement: Placement }[]): StackHelp {
  const bottomMm = target.position_m[1] * 1000;
  const topMm = bottomMm + target.dimensions.y_mm;
  const tilted = Math.abs(target.rotation_deg[0]) > 0.01 || Math.abs(target.rotation_deg[2]) > 0.01;
  const mine = footprint(target);
  const neighbours: StackNeighbour[] = [];
  for (const o of others) {
    if (o.placement === target || overlapArea(mine, footprint(o.placement)) === 0) continue;
    const oBottom = o.placement.position_m[1] * 1000;
    const oTop = oBottom + o.placement.dimensions.y_mm;
    const relation: StackNeighbour["relation"] =
      Math.abs(oTop - bottomMm) <= TOL_MM ? "supports"
        : oTop < bottomMm ? "below_with_gap"
          : oBottom >= topMm - TOL_MM ? "above"
            : "intersects";
    neighbours.push({ label: o.label, topMm: oTop, evidence: o.placement.evidence, relation });
  }
  const suggestions = neighbours
    .filter((n) => n.relation !== "above" && Math.abs(n.topMm - bottomMm) > TOL_MM)
    .map((n) => ({ label: n.label, yM: Math.round(n.topMm * 1000) / 1e6, fromApproximate: n.evidence === "approximate" }));
  const fmt = (v: number) => `${v.toFixed(1)} mm`;
  const base = `Bottom face Y = ${fmt(bottomMm)} · body top = ${fmt(topMm)} (studs not included).`;
  if (tilted)
    return { bottomMm, topMm, status: "tilted", neighbours, suggestions: [],
      explanation: `${base} Rotated about X/Z: the block pivots about its bottom centre, so stacking help is not computed.` };
  const supports = neighbours.filter((n) => n.relation === "supports");
  const hits = neighbours.filter((n) => n.relation === "intersects");
  if (hits.length)
    return { bottomMm, topMm, status: "intersecting", neighbours, suggestions,
      explanation: `${base} Intersects ${hits.map((n) => n.label).join(", ")} — raise it to rest on top (body top ${fmt(hits[0].topMm)}).` };
  if (supports.length)
    return { bottomMm, topMm, status: "stacked", neighbours, suggestions,
      explanation: `${base} Rests on ${supports.map((n) => `${n.label} (top ${fmt(n.topMm)})`).join(", ")}.` };
  if (bottomMm <= TOL_MM)
    return { bottomMm, topMm, status: "on_table", neighbours, suggestions, explanation: `${base} Rests on the tabletop.` };
  return { bottomMm, topMm, status: "floating", neighbours, suggestions,
    explanation: `${base} Nothing authored supports it — it floats ${fmt(bottomMm - Math.max(0, ...neighbours.filter((n) => n.relation === "below_with_gap").map((n) => n.topMm)))} above the nearest surface.` };
}
