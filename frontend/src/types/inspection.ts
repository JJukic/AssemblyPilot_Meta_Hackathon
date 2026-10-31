import type { ContourLayer } from "@/lib/contours";
export interface BoundingBox { x: number; y: number; width: number; height: number }
export interface InspectionIssue {
  type: "missing_part" | "misplaced_part" | "wrong_color" | "wrong_orientation" | "unexpected_part" | "unknown";
  block_id: string | null;
  description: string;
  expected: string;
  observed: string;
  suggested_fix: string;
  bounding_box: BoundingBox | null;
}
export interface InspectionResult {
  step_id: string;
  status: "correct" | "incorrect" | "uncertain";
  confidence: number | null;
  visible_blocks: { block_id: string | null; description: string; estimated_count: number | null }[];
  issues: InspectionIssue[];
  explanation: string;
  next_action: string;
  active_vision: {
    reason: string;
    requested_view: "top_down" | "front" | "back" | "left_side" | "right_side" | "close_up" | "other";
    instruction: string;
  } | null;
}
export interface AnalyzedSnapshot { data_url: string; width: number; height: number }
export interface InspectionResponse extends InspectionResult {
  comparison_reference_id?: string | null;
  analyzed_snapshot: AnalyzedSnapshot;
  inspection_id?: string;
  snapshot_id?: string;
  segmentations?: IssueSegmentation[];
  model: string;
  model_latency_ms: number;
  inspected_at: string;
}
export interface InspectionRecord {
  id: string;
  project_id: string;
  project_name: string;
  step_title: string;
  captured_at: string;
  result: InspectionResponse;
}
export interface SegmentationInstance {
  instance_id: string;
  left: number;
  top: number;
  mask: { encoding: "png"; width: number; height: number; data_url: string };
}
export interface IssueSegmentation {
  outline?: ContourLayer | null;
  issue_index: number;
  status: "matched" | "ambiguous" | "no_match" | "unavailable" | "disabled" | "skipped";
  concept: string | null;
  prompt_kind: "concept" | "box" | null;
  message: string;
  latency_ms: number;
  selected_instance_id: string | null;
  result: {
    snapshot_id: string; width: number; height: number; model: "sam-3.1";
    instances: SegmentationInstance[];
  } | null;
}
