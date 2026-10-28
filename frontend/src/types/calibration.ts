export interface CameraConfiguration {
  device_label: string; lens: string; configuration: string; width: number; height: number;
}
export interface CalibrationProfile {
  schema_version: 1; id: string; created_at: string; opencv_version: string;
  board_id: string; camera: CameraConfiguration; accepted_views: number;
  reprojection_rms_px: number; per_view_rms_px: number[];
  coverage_fraction: number; normal_spread_degrees: number;
  measured_width_mm: number; measured_height_mm: number;
}
export interface CalibrationStatus {
  board: { squares_x: number; squares_y: number; square_mm: number; marker_mm: number; dictionary: string };
  board_id: string; opencv_version: string; profiles: CalibrationProfile[]; invalid_profile_count: number;
}
export interface CaptureAssessment {
  schema_version: 1; board_id: string; analyzed_snapshot: string; snapshot_sha256: string;
  width: number; height: number; board_status: "detected" | "not_detected" | "ambiguous";
  marker_count: number; corner_count: number; corners: { id: number; x_px: number; y_px: number }[];
  board_visibility: number; sharpness: number; calibration_status: "missing" | "compatible" | "mismatch";
  pose: { rvec: number[]; translation_mm: number[]; viewing_angle_degrees: number; reprojection_rms_px: number } | null;
  suitable_for_top_down_capture: boolean; sample_acceptable: boolean; guidance: string[];
  geometry: { measurement_status: "not_measured"; calibration_valid: boolean; limitations: string[] };
}
