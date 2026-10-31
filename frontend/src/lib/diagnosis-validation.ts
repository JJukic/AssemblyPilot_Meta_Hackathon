import { validContour } from "./contours";
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
  if (value.comparison_reference_id !== undefined && value.comparison_reference_id !== null &&
      (typeof value.comparison_reference_id !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(value.comparison_reference_id))) return false;
  if (!validSegmentations(value)) return false;
  if (value.status !== "uncertain") return value.active_vision === null;
  const vision = value.active_vision;
  return record(vision) && text(vision.reason) && text(vision.instruction) &&
    ["top_down", "front", "back", "left_side", "right_side", "close_up", "other"].includes(String(vision.requested_view));
}


export function validMask(mask: unknown): boolean {
  if (!record(mask) || mask.encoding !== "png" || !Number.isInteger(mask.width) || !Number.isInteger(mask.height) ||
      Number(mask.width) <= 0 || Number(mask.height) <= 0 || Number(mask.width) > 1600 || Number(mask.height) > 1600 ||
      !text(mask.data_url) || mask.data_url.length > 700000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(mask.data_url)) return false;
  try {
    const bytes = Uint8Array.from(atob(mask.data_url.split(",")[1]), (char) => char.charCodeAt(0));
    const header = new DataView(bytes.buffer);
    return bytes.length <= 524288 && bytes.length >= 33 && header.getUint32(0) === 0x89504e47 &&
      header.getUint32(4) === 0x0d0a1a0a && header.getUint32(8) === 13 && header.getUint32(12) === 0x49484452 &&
      header.getUint32(16) === mask.width && header.getUint32(20) === mask.height && bytes[24] === 8 && bytes[25] === 6;
  } catch { return false; }
}

function validSegmentations(value: Record<string, unknown>): boolean {
  // Phase 3B servers remain readable; any supplied SAM metadata must be complete.
  if (value.segmentations === undefined) return value.snapshot_id === undefined && value.inspection_id === undefined;
  if (!text(value.inspection_id) || !text(value.snapshot_id) || !/^[a-f0-9]{64}$/.test(value.snapshot_id) ||
      !Array.isArray(value.segmentations) || value.segmentations.length > 100) return false;
  const snapshot = value.analyzed_snapshot as Record<string, unknown>;
  const issues = value.issues as Record<string, unknown>[];
  const indices = new Set<number>();
  let maskBytes = 0;
  return value.segmentations.every((entry) => {
    if (!record(entry) || !Number.isInteger(entry.issue_index) || Number(entry.issue_index) < 0 ||
        Number(entry.issue_index) >= issues.length || indices.has(Number(entry.issue_index)) ||
        !["matched", "ambiguous", "no_match", "unavailable", "disabled", "skipped"].includes(String(entry.status)) ||
        !text(entry.message) || !finite(entry.latency_ms) || entry.latency_ms < 0 ||
        !(entry.concept === null || text(entry.concept)) || ![null, "concept", "box"].includes(entry.prompt_kind as null | string)) return false;
    indices.add(Number(entry.issue_index));
    if (entry.outline !== undefined && entry.outline !== null &&
        (!validContour(entry.outline, { snapshot_id: String(value.snapshot_id), width: Number(snapshot.width), height: Number(snapshot.height) }) ||
         entry.outline.kind !== "sam_outline" || (entry.outline.status === "available" && entry.status !== "matched"))) return false;

    if (entry.result === null) return entry.selected_instance_id === null && ["unavailable", "disabled", "skipped"].includes(String(entry.status));
    const result = entry.result;
    if (value.status !== "incorrect" || issues[Number(entry.issue_index)].type === "missing_part" ||
        !record(result) || result.snapshot_id !== value.snapshot_id || result.width !== snapshot.width ||
        result.height !== snapshot.height || result.model !== "sam-3.1" || !Array.isArray(result.instances) || result.instances.length > 32) return false;
    const ids = new Set<string>();
    if (!result.instances.every((instance) => {
      if (!record(instance) || !text(instance.instance_id) || ids.has(instance.instance_id) ||
          !Number.isInteger(instance.left) || !Number.isInteger(instance.top) || Number(instance.left) < 0 || Number(instance.top) < 0 ||
          !validMask(instance.mask)) return false;
      const mask = instance.mask as { width: number; height: number; data_url: string };
      ids.add(instance.instance_id); maskBytes += mask.data_url.length;
      return Number(instance.left) + mask.width <= Number(snapshot.width) && Number(instance.top) + mask.height <= Number(snapshot.height);
    }) || maskBytes > 4 * 1024 * 1024) return false;
    if (entry.status === "matched") return text(entry.selected_instance_id) && ids.has(entry.selected_instance_id);
    return entry.selected_instance_id === null && ((entry.status === "ambiguous" && ids.size > 0) || (entry.status === "no_match" && ids.size === 0));
  });
}
