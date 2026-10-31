import { apiRequest } from "./api";
import { snapshotFile } from "./camera-image";
import { validContour, type ContourLayer } from "./contours";
import type { Snapshot } from "@/types/assembly";
import type { AnalyzedSnapshot } from "@/types/inspection";

export interface EdgeROI { left: number; top: number; width: number; height: number }
export interface EdgeOptions { blur_kernel: number; low_threshold: number; high_threshold: number; roi: EdgeROI | null }
export interface EdgeDebugResult {
  snapshot_id: string; analyzed_snapshot: AnalyzedSnapshot; options: EdgeOptions;
  applied_roi: EdgeROI; edge_image: string; contours: ContourLayer;
  edge_pixel_count: number; processing_ms: number;
}
const equalROI = (a: EdgeROI, b: EdgeROI) => a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;

export async function detectEdges(snapshot: Pick<Snapshot, "dataUrl" | "width" | "height">, options: EdgeOptions, signal: AbortSignal): Promise<EdgeDebugResult> {
  const file = snapshotFile(snapshot, "edge-debug.jpg");
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const body = new FormData(); body.append("image", file); body.append("snapshot_id", hash); body.append("options", JSON.stringify(options));
  const value = await apiRequest<EdgeDebugResult>("/api/vision/edges", {
    method: "POST", body, signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
  });
  const expectedROI = options.roi ?? { left: 0, top: 0, width: snapshot.width, height: snapshot.height };
  if (!value || value.snapshot_id !== hash || value.analyzed_snapshot?.data_url !== snapshot.dataUrl ||
      value.analyzed_snapshot.width !== snapshot.width || value.analyzed_snapshot.height !== snapshot.height ||
      !value.options || value.options.blur_kernel !== options.blur_kernel ||
      value.options.low_threshold !== options.low_threshold || value.options.high_threshold !== options.high_threshold ||
      (options.roi === null ? value.options.roi !== null : !value.options.roi || !equalROI(value.options.roi, options.roi)) ||
      !value.applied_roi || !equalROI(value.applied_roi, expectedROI) ||
      !validContour(value.contours, { snapshot_id: hash, width: snapshot.width, height: snapshot.height }) ||
      value.contours.kind !== "canny_edges" || !Number.isInteger(value.edge_pixel_count) ||
      value.edge_pixel_count < 0 || value.edge_pixel_count > expectedROI.width * expectedROI.height ||
      typeof value.processing_ms !== "number" || !Number.isFinite(value.processing_ms) || value.processing_ms < 0 ||
      typeof value.edge_image !== "string" || value.edge_image.length > 8_400_000 || !value.edge_image.startsWith("data:image/png;base64,")) {
    throw new Error("Edge evidence does not match this snapshot and its settings. No overlay was accepted.");
  }
  for (const path of value.contours.paths) for (const [x, y] of path.points) {
    if (x < expectedROI.left || y < expectedROI.top || x >= expectedROI.left + expectedROI.width || y >= expectedROI.top + expectedROI.height) {
      throw new Error("Edge contours extend outside the selected ROI.");
    }
  }
  try {
    const bytes = Uint8Array.from(atob(value.edge_image.split(",")[1]), (c) => c.charCodeAt(0));
    const header = new DataView(bytes.buffer);
    if (bytes.length < 33 || header.getUint32(0) !== 0x89504e47 || header.getUint32(4) !== 0x0d0a1a0a ||
        header.getUint32(8) !== 13 || header.getUint32(12) !== 0x49484452 ||
        header.getUint32(16) !== snapshot.width || header.getUint32(20) !== snapshot.height || bytes[24] !== 8 || bytes[25] !== 0) throw new Error();
  } catch { throw new Error("The backend returned an invalid edge image. No overlay was accepted."); }
  return value;
}
