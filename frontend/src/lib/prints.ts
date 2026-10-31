import { isValidBoundingBox } from "./diagnosis-validation";
import type { BoundingBox } from "@/types/inspection";

export interface PrintRecognition {
  schema_version: 1; target_block_id: string | null; expected_print: string | null;
  observed_print: string | null; observed_logo: string | null;
  observed_registered_side_id: string | null; observed_registered_side_name: string | null;
  recognition_status: "match" | "mismatch" | "uncertain" | "not_applicable";
  recognition_method: "meta_zero_shot" | "meta_reference" | "contour_matching" | "hybrid" | "none";
  evidence_quality: "clear" | "partial" | "unreadable" | "ambiguous" | "not_measured";
  known_alternative: boolean; description: string; suggested_action: string;
  snapshot_id: string; bounding_box: BoundingBox | null; reference_image_id: string | null;
  direction_required: boolean; direction_supported: boolean;
  gate_status: "pass" | "fail" | "uncertain" | "not_applicable";
}
export function validPrint(value: unknown, snapshotId: string): value is PrintRecognition {
  if (!value || typeof value !== "object") return false;
  const p = value as PrintRecognition;
  if (p.schema_version !== 1 || p.snapshot_id !== snapshotId || !/^[a-f0-9]{64}$/.test(p.snapshot_id) ||
      !["match", "mismatch", "uncertain", "not_applicable"].includes(p.recognition_status) ||
      !["meta_zero_shot", "meta_reference", "contour_matching", "hybrid", "none"].includes(p.recognition_method) ||
      !["clear", "partial", "unreadable", "ambiguous", "not_measured"].includes(p.evidence_quality) ||
      !["pass", "fail", "uncertain", "not_applicable"].includes(p.gate_status) ||
      ![p.known_alternative, p.direction_required, p.direction_supported].every((v) => typeof v === "boolean") ||
      ![p.description, p.suggested_action].every((v) => typeof v === "string" && v.length > 0) ||
      ![p.target_block_id, p.expected_print, p.observed_print, p.observed_logo, p.observed_registered_side_id,
        p.observed_registered_side_name, p.reference_image_id].every((v) => v === null || typeof v === "string") ||
      !(p.bounding_box === null || isValidBoundingBox(p.bounding_box))) return false;
  if ((p.recognition_status === "not_applicable") !== (p.gate_status === "not_applicable")) return false;
  if (["pass", "fail"].includes(p.gate_status) && (p.evidence_quality !== "clear" || !p.target_block_id ||
      p.recognition_status !== (p.gate_status === "pass" ? "match" : "mismatch") ||
      (p.direction_required && !p.direction_supported))) return false;
  return true;
}
