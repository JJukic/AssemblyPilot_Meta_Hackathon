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
  /** Request that produced this result (absent only on legacy, unscoped reads). */
  request_id?: string;
  project_id?: string;
  step_id?: string;
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
  requestId?: string,
): Promise<BridgeResult | null> {
  const scope = requestId ? `&request_id=${encodeURIComponent(requestId)}` : "";
  const result = await apiRequest<{ result: BridgeResult | null }>(
    `/api/ar-camera/result?project_id=${encodeURIComponent(projectId)}&step_id=${encodeURIComponent(stepId)}&code=${encodeURIComponent(code)}${scope}`,
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

/** One external capture request issued by this device (identity of everything we accept). */
export interface ExternalRequest {
  requestId: string;
  projectId: string;
  stepId: string;
  code: string;
  /** Step specification revision when the request was issued (local guidance revision). */
  spec: string;
  /** Backend specification id, when known; a result for another spec is rejected. */
  specificationId?: string | null;
}

/**
 * Accept a bridge payload only as the answer to exactly `request`: same request
 * id, project, step and pairing code, unchanged step specification, and a
 * summary that validates. Anything else (an older result, another step, a
 * changed spec) is rejected — never shown, never used to verify.
 */
export function acceptExternalResult(
  payload: BridgeResult | null,
  request: ExternalRequest,
  current: { projectId: string; stepId: string | null; code: string; spec: string },
): InspectionSummary | null {
  if (!payload) return null;
  if (payload.request_id !== request.requestId) return null;
  if (payload.project_id !== undefined && payload.project_id !== request.projectId) return null;
  if (payload.step_id !== undefined && payload.step_id !== request.stepId) return null;
  if (current.projectId !== request.projectId || current.stepId !== request.stepId) return null;
  if (current.code !== request.code || current.spec !== request.spec) return null;
  return summaryFromBridge(payload, request.projectId, request.stepId, request.specificationId);
}

/**
 * Owns the single active external capture request of this page. Starting a
 * new request, a step change, Stop and unmount all invalidate the previous
 * one; a poll that resolves for a request that is no longer active is
 * dropped, so a late result can never set a stale state (e.g. "Step Verified").
 */
export class ExternalRequestTracker {
  private active: ExternalRequest | null = null;

  get current(): ExternalRequest | null {
    return this.active;
  }
  begin(request: ExternalRequest): ExternalRequest {
    this.active = request;
    return request;
  }
  /** Invalidate the active request (step change, Stop, unmount, Re-anchor…). */
  invalidate(): void {
    this.active = null;
  }
  isActive(request: ExternalRequest): boolean {
    return this.active === request;
  }
  /**
   * Poll once for the active request. Returns the validated summary only if
   * the request is still the active one after the network round trip; the
   * request is then consumed (exactly one result per request).
   */
  async pollOnce(
    fetchLatest: (request: ExternalRequest) => Promise<BridgeResult | null>,
    current: () => { projectId: string; stepId: string | null; code: string; spec: string },
  ): Promise<{ request: ExternalRequest; summary: InspectionSummary } | null> {
    const request = this.active;
    if (!request) return null;
    const payload = await fetchLatest(request).catch(() => null);
    if (this.active !== request) return null;
    const summary = acceptExternalResult(payload, request, current());
    if (!summary) return null;
    this.active = null;
    return { request, summary };
  }
}
