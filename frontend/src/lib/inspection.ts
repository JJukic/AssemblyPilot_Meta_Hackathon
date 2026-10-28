import { apiRequest } from "./api";
import { snapshotFile } from "./camera-image";
import { isInspectionResponse } from "./diagnosis-validation";
import type { Snapshot } from "@/types/assembly";
import type { InspectionResponse } from "@/types/inspection";

export async function inspectSnapshot(projectId: string, stepId: string, snapshot: Snapshot, signal: AbortSignal): Promise<InspectionResponse> {
  const body = new FormData();
  body.append("image", snapshotFile(snapshot, "camera-snapshot.jpg"));
  body.append("project_id", projectId);
  body.append("step_id", stepId);
  const result = await apiRequest<unknown>("/api/inspect", {
    method: "POST", body, signal: AbortSignal.any([signal, AbortSignal.timeout(310000)]),
  });
  if (!isInspectionResponse(result, stepId)) {
    throw new Error("The backend returned an invalid diagnosis. No result was accepted.");
  }
  if (result.snapshot_id) {
    const bytes = Uint8Array.from(atob(result.analyzed_snapshot.data_url.split(",")[1]), (char) => char.charCodeAt(0));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const identity = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (identity !== result.snapshot_id) throw new Error("The analyzed snapshot identity did not match. No result was accepted.");
  }
  return result;
}
