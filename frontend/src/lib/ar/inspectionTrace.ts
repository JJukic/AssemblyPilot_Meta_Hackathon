/**
 * Bounded end-to-end inspection diagnostics.
 *
 * Correlation ID = the snapshot SHA-256 fingerprint, which the backend
 * also returns as `snapshot_id` and validates — so frontend stages,
 * backend receipt and the Meta result provably describe the SAME image.
 * Only scalar metadata is kept (never image bytes); the exact frame is
 * shown separately, in memory only, via the user-activated preview.
 */

export type TraceStage =
  | "CAPTURE_REQUESTED"
  | "CAMERA_SOURCE_SELECTED"
  | "CAMERA_AVAILABLE"
  | "FRAME_CAPTURED"
  | "FRAME_VALIDATED"
  | "UPLOAD_STARTED"
  | "UPLOAD_COMPLETED"
  | "BACKEND_RECEIVED"
  | "IMAGE_DECODED"
  | "META_REQUEST_STARTED"
  | "META_RESPONSE_RECEIVED"
  | "META_RESPONSE_VALIDATED"
  | "INSPECTION_FUSED"
  | "RESULT_DELIVERED_TO_AR"
  | "AR_RESULT_RENDERED"
  | "FAILED";

export interface TraceEntry {
  stage: TraceStage;
  at: string;
  detail: string;
}

export interface InspectionDiagnostics {
  correlationId: string | null; // snapshot SHA-256
  inspectionId: string | null;
  cameraSource: string;
  projectId: string;
  stepId: string;
  capturedAt: string | null;
  width: number | null;
  height: number | null;
  encodedBytes: number | null;
  frameFresh: boolean | null;
  frameQuality: string | null;
  httpOk: boolean | null;
  metaCalled: boolean | null;
  metaModel: string | null;
  metaAttempts: number | null;
  metaLatencyMs: number | null;
  semanticStatus: string | null;
  printGate: string | null;
  faceStatus: string | null;
  geometryStatus: string | null;
  combinedState: string | null;
  uncertainCause: string | null;
  uncertainReason: string | null;
  entries: TraceEntry[];
}

const KEY = "assemblypilot.inspection-traces";
const MAX_TRACES = 20;

export function emptyDiagnostics(cameraSource: string, projectId: string, stepId: string): InspectionDiagnostics {
  return {
    correlationId: null, inspectionId: null, cameraSource, projectId, stepId,
    capturedAt: null, width: null, height: null, encodedBytes: null,
    frameFresh: null, frameQuality: null, httpOk: null, metaCalled: null,
    metaModel: null, metaAttempts: null, metaLatencyMs: null,
    semanticStatus: null, printGate: null, faceStatus: null, geometryStatus: null,
    combinedState: null, uncertainCause: null, uncertainReason: null, entries: [],
  };
}

export class InspectionTrace {
  data: InspectionDiagnostics;
  constructor(cameraSource: string, projectId: string, stepId: string) {
    this.data = emptyDiagnostics(cameraSource, projectId, stepId);
  }
  stage(stage: TraceStage, detail: string) {
    this.data.entries.push({ stage, at: new Date().toISOString(), detail });
    if (this.data.entries.length > 40) this.data.entries.splice(0, this.data.entries.length - 40);
  }
  fail(detail: string) {
    this.stage("FAILED", detail);
  }
  save() {
    try {
      const raw = sessionStorage.getItem(KEY);
      const list: InspectionDiagnostics[] = raw ? JSON.parse(raw) : [];
      list.unshift(this.data);
      sessionStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_TRACES)));
    } catch {
      /* diagnostics are best-effort; inspection never depends on them */
    }
  }
}

export function loadTraces(): InspectionDiagnostics[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** SHA-256 of the exact JPEG bytes that will be uploaded. */
export async function snapshotFingerprint(dataUrl: string): Promise<string> {
  const encoded = dataUrl.split(",")[1] ?? "";
  const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function encodedByteSize(dataUrl: string): number {
  const encoded = dataUrl.split(",")[1] ?? "";
  return Math.floor((encoded.length * 3) / 4);
}
