import type { BoundingBox, InspectionResponse } from "@/types/inspection";

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function id(value: unknown) { return value === null || text(value); }

export function isValidBoundingBox(value: unknown): value is BoundingBox {
  return record(value) && finite(value.x) && finite(value.y) && finite(value.width) && finite(value.height) &&
    value.x >= 0 && value.y >= 0 && value.width > 0 && value.height > 0 &&
    value.x + value.width <= 1 && value.y + value.height <= 1;
}

// Reject incompatible/malformed responses before storing them or rendering any coordinates.
export function isInspectionResponse(value: unknown, stepId: string): value is InspectionResponse {
  if (!record(value) || value.step_id !== stepId || !["correct", "incorrect", "uncertain"].includes(String(value.status)) ||
      !(value.confidence === null || (finite(value.confidence) && value.confidence >= 0 && value.confidence <= 1)) ||
      !text(value.explanation) || !text(value.next_action) || !text(value.model) ||
      !finite(value.model_latency_ms) || value.model_latency_ms < 0 || !text(value.inspected_at) ||
      !Number.isFinite(Date.parse(value.inspected_at))) return false;
  const snapshot = value.analyzed_snapshot;
  if (!record(snapshot) || !text(snapshot.data_url) || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(snapshot.data_url) ||
      !Number.isInteger(snapshot.width) || !Number.isInteger(snapshot.height) ||
      Number(snapshot.width) <= 0 || Number(snapshot.height) <= 0 || Number(snapshot.width) > 1600 || Number(snapshot.height) > 1600) return false;
  if (!Array.isArray(value.visible_blocks) || value.visible_blocks.length > 200 || !value.visible_blocks.every((item) =>
    record(item) && id(item.block_id) && text(item.description) && (item.estimated_count === null ||
      (Number.isInteger(item.estimated_count) && Number(item.estimated_count) >= 0 && Number(item.estimated_count) <= 100000)))) return false;
  if (!Array.isArray(value.issues) || value.issues.length > 100 || !value.issues.every((issue) =>
    record(issue) && ["missing_part", "misplaced_part", "wrong_color", "wrong_orientation", "unexpected_part", "unknown"].includes(String(issue.type)) &&
      id(issue.block_id) && text(issue.description) && text(issue.expected) && text(issue.observed) && text(issue.suggested_fix) &&
      (issue.bounding_box === null || (issue.type !== "missing_part" && isValidBoundingBox(issue.bounding_box))))) return false;
  if ((value.status === "correct" && value.issues.length > 0) || (value.status === "incorrect" && !value.issues.length)) return false;
  if (value.status !== "uncertain") return value.active_vision === null;
  const vision = value.active_vision;
  return record(vision) && text(vision.reason) && text(vision.instruction) &&
    ["top_down", "front", "back", "left_side", "right_side", "close_up", "other"].includes(String(vision.requested_view));
}
