"use client";
import { useCallback } from "react";
import { useResource } from "@/hooks/useResource";
import { apiRequest } from "@/lib/api";
import type { Face } from "@/components/blocks/FaceEditor";
import type { StepInput } from "@/types/projects";

export function FaceConstraintEditor({ blockId, value, onChange }: { blockId: string; value: StepInput["face_constraint"]; onChange: (value: StepInput["face_constraint"]) => void }) {
  const load = useCallback(() => apiRequest<Face[]>(`/api/blocks/${blockId}/faces`), [blockId]);
  const { data, error } = useResource(load);
  return <div>
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p role="status">Loading registered faces…</p>}
    <label className="field">Required printed face<select value={value?.required_face_id ?? ""} onChange={(e) => onChange(e.target.value ? { target_block_id: blockId, required_face_id: e.target.value, facing_direction: value?.facing_direction ?? (data?.find((face) => face.id === e.target.value)?.print_rule ? "not_required" : "operator_front") } : null)}><option value="">No required face</option>{data?.map((face) => <option key={face.id} value={face.id}>{face.name} · {face.label}</option>)}</select></label>
    {value && <label className="field">Required physical facing direction<select value={value.facing_direction} onChange={(e) => onChange({ ...value, facing_direction: e.target.value })}>{["not_required", "operator_front", "board_positive_x", "board_negative_x", "board_positive_y", "board_negative_y"].map((direction) => <option key={direction} value={direction}>{direction === "not_required" ? "Print identity only (no physical direction)" : direction.replaceAll("_", " ")}</option>)}</select></label>}
    <p className="muted">Print identity only checks the visible print without a direction rule. Otherwise choose the board axis facing the operator. Operator front alone is unanchored and remains uncertain.</p>
  </div>;
}
