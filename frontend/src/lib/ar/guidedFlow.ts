/**
 * Guided HoloLens assembly flow (pure, testable).
 *
 * One short visible instruction ("Place the red 2×4 brick on the green
 * marker."), one clear state and at most two large contextual buttons.
 * The state is derived ONLY from real data: server progress, the latest
 * inspection summary for this step, a running check, and an explicit
 * user confirmation. Nothing here marks a step verified.
 *
 * Confirm Position is a visible manual fallback when the automatic
 * check is uncertain or unavailable. It is recorded as USER-confirmed, never
 * as AI/backend verification, and is never triggered by voice.
 */

export type GuideState =
  | "placing"
  | "ready"
  | "checking"
  | "almost"
  | "correct"
  | "retry"
  | "partial"
  | "error"
  | "confirmed"
  | "complete";

export type GuideAction = "verify" | "next" | "confirm" | "finish" | "restart";
export type GuideTone = "ready" | "info" | "ok" | "warn" | "bad";

export interface GuideButton {
  id: GuideAction;
  label: string;
}

export interface GuideView {
  state: GuideState;
  /** Short state label for the status pill. */
  label: string;
  /** One short sentence: what happened / what to do now. */
  message: string;
  tone: GuideTone;
  /** Colour of the tabletop target marker (hex). */
  marker: number;
  /** Ghost-model tint, or null to keep the neutral transparent ghost. */
  ghostTint: number | null;
  buttons: GuideButton[];
}

export interface GuideInput {
  /** null when not in immersive AR (2D page). */
  anchored: boolean | null;
  checking: boolean;
  serverVerified: boolean;
  manuallyConfirmed: boolean;
  isLastStep: boolean;
  /** Finish was selected and the backend confirmed the last step (assembly complete). */
  finished?: boolean;
  /**
   * After Restart Assembly: this step is verified on the server from an EARLIER
   * run (not re-checked in the current one). Shown truthfully, never cleared.
   */
  verifiedEarlier?: boolean;
  /** The last check could not even run (e.g. camera unavailable); shown instead of an older result. */
  checkError?: string | null;
  /** Latest inspection summary for THIS step (null when none). */
  summary: {
    kind: "inspection" | "verification" | "error" | "inspecting";
    overall: { kind: string } | null;
  } | null;
}

export const MARKER = {
  target: 0x2ee66b,
  correct: 0x2ee66b,
  wrong: 0xff3b3b,
  partial: 0xffd23f,
} as const;

const NEXT: GuideButton = { id: "next", label: "Next Step ▶" };
const CHECK: GuideButton = { id: "verify", label: "Check Step" };
const RECHECK: GuideButton = { id: "verify", label: "Check Again" };
const CONFIRM: GuideButton = { id: "confirm", label: "Confirm Position" };
/** Only on the LAST step, only once the backend verified it (server progress). */
const FINISH: GuideButton = { id: "finish", label: "Finish" };
/** After Finish: start the assembly again from Step 1 (new local run). */
const RESTART: GuideButton = { id: "restart", label: "Restart Assembly" };

export function deriveGuide(input: GuideInput): GuideView {
  const done = (state: GuideState, label: string, message: string): GuideView => ({
    state, label, message, tone: "ok", marker: MARKER.correct, ghostTint: MARKER.correct,
    buttons: input.isLastStep ? [] : [NEXT],
  });
  if (input.serverVerified && input.verifiedEarlier && !input.finished)
    // Restarted run: the server still says verified (kept, not erased); a new check is optional.
    return {
      ...done("correct", "Verified earlier", input.isLastStep
        ? "Verified in an earlier run. Select Check Again for a new check, or Finish."
        : "Verified in an earlier run. Select Check Again for a new check, or Next Step."),
      buttons: [input.isLastStep ? FINISH : NEXT, RECHECK],
    };
  if (input.serverVerified)
    return input.isLastStep
      ? input.finished
        ? { ...done("complete", "Assembly complete", "Build finished — the final step was verified by Meta."), buttons: [RESTART] }
        : { ...done("complete", "Final step correct", "Last step verified. Select Finish to complete the assembly."), buttons: [FINISH] }
      : done("correct", "Correct", "Step correct.");
  if (input.manuallyConfirmed)
    return input.isLastStep
      ? { ...done("complete", "Confirmed", "Position confirmed by you (not AI verified). Final step."), tone: "warn" }
      : { ...done("confirmed", "Confirmed", "Position confirmed by you (not AI verified)."), tone: "warn" };
  if (input.anchored === false)
    return {
      state: "placing", label: "Place field", tone: "info", marker: MARKER.target, ghostTint: null,
      message: "Rotate the field to match your baseplate, then select Confirm Assembly Field.", buttons: [],
    };
  // The image is with Meta only once the in-progress summary exists (set right before the upload);
  // before that the check is still capturing / validating the frame locally.
  if (input.summary?.kind === "inspecting")
    return { state: "checking", label: "Inspecting by Meta…", message: "Hold still — the result appears here.", tone: "info", marker: MARKER.target, ghostTint: null, buttons: [] };
  if (input.checking)
    return { state: "checking", label: "Capturing image…", message: "Hold still — capturing a fresh image.", tone: "info", marker: MARKER.target, ghostTint: null, buttons: [] };
  if (input.checkError)
    return { state: "error", label: "Check unavailable", message: input.checkError, tone: "warn", marker: MARKER.partial, ghostTint: null, buttons: [RECHECK, CONFIRM] };
  const s = input.summary;
  if (!s) return { state: "ready", label: "Ready", message: "Place the brick, then select Check Step.", tone: "ready", marker: MARKER.target, ghostTint: null, buttons: [CHECK] };
  if (s.kind === "error")
    return { state: "error", label: "Check unavailable", message: "Check the camera or connection, or confirm the position yourself.", tone: "warn", marker: MARKER.partial, ghostTint: null, buttons: [RECHECK, CONFIRM] };
  switch (s.overall?.kind) {
    case "verified":
      // Finish needs the SAVED server progress; until it is loaded no completion is claimed.
      return input.isLastStep
        ? { ...done("complete", "Final step correct", "Saving progress — Finish appears once it is confirmed."), buttons: [] }
        : done("correct", "Correct", "Step correct.");
    case "correct":
      // An inspection said correct; the separate fresh verification is still missing.
      return { state: "almost", label: "Almost correct", message: "Looks correct — select Check Again for a fresh verification image.", tone: "ok", marker: MARKER.correct, ghostTint: null, buttons: [RECHECK] };
    case "incorrect":
      return { state: "retry", label: "Try again", message: "Adjust the brick.", tone: "bad", marker: MARKER.wrong, ghostTint: MARKER.wrong, buttons: [RECHECK] };
    case "uncertain":
      return { state: "partial", label: "Position uncertain", message: "Meta could not decide. Select Check Again, or Confirm Position if the brick is placed correctly.", tone: "warn", marker: MARKER.partial, ghostTint: MARKER.partial, buttons: [RECHECK, CONFIRM] };
    default:
      return { state: "error", label: "Check unavailable", message: "No valid result — check again or confirm the position.", tone: "warn", marker: MARKER.partial, ghostTint: null, buttons: [RECHECK, CONFIRM] };
  }
}

const COLOR_EN: Record<string, string> = {
  red: "red", rot: "red", blue: "blue", blau: "blue", yellow: "yellow", gelb: "yellow",
  green: "green", "grün": "green", gruen: "green", white: "white", "weiß": "white", weiss: "white",
  black: "black", schwarz: "black", gray: "gray", grey: "gray", grau: "gray",
  orange: "orange", brown: "brown", braun: "brown", pink: "pink", purple: "purple", lila: "purple",
};

/** English display guidance from structured data; stored names are preserved. */
export function shortInstruction(
  blocks: { color: string; name: string; quantity: number }[],
  hasMarker: boolean,
): string {
  const where = hasMarker ? "on the green marker" : "in the assembly field";
  const first = blocks[0];
  if (!first) return "No bricks in this step — continue to the next step.";
  const color = COLOR_EN[first.color.trim().toLowerCase()] ?? "";
  const size = first.name.match(/(\d+)\s*[x×]\s*(\d+)/i);
  const count = first.quantity > 1 ? String(first.quantity) : "the";
  const shape = size ? `${size[1]}×${size[2]} ` : "";
  const name = size ? "" : ` “${first.name.trim().slice(0, 24)}”`;
  const noun = first.quantity > 1 ? "bricks" : "brick";
  const more = blocks.length > 1 ? " (and the remaining bricks)" : "";
  return `Place ${count} ${color ? color + " " : ""}${shape}${noun}${name}${more} ${where}.`;
}
