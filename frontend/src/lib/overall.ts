/**
 * Overall assembly result: the single user-facing verdict.
 *
 * Semantic status (shape/color/arrangement) is only one input. A failed
 * mandatory print, face or geometry gate — or a backend workflow state
 * of correction_required / still_incorrect / uncertain — always wins
 * over a green semantic assessment. `verified` requires the backend's
 * recorded verified progress, never an inspection alone.
 */

export type OverallKind =
  | "verified"
  | "incorrect"
  | "uncertain"
  | "correct"
  | "inspecting"
  | "error";

export interface OverallInput {
  state?: string | null;
  status?: string | null;
  stepVerified?: boolean;
  printGate?: string | null;
  faceStatus?: string | null;
  geometryStatus?: string | null;
  geometryConstrained?: boolean;
}

export interface OverallResult {
  kind: OverallKind;
  headline: string;
  detail: string;
}

export function overallResult(input: OverallInput): OverallResult {
  const failed =
    input.printGate === "fail" ||
    input.faceStatus === "incorrect" ||
    (input.geometryConstrained && input.geometryStatus === "incorrect") ||
    input.state === "correction_required" ||
    input.state === "still_incorrect" ||
    input.status === "incorrect";
  const uncertain =
    input.printGate === "uncertain" ||
    input.faceStatus === "uncertain" ||
    (input.geometryConstrained &&
      (input.geometryStatus === "uncertain" || input.geometryStatus === "not_measured")) ||
    input.state === "uncertain" ||
    input.status === "uncertain";
  if (input.stepVerified || input.state === "verified")
    return {
      kind: "verified",
      headline: "STEP VERIFIED",
      detail: "The backend has recorded this step as verified.",
    };
  if (failed)
    return {
      kind: "incorrect",
      headline: "OVERALL ASSEMBLY RESULT: INCORRECT",
      detail: "Correction Required — a mandatory check failed. See the issue and required action below.",
    };
  if (uncertain)
    return {
      kind: "uncertain",
      headline: "OVERALL ASSEMBLY RESULT: UNCERTAIN",
      detail: "A mandatory check could not be verified from this evidence. Capture the requested view; nothing was verified.",
    };
  if (input.state === "inspecting")
    return { kind: "inspecting", headline: "Inspecting with Meta AI…", detail: "Waiting for the validated backend result." };
  if (input.state === "error")
    return {
      kind: "error",
      headline: "OVERALL ASSEMBLY RESULT: INSPECTION FAILED",
      detail: "This is a failure, not an incorrect assembly. No step was verified.",
    };
  return {
    kind: "correct",
    headline: "OVERALL ASSEMBLY RESULT: CORRECT — FRESH VERIFICATION REQUIRED",
    detail: "All applicable mandatory checks passed this assessment. The step is not verified until a separate fresh-image verification succeeds.",
  };
}
