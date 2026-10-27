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
  analyzed_snapshot: AnalyzedSnapshot;
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
