import { isWorkflowInspection, isVerificationResponse, validateSnapshotIdentity } from "./workflow";
import type { WorkflowInspection, VerificationResponse, StepProgress } from "@/types/workflow";
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
  if ("state" in result) {
    if (!isWorkflowInspection(result, stepId) || !["correct", "correction_required", "uncertain"].includes(result.state)) throw new Error("Invalid inspection workflow response.");
    await validateSnapshotIdentity(result);
  }
  if (result.snapshot_id && !("state" in result)) {
    const bytes = Uint8Array.from(atob(result.analyzed_snapshot.data_url.split(",")[1]), (char) => char.charCodeAt(0));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const identity = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (identity !== result.snapshot_id) throw new Error("The analyzed snapshot identity did not match.");
  }
  return result;
}


export async function verifySnapshot(projectId: string, previous: WorkflowInspection, snapshot: Snapshot, signal: AbortSignal): Promise<VerificationResponse> {
  const body = new FormData();
  body.append("image", snapshotFile(snapshot, "verification-snapshot.jpg"));
  body.append("project_id", projectId); body.append("step_id", previous.step_id);
  body.append("previous_inspection_id", previous.inspection_id);
  const result = await apiRequest<unknown>("/api/verify", { method: "POST", body, signal: AbortSignal.any([signal, AbortSignal.timeout(310000)]) });
  if (!isVerificationResponse(result, previous)) throw new Error("Invalid verification evidence. No verification was accepted.");
  await validateSnapshotIdentity(result.inspection);
  return result;
}

export async function getProgress(projectId: string): Promise<StepProgress[]> {
  const result = await apiRequest<StepProgress[]>(`/api/projects/${projectId}/progress`);
  if (!Array.isArray(result) || !result.every((item) => item && typeof item.step_id === "string" && /^[a-f0-9]{64}$/.test(item.specification_id) &&
      ["not_started", "in_progress", "verified"].includes(item.status) && (item.status !== "verified" || (typeof item.verified_at === "string" && Number.isFinite(Date.parse(item.verified_at)))))) throw new Error("Invalid project progress response.");
  return result;
}
