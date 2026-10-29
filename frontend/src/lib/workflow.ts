import { isInspectionResponse, isValidBoundingBox } from "./diagnosis-validation";
import { isGeometricVerification, validateGeometrySnapshot } from "./geometry-validation";
import type { InspectionResponse } from "@/types/inspection";
import type { VerificationResponse, WorkflowInspection, WorkflowState } from "@/types/workflow";

const transitions: Record<WorkflowState, WorkflowState[]> = {
  idle: ["inspecting"], inspecting: ["correct", "correction_required", "uncertain", "error"],
  correct: ["awaiting_rescan", "inspecting"], correction_required: ["awaiting_rescan", "inspecting"],
  awaiting_rescan: ["verifying", "inspecting"], verifying: ["verified", "still_incorrect", "uncertain", "error"],
  verified: ["awaiting_rescan", "inspecting"], still_incorrect: ["awaiting_rescan", "inspecting"],
  uncertain: ["awaiting_rescan", "inspecting"], error: ["awaiting_rescan", "inspecting"],
};
export function transition(current: WorkflowState, target: WorkflowState): WorkflowState {
  if (!transitions[current].includes(target)) throw new Error("Invalid inspection state transition.");
  return target;
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 6000; }
function hash(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function index(value: unknown, count: number) { return value === null || (Number.isInteger(value) && Number(value) >= 0 && Number(value) < count); }

export function isWorkflowInspection(value: unknown, stepId: string): value is WorkflowInspection {
  if (!record(value) || !isInspectionResponse(value, stepId)) return false;
  const data = value as unknown as Record<string, unknown>;
  if (!text(data.inspection_id) || !hash(data.snapshot_id) || !hash(data.specification_id) || data.muse_call_count !== 1 || !Number.isInteger(data.meta_attempt_count) || Number(data.meta_attempt_count) < 1 || Number(data.meta_attempt_count) > 3 ||
      !Array.isArray(data.tracked_issues) || data.tracked_issues.length > 200 || !Array.isArray(data.correction_plan) || data.correction_plan.length > 100 ||
      !(data.geometry === undefined || data.geometry === null || isGeometricVerification(data.geometry, stepId))) return false;
  const geometry = data.geometry && isGeometricVerification(data.geometry, stepId) ? data.geometry : null;
  let states = value.status === "correct" ? ["correct", "verified"] : value.status === "incorrect" ? ["correction_required", "still_incorrect"] : ["uncertain"];
  if (value.status === "correct" && geometry?.constraint_id) {
    states = geometry.geometry_status === "correct" ? ["correct", "verified"] :
      geometry.geometry_status === "incorrect" ? ["correction_required", "still_incorrect"] : ["uncertain"];
  }
  if (!states.includes(String(data.state))) return false;
  const tracks = data.tracked_issues;
  const ids = new Set<string>(); const indices = new Set<number>();
  if (!data.tracked_issues.every((item) => {
    if (!record(item) || !text(item.issue_id) || ids.has(item.issue_id) || !text(item.original_inspection_id) || !hash(item.original_snapshot_id) ||
        !["open", "resolved", "unresolved", "uncertain"].includes(String(item.resolution)) || !text(item.evidence) || !record(item.original) ||
        !index(item.current_issue_index, value.issues.length)) return false;
    const original = item.original;
    if (!["missing_part", "misplaced_part", "wrong_color", "wrong_orientation", "unexpected_part", "unknown"].includes(String(original.type)) ||
        !(original.block_id === null || text(original.block_id)) || !text(original.description) || !text(original.expected) || !text(original.observed) || !text(original.suggested_fix) ||
        !(original.bounding_box === null || (original.type !== "missing_part" && isValidBoundingBox(original.bounding_box)))) return false;
    if (item.resolution === "resolved" && item.current_issue_index !== null) return false;
    if (data.state === "verified" && item.resolution !== "resolved") return false;
    if (item.current_issue_index !== null) {
      if (indices.has(Number(item.current_issue_index))) return false;
      indices.add(Number(item.current_issue_index));
    }
    ids.add(item.issue_id); return true;
  }) || indices.size !== value.issues.length) return false;
  if (!data.correction_plan.every((action) => record(action) &&
      ["adjust", "geometry_adjust", "capture"].includes(String(action.kind)) && text(action.instruction) &&
      (action.issue_id === null || text(action.issue_id)) && (action.block_id === null || text(action.block_id)))) return false;
  if (value.status === "correct" && !geometry?.constraint_id) return data.correction_plan.length === 0;
  if (value.status === "uncertain") {
    const action = data.correction_plan[0];
    return data.correction_plan.length === 1 && record(action) && action.kind === "capture" && action.issue_id === null && action.block_id === null && action.instruction === value.active_vision?.instruction;
  }
  const actionIds = new Set<string>();
  const semanticActions = data.correction_plan.filter((action) => record(action) && action.kind === "adjust");
  if (semanticActions.length !== value.issues.length || !semanticActions.every((action) => {
    if (!record(action) || !text(action.issue_id) || actionIds.has(action.issue_id)) return false;
    actionIds.add(action.issue_id);
    const track = tracks.find((item: unknown) => record(item) && item.issue_id === action.issue_id) as Record<string, unknown> | undefined;
    const issue = track && track.current_issue_index !== null ? value.issues[Number(track.current_issue_index)] : null;
    return !!issue && action.block_id === issue.block_id && action.instruction === issue.suggested_fix;
  })) return false;
  const geometryActions = data.correction_plan.filter((action) => record(action) && action.kind !== "adjust");
  if (!geometry?.constraint_id || geometry.geometry_status === "correct") return geometryActions.length === 0;
  return geometryActions.length === 1 && geometryActions[0].instruction === geometry.guidance &&
    geometryActions[0].kind === (geometry.geometry_status === "incorrect" ? "geometry_adjust" : "capture");
}

export function isVerificationResponse(value: unknown, previous: WorkflowInspection): value is VerificationResponse {
  if (!record(value) || !text(value.verification_id) || value.previous_inspection_id !== previous.inspection_id ||
      !isWorkflowInspection(value.inspection, previous.step_id) || value.inspection.inspection_id === previous.inspection_id ||
      value.inspection.snapshot_id === previous.snapshot_id || value.inspection.specification_id !== previous.specification_id ||
      !["verified", "still_incorrect", "uncertain"].includes(String(value.status)) || value.status !== value.inspection.state || !Array.isArray(value.issue_assessments)) return false;
  const inspection = value.inspection;
  const outstanding = previous.tracked_issues.filter((item) => item.resolution !== "resolved");
  const seen = new Set<string>();
  return value.issue_assessments.length === outstanding.length && value.issue_assessments.every((assessment) => {
    if (!record(assessment) || !text(assessment.previous_issue_id) || seen.has(assessment.previous_issue_id) ||
        !outstanding.some((item) => item.issue_id === assessment.previous_issue_id) || !text(assessment.explanation) ||
        !["resolved", "unresolved", "uncertain"].includes(String(assessment.resolution)) || !index(assessment.current_issue_index, inspection.issues.length) ||
        (value.status === "verified" && assessment.resolution !== "resolved")) return false;
    seen.add(assessment.previous_issue_id); return true;
  });
}

export async function validateSnapshotIdentity(result: InspectionResponse & { snapshot_id: string }) {
  const bytes = Uint8Array.from(atob(result.analyzed_snapshot.data_url.split(",")[1]), (char) => char.charCodeAt(0));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const identity = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (identity !== result.snapshot_id) throw new Error("Analyzed snapshot identity mismatch. No result was accepted.");
  if ("geometry" in result && result.geometry && isGeometricVerification(result.geometry, result.step_id)) {
    await validateGeometrySnapshot(result.geometry);
  }
}
