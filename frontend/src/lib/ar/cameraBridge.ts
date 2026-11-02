/**
 * External-camera bridge client (see backend/app/api/ar_camera.py).
 * Only bounded, validated result summaries cross devices — never frames.
 */
import { apiRequest } from "../api";
import {
  validateSummary,
  type InspectionSummary,
} from "./inspectionResult";

export interface BridgeResult {
  summary: Record<string, unknown>;
  mode: string;
  updated_at: number;
}

export function newPairingCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export const validPairingCode = (code: string) => /^[A-Za-z0-9]{6,12}$/.test(code);

export async function requestExternalCapture(
  projectId: string,
  stepId: string,
  code: string,
  mode: "inspect" | "verify",
): Promise<string> {
  const result = await apiRequest<{ id: string }>("/api/ar-camera/requests", {
    method: "POST",
    body: JSON.stringify({ project_id: projectId, step_id: stepId, code, mode }),
  });
  return result.id;
}

export async function pendingExternalRequests(
  projectId: string,
  code: string,
): Promise<{ id: string; step_id: string; mode: string }[]> {
  return apiRequest(`/api/ar-camera/requests/pending?project_id=${encodeURIComponent(projectId)}&code=${encodeURIComponent(code)}`);
}

export async function claimExternalRequest(id: string, code: string): Promise<void> {
  await apiRequest(`/api/ar-camera/requests/${id}/claim`, {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export async function postExternalResult(
  id: string,
  code: string,
  summary: InspectionSummary,
): Promise<void> {
  await apiRequest(`/api/ar-camera/requests/${id}/result`, {
    method: "POST",
    body: JSON.stringify({ code, summary: bridgeSummary(summary) }),
  });
}

export async function latestExternalResult(
  projectId: string,
  stepId: string,
  code: string,
): Promise<BridgeResult | null> {
  const result = await apiRequest<{ result: BridgeResult | null }>(
    `/api/ar-camera/result?project_id=${encodeURIComponent(projectId)}&step_id=${encodeURIComponent(stepId)}&code=${encodeURIComponent(code)}`,
  );
  return result.result;
}

/** Strip a local summary to exactly the bridge's bounded fields. */
export function bridgeSummary(summary: InspectionSummary): Record<string, unknown> {
  return {
    kind: summary.kind,
    state: summary.state,
    status: summary.status,
    explanation: summary.explanation,
    issues: summary.issues,
    correctionPlan: summary.correctionPlan,
    nextAction: summary.nextAction,
    errorMessage: summary.errorMessage,
    verificationStatus: summary.verificationStatus,
    specificationId: summary.specificationId,
    inspectionId: summary.inspectionId,
    snapshotId: summary.snapshotId,
    overall: summary.overall,
  };
}

/** Rebuild + validate a local summary from an untrusted bridge payload. */
export function summaryFromBridge(
  payload: BridgeResult,
  projectId: string,
  stepId: string,
  specificationId?: string | null,
): InspectionSummary | null {
  const raw = payload.summary as Record<string, unknown>;
  const candidate = {
    ...raw,
    projectId,
    stepId,
    activeVision: null,
    updatedAt: new Date(payload.updated_at * 1000).toISOString(),
  };
  const summary = validateSummary(candidate);
  if (!summary) return null;
  if (specificationId && summary.specificationId && summary.specificationId !== specificationId)
    return null;
  return summary;
}
