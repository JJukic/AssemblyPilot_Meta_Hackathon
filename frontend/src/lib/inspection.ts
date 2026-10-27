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
    method: "POST", body, signal: AbortSignal.any([signal, AbortSignal.timeout(190000)]),
  });
  if (!isInspectionResponse(result, stepId)) {
    throw new Error("The backend returned an invalid diagnosis. No result was accepted.");
  }
  return result;
}
