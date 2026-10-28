import { apiRequest } from "./api";
import type { CaptureAssessment } from "@/types/calibration";

function validPose(pose: CaptureAssessment["pose"]) {
  return pose === null || !!pose && [pose.rvec, pose.translation_mm].every((vector) =>
    Array.isArray(vector) && vector.length === 3 && vector.every(Number.isFinite)) &&
    Number.isFinite(pose.viewing_angle_degrees) && pose.viewing_angle_degrees >= 0 && pose.viewing_angle_degrees <= 90 &&
    Number.isFinite(pose.reprojection_rms_px) && pose.reprojection_rms_px >= 0 && pose.reprojection_rms_px <= 2;
}

export async function assessCapture(body: FormData, signal: AbortSignal): Promise<CaptureAssessment> {
  const result = await apiRequest<CaptureAssessment>("/api/calibration/validate-capture", { method: "POST", body, signal });
  if (!result || result.schema_version !== 1 || !Array.isArray(result.corners) ||
      !Number.isInteger(result.width) || !Number.isInteger(result.height) || result.width <= 0 || result.height <= 0 ||
      result.width > 8192 || result.height > 8192 ||
      !Array.isArray(result.guidance) || !result.guidance.every((message) => typeof message === "string") ||
      !Number.isInteger(result.marker_count) || result.marker_count < 0 ||
      result.corner_count !== result.corners.length || new Set(result.corners.map((p) => p.id)).size !== result.corners.length ||
      !Number.isFinite(result.board_visibility) || result.board_visibility < 0 || result.board_visibility > 1 ||
      !validPose(result.pose) ||
      (result.suitable_for_top_down_capture && (!result.pose || result.calibration_status !== "compatible" || !result.geometry?.calibration_valid)) ||
      !Number.isFinite(result.sharpness) || result.sharpness < 0 ||
      !["detected", "not_detected", "ambiguous"].includes(result.board_status) ||
      !["missing", "compatible", "mismatch"].includes(result.calibration_status) ||
      result.geometry?.measurement_status !== "not_measured" ||
      typeof result.sample_acceptable !== "boolean" || typeof result.suitable_for_top_down_capture !== "boolean" ||
      !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(result.analyzed_snapshot) ||
      result.corners.length > 361 || !result.corners.every((p) => Number.isInteger(p.id) && p.id >= 0 &&
        Number.isFinite(p.x_px) && Number.isFinite(p.y_px) && p.x_px >= 0 && p.y_px >= 0 && p.x_px < result.width && p.y_px < result.height)) {
    throw new Error("Invalid geometry response; no overlay was accepted.");
  }
  const bytes = Uint8Array.from(atob(result.analyzed_snapshot.split(",")[1]), (char) => char.charCodeAt(0));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== result.snapshot_sha256) throw new Error("Geometry snapshot identity mismatch.");
  const image = new Image(); image.src = result.analyzed_snapshot; await image.decode();
  if (image.naturalWidth !== result.width || image.naturalHeight !== result.height) throw new Error("Geometry image dimensions mismatch.");
  return result;
}

export async function downloadBoard() {
  // Obtain the PDF from the configured backend, not a user-supplied URL.
  const url = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
  const response = await fetch(`${url}/api/calibration/board.pdf`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("Could not download the board.");
  const href = URL.createObjectURL(await response.blob());
  const link = document.createElement("a"); link.href = href; link.download = "charuco-7x5.pdf"; link.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
