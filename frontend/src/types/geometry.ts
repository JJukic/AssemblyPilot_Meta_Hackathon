import type { AnalyzedSnapshot } from "./inspection";

export interface StudOffsetConstraint {
  id?: string;
  target_block_id: string;
  reference_block_id: string;
  constraint_type: "relative_stud_offset";
  axis: "longitudinal";
  positive_direction: "board_positive_x" | "board_positive_y";
  expected_stud_offset: number;
  tolerance_studs: number;
  reference_surface_height_mm: number;
  target_surface_height_mm: number;
}

export interface ImagePoint { x_px: number; y_px: number }
export interface BoardPoint { x_mm: number; y_mm: number; z_mm: number }
export interface StudFeature {
  block_id: string;
  role: "target" | "reference";
  image: ImagePoint;
  board: BoardPoint;
}
export interface GeometricVerification {
  schema_version: 1;
  step_id: string;
  constraint_id: string | null;
  measurement_status: "measured" | "not_measured";
  geometry_status: "correct" | "incorrect" | "uncertain" | "not_measured";
  constraint_type: "relative_stud_offset" | null;
  axis: "longitudinal" | null;
  expected_studs: number | null;
  observed_studs: number | null;
  deviation_studs: number | null;
  uncertainty_studs: number | null;
  stud_pitch_mm: 8;
  observed_mm: number | null;
  deviation_mm: number | null;
  tolerance_studs: number | null;
  evidence: {
    calibration_profile_id: string | null;
    snapshot_id: string | null;
    calibration_valid: boolean;
    board_pose_valid: boolean;
    target_feature_count: number;
    reference_feature_count: number;
    features: StudFeature[];
    reference_axis: { origin: BoardPoint; unit_x: number; unit_y: number } | null;
    reference_axis_image: { start: ImagePoint; end: ImagePoint } | null;
  };
  analyzed_snapshot: AnalyzedSnapshot | null;
  guidance: string;
  limitations: string[];
}
