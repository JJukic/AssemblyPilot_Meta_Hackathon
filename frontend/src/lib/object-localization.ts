import { apiRequest } from "./api";
import { snapshotFile } from "./camera-image";
import { validMask } from "./diagnosis-validation";
import { validContour, type ContourLayer } from "./contours";
import type { AnalyzedSnapshot, SegmentationInstance } from "@/types/inspection";

export interface ObjectLocalization {
  concept: string; latency_ms: number;
  result: { snapshot_id: string; width: number; height: number; model: "sam-3.1"; instances: SegmentationInstance[] };
  outlines: { instance_id: string; outline: ContourLayer }[];
}
export async function localizeObjects(snapshot: AnalyzedSnapshot, concept: string, signal: AbortSignal): Promise<ObjectLocalization> {
  const file = snapshotFile({ dataUrl: snapshot.data_url }, "analyzed-snapshot.jpg");
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())),
    (b) => b.toString(16).padStart(2, "0")).join("");
  const body = new FormData(); body.append("image", file); body.append("snapshot_id", hash); body.append("concept", concept.trim());
  const value = await apiRequest<ObjectLocalization>("/api/vision/objects", {
    method: "POST", body, signal: AbortSignal.any([signal, AbortSignal.timeout(65000)]),
  });
  const r = value?.result;
  if (!value || value.concept !== concept.trim() || !Number.isFinite(value.latency_ms) || value.latency_ms < 0 ||
      !r || r.model !== "sam-3.1" || r.snapshot_id !== hash || r.width !== snapshot.width || r.height !== snapshot.height ||
      !Array.isArray(r.instances) || r.instances.length > 32 || !Array.isArray(value.outlines) || value.outlines.length !== r.instances.length) {
    throw new Error("SAM object evidence does not match this analyzed snapshot.");
  }
  const ids = new Set<string>(); let bytes = 0;
  for (const i of r.instances) {
    if (!i || typeof i.instance_id !== "string" || !i.instance_id.length || i.instance_id.length > 100 || ids.has(i.instance_id) ||
        !Number.isInteger(i.left) || !Number.isInteger(i.top) || i.left < 0 || i.top < 0 || !validMask(i.mask) ||
        i.left + i.mask.width > r.width || i.top + i.mask.height > r.height) throw new Error("SAM returned invalid object bounds or masks.");
    ids.add(i.instance_id); bytes += i.mask.data_url.length;
  }
  if (bytes > 2 * 1024 * 1024) throw new Error("SAM mask payload exceeds its limit.");
  const outlineIds = new Set<string>();
  for (const item of value.outlines) {
    if (!item || !ids.has(item.instance_id) || outlineIds.has(item.instance_id) ||
        !validContour(item.outline, { snapshot_id: hash, width: r.width, height: r.height }) || item.outline.kind !== "sam_outline") {
      throw new Error("SAM outlines do not match the returned objects.");
    }
    outlineIds.add(item.instance_id);
  }
  return value;
}
