import type { InspectionIssue, InspectionResponse } from "./inspection";
import type { GeometricVerification } from "./geometry";

export type WorkflowState = "idle" | "inspecting" | "correct" | "correction_required" | "awaiting_rescan" | "verifying" | "verified" | "still_incorrect" | "uncertain" | "error";
export interface TrackedIssue {
  issue_id: string;
  original_inspection_id: string;
  original_snapshot_id: string;
  original: InspectionIssue;
  resolution: "open" | "resolved" | "unresolved" | "uncertain";
  evidence: string;
  current_issue_index: number | null;
}
export interface IssueAssessment {
  previous_issue_id: string;
  resolution: "resolved" | "unresolved" | "uncertain";
  explanation: string;
  current_issue_index: number | null;
}
export interface WorkflowInspection extends InspectionResponse {
  inspection_id: string;
  snapshot_id: string;
  specification_id: string;
  state: WorkflowState;
  tracked_issues: TrackedIssue[];
  correction_plan: { issue_id: string | null; block_id: string | null; kind: "adjust" | "geometry_adjust" | "capture"; instruction: string }[];
  geometry?: GeometricVerification | null;
  muse_call_count: 1;
  meta_attempt_count: number;
}
export interface VerificationResponse {
  verification_id: string;
  previous_inspection_id: string;
  status: "verified" | "still_incorrect" | "uncertain";
  inspection: WorkflowInspection;
  issue_assessments: IssueAssessment[];
}
export interface StepProgress {
  step_id: string;
  specification_id: string;
  status: "not_started" | "in_progress" | "verified";
  verified_at: string | null;
}
