import type { GeometricVerification, ImagePoint } from "@/types/geometry";

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function nullableFinite(value: unknown): boolean { return value === null || finite(value); }
function text(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function point(value: unknown, width: number, height: number): value is ImagePoint {
  return record(value) && finite(value.x_px) && finite(value.y_px) &&
    value.x_px >= 0 && value.y_px >= 0 && value.x_px < width && value.y_px < height;
}
function boardPoint(value: unknown): boolean {
  return record(value) && finite(value.x_mm) && finite(value.y_mm) && finite(value.z_mm) &&
    value.z_mm >= 0 && value.z_mm <= 200;
}

export function isGeometricVerification(value: unknown, stepId: string): value is GeometricVerification {
  if (!record(value) || value.schema_version !== 1 || value.step_id !== stepId ||
      !["measured", "not_measured"].includes(String(value.measurement_status)) ||
      !["correct", "incorrect", "uncertain", "not_measured"].includes(String(value.geometry_status)) ||
      !(value.constraint_id === null || text(value.constraint_id)) ||
      ![null, "relative_stud_offset"].includes(value.constraint_type as null | string) ||
      ![null, "longitudinal"].includes(value.axis as null | string) || value.stud_pitch_mm !== 8 ||
      ![value.expected_studs, value.observed_studs, value.deviation_studs, value.uncertainty_studs,
        value.observed_mm, value.deviation_mm, value.tolerance_studs].every(nullableFinite) ||
      !text(value.guidance) || !Array.isArray(value.limitations) ||
      !value.limitations.every(text) || value.limitations.length > 20 || !record(value.evidence)) return false;
  const measured = value.measurement_status === "measured";
  if (measured !== [value.observed_studs, value.deviation_studs, value.uncertainty_studs,
      value.observed_mm, value.deviation_mm].every(finite) ||
      (measured && (!["correct", "incorrect", "uncertain"].includes(String(value.geometry_status)) ||
        !text(value.constraint_id) || !finite(value.expected_studs) || !finite(value.tolerance_studs)))) return false;
  if (!measured) return ["uncertain", "not_measured"].includes(String(value.geometry_status)) &&
    value.analyzed_snapshot === null && value.observed_studs === null &&
    value.deviation_studs === null && value.uncertainty_studs === null;
  const expectedDeviation = Number(value.observed_studs) - Number(value.expected_studs);
  const error = Math.abs(Number(value.deviation_studs));
  const expectedStatus = error + Number(value.uncertainty_studs) <= Number(value.tolerance_studs) ? "correct" :
    Math.max(0, error - Number(value.uncertainty_studs)) > Number(value.tolerance_studs) ? "incorrect" : "uncertain";
  if (Math.abs(Number(value.deviation_studs) - expectedDeviation) > 1e-6 ||
      Math.abs(Number(value.observed_mm) - Number(value.observed_studs) * 8) > 1e-6 ||
      Math.abs(Number(value.deviation_mm) - Number(value.deviation_studs) * 8) > 1e-6 ||
      value.geometry_status !== expectedStatus) return false;
  const snapshot = value.analyzed_snapshot;
  const evidence = value.evidence;
  const width = record(snapshot) ? Number(snapshot.width) : 0;
  const height = record(snapshot) ? Number(snapshot.height) : 0;
  if (!record(snapshot) || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(String(snapshot.data_url)) ||
      !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 ||
      height <= 0 || width > 8192 || height > 8192 ||
      evidence.calibration_valid !== true || evidence.board_pose_valid !== true ||
      !text(evidence.calibration_profile_id) || !text(evidence.snapshot_id) || !/^[a-f0-9]{64}$/.test(evidence.snapshot_id) ||
      !Number.isInteger(evidence.target_feature_count) || !Number.isInteger(evidence.reference_feature_count) ||
      !Array.isArray(evidence.features) || evidence.features.length > 128 || !record(evidence.reference_axis) ||
      !boardPoint(evidence.reference_axis.origin) || !finite(evidence.reference_axis.unit_x) ||
      !finite(evidence.reference_axis.unit_y) || !record(evidence.reference_axis_image) ||
      !point(evidence.reference_axis_image.start, width, height) ||
      !point(evidence.reference_axis_image.end, width, height)) return false;
  const target = evidence.features.filter((feature) => record(feature) && feature.role === "target");
  const reference = evidence.features.filter((feature) => record(feature) && feature.role === "reference");
  return evidence.target_feature_count === 8 && [2, 4, 6, 8].includes(Number(evidence.reference_feature_count)) &&
    target.length === evidence.target_feature_count && reference.length === evidence.reference_feature_count &&
    evidence.features.every((feature) => record(feature) && text(feature.block_id) &&
      ["target", "reference"].includes(String(feature.role)) &&
      point(feature.image, width, height) && boardPoint(feature.board));
}

export async function validateGeometrySnapshot(result: GeometricVerification): Promise<void> {
  if (result.measurement_status !== "measured" || !result.analyzed_snapshot || !result.evidence.snapshot_id) return;
  const encoded = result.analyzed_snapshot.data_url.split(",")[1];
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const identity = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (identity !== result.evidence.snapshot_id) throw new Error("Geometry snapshot identity mismatch. No overlay was accepted.");
  const image = new Image(); image.src = result.analyzed_snapshot.data_url; await image.decode();
  if (image.naturalWidth !== result.analyzed_snapshot.width || image.naturalHeight !== result.analyzed_snapshot.height) {
    throw new Error("Geometry snapshot dimensions mismatch. No overlay was accepted.");
  }
}
