import { apiRequest } from "./api";
import type { Snapshot } from "@/types/assembly";
import type { InspectionResult } from "@/types/inspection";

export async function inspectSnapshot(projectId: string, stepId: string, snapshot: Snapshot, signal: AbortSignal): Promise<InspectionResult> {
  const encoded = snapshot.dataUrl.split(",")[1];
  if (!snapshot.dataUrl.startsWith("data:image/jpeg;base64,") || !encoded) throw new Error("Capture a new JPEG frame before inspecting.");
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  const body = new FormData();
  body.append("image", new Blob([bytes], { type: "image/jpeg" }), "camera-snapshot.jpg");
  body.append("project_id", projectId);
  body.append("step_id", stepId);
  const result = await apiRequest<InspectionResult>("/api/inspect", {
    method: "POST", body, signal: AbortSignal.any([signal, AbortSignal.timeout(190000)]),
  });
  if (result.step_id !== stepId || !["correct", "incorrect", "uncertain"].includes(result.status) ||
      !Array.isArray(result.issues) || !Array.isArray(result.visible_blocks) ||
      typeof result.explanation !== "string" || typeof result.next_action !== "string") {
    throw new Error("The backend returned an invalid diagnosis. No result was accepted.");
  }
  return result;
}
