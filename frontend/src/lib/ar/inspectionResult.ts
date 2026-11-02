/**
 * Validated inspection-result bridge between the camera workspace and AR.
 *
 * Only a bounded, validated *summary* of the already-validated backend
 * result is handed over (sessionStorage, 30-minute TTL, scoped to project +
 * step + specification). No camera frames, data URLs, SAM masks or full
 * payloads are stored. A failed or new inspection replaces any previous
 * summary, so an old success can never pose as the current result. This is
 * the latest AI assessment — separate from officially verified progress.
 */
import type { VerificationResponse, WorkflowInspection } from "@/types/workflow";
import { overallResult, type OverallKind } from "../overall";

export interface InspectionIssueSummary {
  type: string;
  description: string;
  expected: string;
  observed: string;
  suggested_fix: string;
}
export interface TraceSummary {
  correlationId: string | null;
  inspectionId: string | null;
  cameraSource: string | null;
  capturedAt: string | null;
  width: number | null;
  height: number | null;
  frameFresh: boolean | null;
  metaCalled: boolean | null;
  metaModel: string | null;
  metaAttempts: number | null;
  metaLatencyMs: number | null;
  uncertainCause: string | null;
  uncertainReason: string | null;
}
export interface OverallSummary {
  kind: OverallKind;
  printGate: "pass" | "fail" | "uncertain" | "not_applicable" | null;
  expectedPrint: string | null;
  observedPrint: string | null;
  printAction: string | null;
  faceStatus: string | null;
  geometryStatus: string | null;
}
export interface InspectionSummary {
  overall: OverallSummary | null;
  trace?: TraceSummary | null;
  kind: "inspection" | "verification" | "error" | "inspecting";
  projectId: string;
  stepId: string;
  specificationId: string | null;
  inspectionId: string | null;
  snapshotId: string | null;
  verificationStatus: "verified" | "still_incorrect" | "uncertain" | null;
  state: string | null;
  status: "correct" | "incorrect" | "uncertain" | null;
  explanation: string;
  issues: InspectionIssueSummary[];
  correctionPlan: string[];
  nextAction: string;
  activeVision: { reason: string; requested_view: string; instruction: string } | null;
  errorMessage: string | null;
  updatedAt: string;
}

const KEY = "assemblypilot.latest-inspection-result";
const TTL_MS = 30 * 60_000;
const MAX_TEXT = 2000;

function cap(text: string): string {
  return text.slice(0, MAX_TEXT);
}

export function summarizeInspection(
  result: WorkflowInspection,
  projectId: string,
  kind: "inspection" | "verification" = "inspection",
  verificationStatus: InspectionSummary["verificationStatus"] = null,
  trace: TraceSummary | null = null,
): InspectionSummary {
  const print = result.print_recognition ?? null;
  const overall = overallResult({
    state: result.state,
    status: result.status,
    stepVerified: verificationStatus === "verified",
    printGate: print?.gate_status ?? null,
    faceStatus: result.face?.status ?? null,
    geometryStatus: result.geometry?.geometry_status ?? null,
    geometryConstrained: !!result.geometry?.constraint_id,
  });
  return {
    trace,
    overall: {
      kind: overall.kind,
      printGate: print?.gate_status ?? null,
      expectedPrint: print?.expected_print ?? null,
      observedPrint: print?.observed_print ?? null,
      printAction: print?.suggested_action ?? null,
      faceStatus: result.face?.status ?? null,
      geometryStatus: result.geometry?.geometry_status ?? null,
    },
    kind,
    projectId,
    stepId: result.step_id,
    specificationId: result.specification_id,
    inspectionId: result.inspection_id,
    snapshotId: result.snapshot_id,
    verificationStatus,
    state: result.state,
    status: result.status,
    explanation: cap(result.explanation),
    issues: result.issues.slice(0, 20).map((issue) => ({
      type: issue.type,
      description: cap(issue.description),
      expected: cap(issue.expected),
      observed: cap(issue.observed),
      suggested_fix: cap(issue.suggested_fix),
    })),
    correctionPlan: result.correction_plan.slice(0, 20).map((a) => cap(a.instruction)),
    nextAction: cap(result.next_action),
    activeVision: result.active_vision
      ? {
          reason: cap(result.active_vision.reason),
          requested_view: result.active_vision.requested_view,
          instruction: cap(result.active_vision.instruction),
        }
      : null,
    errorMessage: null,
    updatedAt: new Date().toISOString(),
  };
}

export function summarizeVerification(
  response: VerificationResponse,
  projectId: string,
  trace: TraceSummary | null = null,
): InspectionSummary {
  return summarizeInspection(response.inspection, projectId, "verification", response.status, trace);
}

export function errorSummary(
  projectId: string,
  stepId: string,
  message: string,
  specificationId: string | null = null,
): InspectionSummary {
  return {
    overall: null,
    trace: null,
    kind: "error",
    projectId,
    stepId,
    specificationId,
    inspectionId: null,
    snapshotId: null,
    verificationStatus: null,
    state: "error",
    status: null,
    explanation: "",
    issues: [],
    correctionPlan: [],
    nextAction: "",
    activeVision: null,
    errorMessage: cap(message),
    updatedAt: new Date().toISOString(),
  };
}

export function inspectingSummary(
  projectId: string,
  stepId: string,
): InspectionSummary {
  return { ...errorSummary(projectId, stepId, ""), kind: "inspecting", state: "inspecting", errorMessage: null };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function isText(v: unknown, max = MAX_TEXT): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= max;
}
function isOptText(v: unknown): v is string | null {
  return v === null || isText(v, 200);
}

/** Runtime-validate an untrusted stored summary before displaying it. */
export function validateSummary(value: unknown): InspectionSummary | null {
  if (!isRecord(value)) return null;
  if (!["inspection", "verification", "error", "inspecting"].includes(String(value.kind)))
    return null;
  if (!isText(value.projectId, 100) || !isText(value.stepId, 100)) return null;
  if (!isOptText(value.specificationId) || !isOptText(value.inspectionId) || !isOptText(value.snapshotId))
    return null;
  if (
    !(
      value.verificationStatus === null ||
      ["verified", "still_incorrect", "uncertain"].includes(String(value.verificationStatus))
    )
  )
    return null;
  if (
    !(
      value.status === null ||
      ["correct", "incorrect", "uncertain"].includes(String(value.status))
    )
  )
    return null;
  if (typeof value.explanation !== "string" || value.explanation.length > MAX_TEXT) return null;
  if (typeof value.nextAction !== "string" || value.nextAction.length > MAX_TEXT) return null;
  if (!(value.errorMessage === null || isText(value.errorMessage))) return null;
  if (!isText(value.updatedAt, 40) || !Number.isFinite(Date.parse(value.updatedAt))) return null;
  if (!Array.isArray(value.issues) || value.issues.length > 20) return null;
  for (const issue of value.issues) {
    if (!isRecord(issue)) return null;
    if (
      !isText(issue.type, 60) ||
      !isText(issue.description) ||
      !isText(issue.expected) ||
      !isText(issue.observed) ||
      !isText(issue.suggested_fix)
    )
      return null;
  }
  if (
    !Array.isArray(value.correctionPlan) ||
    value.correctionPlan.length > 20 ||
    !value.correctionPlan.every((line) => isText(line))
  )
    return null;
  const vision = value.activeVision;
  if (
    !(
      vision === null ||
      (isRecord(vision) && isText(vision.reason) && isText(vision.requested_view, 60) && isText(vision.instruction))
    )
  )
    return null;
  if (!(value.state === null || isText(value.state, 60))) return null;
  if (value.trace !== undefined && value.trace !== null) {
    const t = value.trace;
    if (!isRecord(t)) return null;
    if (![t.correlationId, t.inspectionId, t.cameraSource, t.capturedAt, t.metaModel, t.uncertainCause, t.uncertainReason]
      .every((v) => v === null || (typeof v === "string" && v.length <= MAX_TEXT))) return null;
    if (![t.width, t.height, t.metaAttempts, t.metaLatencyMs]
      .every((v) => v === null || (typeof v === "number" && Number.isFinite(v)))) return null;
    if (![t.frameFresh, t.metaCalled].every((v) => v === null || typeof v === "boolean")) return null;
  }
  if (value.overall !== undefined && value.overall !== null) {
    const o = value.overall;
    if (!isRecord(o)) return null;
    if (!["verified", "incorrect", "uncertain", "correct", "inspecting", "error"].includes(String(o.kind))) return null;
    if (!(o.printGate === null || ["pass", "fail", "uncertain", "not_applicable"].includes(String(o.printGate)))) return null;
    if (![o.expectedPrint, o.observedPrint, o.printAction].every((v) => v === null || (typeof v === "string" && v.length <= MAX_TEXT))) return null;
    if (![o.faceStatus, o.geometryStatus].every((v) => v === null || isText(v, 60))) return null;
  }
  return value as unknown as InspectionSummary;
}

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
export function saveInspectionSummary(summary: InspectionSummary) {
  try {
    storage()?.setItem(KEY, JSON.stringify(summary));
  } catch {
    /* storage unavailable: in-session history still shows the result */
  }
}
export function clearInspectionSummary() {
  try {
    storage()?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
/**
 * Load the latest summary only when it belongs to exactly this project and
 * step, is fresh, and — when the caller knows the current specification —
 * was produced against that specification. Anything else is stale: drop it.
 */
export function loadInspectionSummary(
  projectId: string,
  stepId: string,
  specificationId?: string | null,
  now = Date.now(),
): InspectionSummary | null {
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return null;
    const summary = validateSummary(JSON.parse(raw));
    if (!summary) {
      clearInspectionSummary();
      return null;
    }
    if (summary.projectId !== projectId || summary.stepId !== stepId) return null;
    if (now - Date.parse(summary.updatedAt) > TTL_MS) {
      clearInspectionSummary();
      return null;
    }
    if (
      specificationId &&
      summary.specificationId &&
      summary.specificationId !== specificationId
    ) {
      clearInspectionSummary();
      return null;
    }
    return summary;
  } catch {
    return null;
  }
}

export type ResultTone =
  | "correct"
  | "incorrect"
  | "uncertain"
  | "error"
  | "inspecting"
  | "verified";

export function resultHeadline(
  summary: InspectionSummary | null,
  stepVerified: boolean,
): { text: string; tone: ResultTone } | null {
  if (!summary) return null;
  if (summary.kind === "inspecting")
    return { text: "Inspecting with Meta AI…", tone: "inspecting" };
  if (summary.kind === "error")
    return { text: "Inspection Failed", tone: "error" };
  // Overall (all mandatory gates) wins over the semantic-only status. For
  // summaries stored before `overall` existed, the backend workflow state
  // is the authority — a correct semantic status with a failed print gate
  // arrives as correction_required and must never headline as Correct.
  const overall = overallResult({
    state: summary.state,
    status: summary.status,
    stepVerified: stepVerified || summary.verificationStatus === "verified",
    printGate: summary.overall?.printGate ?? null,
    faceStatus: summary.overall?.faceStatus ?? null,
    geometryStatus: summary.overall?.geometryStatus ?? null,
    geometryConstrained: !!summary.overall?.geometryStatus,
  });
  if (overall.kind === "verified") return { text: "✓ Step Verified", tone: "verified" };
  if (overall.kind === "incorrect") return { text: "✗ Incorrect — Correction Required", tone: "incorrect" };
  if (overall.kind === "uncertain") return { text: "? Uncertain — Another View Needed", tone: "uncertain" };
  if (overall.kind === "error") return { text: "Inspection Failed", tone: "error" };
  return { text: "AI Assessment: Correct — fresh verification required", tone: "correct" };
}

/** Full, untruncated result lines for the paginated XR panel. */
export function resultLines(
  summary: InspectionSummary,
  stepVerified: boolean,
  errorsOnly = false,
): string[] {
  const lines: string[] = [];
  if (summary.kind === "error") {
    lines.push(`Error: ${summary.errorMessage ?? "Inspection failed"}`);
    lines.push("This is a failure, not an incorrect assembly.");
    lines.push("Check the connection, then say Verify Step to try again.");
    return lines;
  }
  if (summary.kind === "inspecting") {
    lines.push("Capturing and inspecting a fresh camera frame…");
    return lines;
  }
  lines.push(
    stepVerified || summary.verificationStatus === "verified"
      ? "Step verified: Yes"
      : summary.status === "correct"
        ? "Step verified: No — fresh verification required"
        : "Step verified: No",
  );
  const overall = summary.overall;
  if (overall?.printGate === "fail") {
    lines.push("Problem: Wrong printed side — the observed print does not match the required side.");
    lines.push(`Expected: ${overall.expectedPrint ?? "registered required print"}`);
    lines.push(`Observed: ${overall.observedPrint ?? "not read"}`);
    if (overall.printAction) lines.push(`Suggested action: ${overall.printAction}`);
  } else if (overall?.printGate === "uncertain") {
    lines.push("Problem: The required printed side or its orientation could not be verified.");
    lines.push(`Expected: ${overall.expectedPrint ?? "registered required print"}`);
    lines.push(`Observed: ${overall.observedPrint ?? "not read"}`);
    if (overall.printAction) lines.push(`Suggested action: ${overall.printAction}`);
  }
  const trace = summary.trace;
  if (trace?.metaCalled) {
    lines.push(`Meta called: YES (${trace.metaModel ?? "model unknown"} · ${trace.metaAttempts ?? "?"} attempt(s)${trace.metaLatencyMs !== null && trace.metaLatencyMs !== undefined ? ` · ${(trace.metaLatencyMs / 1000).toFixed(1)} s` : ""})`);
    lines.push(`Frame: ${trace.width ?? "?"}x${trace.height ?? "?"} · fresh ${trace.frameFresh ? "YES" : "unknown"} · via ${trace.cameraSource ?? "camera"}`);
  } else if (trace) {
    lines.push("Meta called: NO — no successful Meta assessment for this result.");
  }
  if (trace?.uncertainReason && (summary.state === "uncertain" || overall?.kind === "uncertain"))
    lines.push(`Uncertain cause (${trace.uncertainCause ?? "unknown"}): ${trace.uncertainReason}`);
  if (overall?.faceStatus === "incorrect") lines.push("Problem: Wrong face/orientation for this step.");
  if (overall?.geometryStatus === "incorrect") lines.push("Problem: Geometric check failed for this step.");
  if (!errorsOnly && summary.explanation) lines.push(summary.explanation);
  summary.issues.forEach((issue, i) => {
    lines.push(`Issue ${i + 1} (${issue.type}): ${issue.description}`);
    lines.push(`Expected: ${issue.expected}`);
    lines.push(`Observed: ${issue.observed}`);
    lines.push(`Fix: ${issue.suggested_fix}`);
  });
  if (errorsOnly && !summary.issues.length) lines.push("No issues were reported.");
  if (!errorsOnly && summary.correctionPlan.length) {
    lines.push("Correction plan:");
    summary.correctionPlan.forEach((line, i) => lines.push(`${i + 1}. ${line}`));
  }
  if (!errorsOnly && summary.activeVision) {
    lines.push(
      `Additional view needed (${summary.activeVision.requested_view}): ${summary.activeVision.reason}`,
    );
    lines.push(summary.activeVision.instruction);
  }
  if (!errorsOnly && summary.nextAction) lines.push(`Next: ${summary.nextAction}`);
  return lines;
}
