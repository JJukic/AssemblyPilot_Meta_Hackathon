import { validContour, type ContourLayer } from "./contours";
import type { AnalyzedSnapshot } from "@/types/inspection";

export interface FaceResult {
  schema_version: 1;
  contours?: ContourLayer[];
  status: "correct" | "incorrect" | "uncertain" | "not_measured";
  expected_face_id: string | null;
  observed_face_id: string | null;
  expected_face_name?: string | null;
  observed_face_name?: string | null;
  matched_reference_image_id: string | null;
  matching_score: number | null;
  method: "none" | "orb_ransac_canny";
  snapshot_id: string;
  analyzed_snapshot: AnalyzedSnapshot | null;
  quadrilateral: number[][];
  directional_evidence: boolean;
  guidance: string;
}

const optionalText = (value: unknown) => value === null || (typeof value === "string" && value.length > 0);
export function validFace(value: unknown): value is FaceResult {
  if (!value || typeof value !== "object") return false;
  const face = value as FaceResult;
  if (face.schema_version !== 1 ||
      !["correct", "incorrect", "uncertain", "not_measured"].includes(face.status) ||
      typeof face.guidance !== "string" || typeof face.snapshot_id !== "string" ||
      !/^[a-f0-9]{64}$/.test(face.snapshot_id) || typeof face.directional_evidence !== "boolean" ||
      !["none", "orb_ransac_canny"].includes(face.method)) return false;
  if (![face.expected_face_id, face.observed_face_id, face.matched_reference_image_id].every(optionalText) ||
      ![face.expected_face_name, face.observed_face_name].every((name) => name === undefined || optionalText(name))) return false;
  if (face.matching_score !== null && (typeof face.matching_score !== "number" ||
      !Number.isFinite(face.matching_score) || face.matching_score < 0 || face.matching_score > 1)) return false;
  if (face.status === "not_measured" && face.expected_face_id) return false;
  if (["correct", "incorrect"].includes(face.status) && (!face.directional_evidence ||
      !face.expected_face_id || !face.observed_face_id || !face.matched_reference_image_id ||
      !face.analyzed_snapshot || face.matching_score === null || face.method === "none")) return false;
  if (face.status === "correct" && face.expected_face_id !== face.observed_face_id) return false;
  if (face.status === "incorrect" && face.expected_face_id === face.observed_face_id) return false;
  if (!Array.isArray(face.quadrilateral)) return false;
  if (face.contours !== undefined && (!Array.isArray(face.contours) || face.contours.length > 2 ||
      !face.contours.every((layer) => layer && validContour(layer, {
        snapshot_id: face.snapshot_id, width: face.analyzed_snapshot?.width ?? layer.width,
        height: face.analyzed_snapshot?.height ?? layer.height,
      }) && ["canny_edges", "reference_match"].includes(layer.kind) &&
        (layer.status === "unavailable" || (!!face.matched_reference_image_id && face.method === "orb_ransac_canny" && !!face.analyzed_snapshot))) ||
      new Set(face.contours.map((layer) => layer.kind)).size !== face.contours.length)) return false;

  if (!face.analyzed_snapshot) return face.quadrilateral.length === 0;
  const image = face.analyzed_snapshot;
  return typeof image.data_url === "string" && /^data:image\/jpeg;base64,/.test(image.data_url) &&
    Number.isInteger(image.width) && image.width > 0 && image.width <= 8192 &&
    Number.isInteger(image.height) && image.height > 0 && image.height <= 8192 &&
    face.quadrilateral.length === 4 && face.quadrilateral.every((point) =>
      Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) &&
      point[0] >= 0 && point[1] >= 0 && point[0] < image.width && point[1] < image.height);
}
