export interface InspectionResult {
  step_id: string;
  status: "correct" | "incorrect" | "uncertain";
  confidence: number | null;
  visible_blocks: {
    block_id: string | null;
    description: string;
    estimated_count: number | null;
  }[];
  issues: {
    type: "missing_part" | "misplaced_part" | "wrong_color" | "wrong_orientation" | "unexpected_part" | "unknown";
    block_id: string | null;
    description: string;
    suggested_fix: string;
    bounding_box: { x: number; y: number; width: number; height: number } | null;
  }[];
  explanation: string;
  next_action: string;
}
