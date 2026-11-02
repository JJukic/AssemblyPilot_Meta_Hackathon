/**
 * Autonomous Assembly state machine (pure, testable).
 *
 * This machine only decides WHEN an existing Meta inspection or
 * fresh-image verification is justified and when the verified step may
 * advance. It never marks anything verified: advancement requires the
 * caller to confirm server progress for the exact project/step first.
 *
 * Verification policy (two independent observations):
 *   change → /api/inspect → "correct" → LATER fresh frame → /api/verify
 *   against that correct inspection → backend "verified" → advance.
 * After an incorrect/uncertain result the next paid call is a NEW
 * /api/inspect, never a verify — a single repaired frame cannot verify.
 *
 * Cost: at most one outstanding request, a cooldown between automatic
 * inspections, per-step and per-session caps, and exponential backoff
 * after failures. Every state has an exit (resume, recovery, stop).
 */

export type AutoState =
  | "idle"
  | "camera_initializing"
  | "calibrating"
  | "anchoring"
  | "monitoring"
  | "change_detected"
  | "waiting_for_stability"
  | "waiting_for_view"
  | "selecting_frame"
  | "ready_to_inspect"
  | "inspecting"
  | "correct_awaiting_verification"
  | "correction_required"
  | "awaiting_correction"
  | "verifying"
  | "verified"
  | "advancing_step"
  | "uncertain"
  | "camera_unavailable"
  | "tracking_lost"
  | "inspection_failed"
  | "budget_exhausted"
  | "error"
  | "paused"
  | "completed";

export type AutoIntent = "inspect" | "verify" | "advance" | "none";

/** Why a request did not produce a visual judgment. Never shown as "Uncertain". */
export type FailureKind =
  | "camera"
  | "transport"
  | "provider"
  | "conflict"
  | "stale"
  | "rejected"
  | "backend"
  | "invalid_response"
  | "aborted";

export interface AutoConfig {
  /** Minimum time between automatic inspections (cost control). */
  minIntervalMs: number;
  /** Minimum time between a "correct" inspection and its fresh verification frame. */
  verifyDelayMs: number;
  maxAutoPerStep: number;
  maxPerSession: number;
  /** Consecutive failures before monitoring stops in "error" (needs Resume). */
  maxConsecutiveFailures: number;
}

export const DEFAULT_AUTO: AutoConfig = {
  minIntervalMs: 20_000,
  verifyDelayMs: 5_000,
  maxAutoPerStep: 4,
  maxPerSession: 12,
  maxConsecutiveFailures: 3,
};

const TRIGGERABLE: AutoState[] = [
  "monitoring", "change_detected", "waiting_for_stability", "waiting_for_view", "selecting_frame",
  "ready_to_inspect", "awaiting_correction", "correct_awaiting_verification", "uncertain",
  "correction_required", "inspection_failed",
];

export class AutonomousMachine {
  state: AutoState = "idle";
  projectId = "";
  stepId = "";
  inspectionsUsed = 0;
  sessionUsed = 0;
  initialAssessmentArmed = false;
  initialAssessmentUsed = false;
  lastRequestAt = 0;
  /** Time the current "correct" inspection result arrived (verification clock). */
  correctAt = 0;
  hasInspection = false;
  consecutiveFailures = 0;
  lastFailure: FailureKind | null = null;
  lastOutcome: "correct" | "incorrect" | "uncertain" | "error" | null = null;
  private outstanding = false;
  private advancedFor = "";
  private pausedFrom: AutoState = "monitoring";
  private config: AutoConfig;
  constructor(config: Partial<AutoConfig> = {}) {
    this.config = { ...DEFAULT_AUTO, ...config };
  }

  get busy() {
    return this.outstanding;
  }
  get limits() {
    return { ...this.config };
  }
  get remaining() {
    return {
      step: Math.max(0, this.config.maxAutoPerStep - this.inspectionsUsed),
      session: Math.max(0, this.config.maxPerSession - this.sessionUsed),
    };
  }

  start(projectId: string, stepId: string) {
    this.projectId = projectId;
    this.sessionUsed = 0;
    this.initialAssessmentUsed = false;
    this.consecutiveFailures = 0;
    this.advancedFor = "";
    this.beginStep(stepId);
    this.state = "camera_initializing";
  }

  /** One controlled assessment of an already-placed, stable construction. */
  armInitialAssessment() {
    if (!this.initialAssessmentUsed) this.initialAssessmentArmed = true;
  }
  noteInitialAssessment() {
    this.initialAssessmentArmed = false;
    this.initialAssessmentUsed = true;
  }

  private beginStep(stepId: string) {
    this.stepId = stepId;
    this.inspectionsUsed = 0;
    this.lastRequestAt = 0;
    this.correctAt = 0;
    this.hasInspection = false;
    this.lastOutcome = null;
    this.outstanding = false;
  }

  cameraReady(calibrated: boolean) {
    if (this.state === "camera_initializing")
      this.state = calibrated ? "anchoring" : "calibrating";
  }
  calibrated() {
    if (this.state === "calibrating") this.state = "anchoring";
  }
  /** Field anchored (or not applicable): start/resume watching. */
  anchored() {
    if (["anchoring", "tracking_lost"].includes(this.state)) this.state = this.resumeTarget();
  }
  /** Waiting for the user to (re)place the field. */
  awaitAnchor() {
    if (["monitoring", "change_detected", "waiting_for_stability", "waiting_for_view", "uncertain",
      "correction_required", "awaiting_correction", "correct_awaiting_verification", "inspection_failed"].includes(this.state))
      this.state = "anchoring";
  }
  anchorLost() {
    if (!["idle", "completed", "paused", "error", "budget_exhausted", "camera_unavailable"].includes(this.state) && !this.outstanding)
      this.state = "tracking_lost";
  }
  cameraUnavailable() {
    if (!["idle", "completed", "paused"].includes(this.state) && !this.outstanding) this.state = "camera_unavailable";
  }
  /** Frames advance again: continue where the step left off (no stuck "initializing"). */
  cameraRecovered() {
    if (this.state === "camera_unavailable") this.state = "anchoring";
  }

  private resumeTarget(): AutoState {
    if (this.lastOutcome === "correct" && this.hasInspection) return "correct_awaiting_verification";
    if (this.lastOutcome === "incorrect") return "correction_required";
    if (this.lastOutcome === "uncertain") return "uncertain";
    return "monitoring";
  }

  pause() {
    if (!["idle", "completed", "paused"].includes(this.state)) {
      this.pausedFrom = this.state;
      this.state = "paused";
    }
  }
  resume() {
    if (this.state === "paused") {
      this.state = ["inspecting", "verifying", "selecting_frame"].includes(this.pausedFrom)
        ? this.resumeTarget()
        : this.pausedFrom;
    } else if (this.state === "error") {
      this.consecutiveFailures = 0;
      this.state = "anchoring";
    } else if (this.state === "camera_unavailable") {
      this.state = "anchoring";
    }
  }
  stop() {
    this.state = "idle";
    this.outstanding = false;
  }

  /** Local evidence of an assembly change (never a paid call by itself). */
  changeDetected() {
    if (["monitoring", "waiting_for_view"].includes(this.state)) this.state = "change_detected";
    else if (this.state === "correction_required") this.state = "awaiting_correction";
  }
  stabilizing() {
    if (["change_detected", "awaiting_correction"].includes(this.state))
      this.state = "waiting_for_stability";
  }
  waitingForView() {
    if (["monitoring", "change_detected", "waiting_for_stability", "awaiting_correction", "uncertain"].includes(this.state))
      this.state = "waiting_for_view";
  }

  /** Which paid call the next trigger would make. */
  get nextIntent(): "inspect" | "verify" {
    // Derived from the last RESULT, not the transient state (selecting_frame
    // must not flip a pending verification into a new inspection).
    return this.lastOutcome === "correct" && this.hasInspection ? "verify" : "inspect";
  }

  /** Pure gate (no side effects) — checked BEFORE spending effort on frame selection. */
  canTrigger(now: number, opts: { manual?: boolean } = {}): { ok: boolean; intent: "inspect" | "verify"; reason?: string } {
    const intent = this.nextIntent;
    if (!TRIGGERABLE.includes(this.state)) return { ok: false, intent, reason: `Autonomous mode is ${this.state}` };
    if (this.outstanding) return { ok: false, intent, reason: "A Meta request is already running" };
    if (this.inspectionsUsed >= this.config.maxAutoPerStep)
      return { ok: false, intent, reason: `Automatic inspection limit (${this.config.maxAutoPerStep}) reached for this step — use Verify Step or Inspect Now` };
    if (this.sessionUsed >= this.config.maxPerSession)
      return { ok: false, intent, reason: `Session Meta budget (${this.config.maxPerSession}) reached — stop and restart Autonomous Assembly to continue` };
    if (!opts.manual) {
      if (intent === "verify") {
        if (now - this.correctAt < this.config.verifyDelayMs)
          return { ok: false, intent, reason: "Waiting a moment before taking the separate verification frame" };
      } else if (this.lastRequestAt > 0) {
        const backoff = this.config.minIntervalMs * 2 ** Math.max(0, this.consecutiveFailures - 1);
        if (now - this.lastRequestAt < backoff)
          return { ok: false, intent, reason: this.consecutiveFailures
            ? `Backing off after a failure — next automatic attempt in ${Math.ceil((backoff - (now - this.lastRequestAt)) / 1000)} s`
            : `Inspection cooldown — next automatic Meta request possible in ${Math.ceil((backoff - (now - this.lastRequestAt)) / 1000)} s` };
      }
    }
    return { ok: true, intent };
  }

  noteSelecting() {
    if (TRIGGERABLE.includes(this.state)) this.state = "selecting_frame";
  }
  /** Frame selection found no usable frame: nothing was sent, nothing spent. */
  frameRejected() {
    if (this.state === "selecting_frame") this.state = this.resumeTarget() === "monitoring" ? "waiting_for_view" : this.resumeTarget();
  }

  /**
   * Request one Meta call for the current step (consumes budget). Intent:
   * verify only right after a "correct" inspection; otherwise inspect.
   */
  requestTrigger(now: number, opts: { manual?: boolean } = {}): { intent: AutoIntent; reason?: string } {
    const gate = this.canTrigger(now, opts);
    if (!gate.ok) {
      if (/limit|budget/i.test(gate.reason ?? "") && !opts.manual && !this.outstanding) this.state = "budget_exhausted";
      else if (this.state === "selecting_frame") this.state = this.resumeTarget();
      return { intent: "none", reason: gate.reason };
    }
    this.outstanding = true;
    this.inspectionsUsed++;
    this.sessionUsed++;
    this.lastRequestAt = now;
    this.state = gate.intent === "verify" ? "verifying" : "inspecting";
    return { intent: gate.intent };
  }

  private failure(kind: FailureKind) {
    this.lastFailure = kind;
    this.lastOutcome = "error";
    if (kind === "conflict" || kind === "stale") this.hasInspection = false; // start a fresh transaction
    if (kind === "aborted") {
      this.state = this.resumeTarget();
      return;
    }
    this.consecutiveFailures++;
    this.state = this.consecutiveFailures >= this.config.maxConsecutiveFailures ? "error" : "inspection_failed";
  }

  onInspectResult(
    projectId: string,
    stepId: string,
    status: "correct" | "incorrect" | "uncertain" | "error",
    failure: FailureKind = "backend",
    now = Date.now(),
  ) {
    if (projectId !== this.projectId || stepId !== this.stepId) return; // stale
    this.outstanding = false;
    if (status === "error") return this.failure(failure);
    this.consecutiveFailures = 0;
    this.lastFailure = null;
    this.hasInspection = true;
    this.lastOutcome = status;
    if (status === "correct") this.correctAt = now;
    this.state =
      status === "correct"
        ? "correct_awaiting_verification"
        : status === "incorrect"
          ? "correction_required"
          : "uncertain";
  }

  onVerifyResult(
    projectId: string,
    stepId: string,
    status: "verified" | "still_incorrect" | "uncertain" | "error",
    failure: FailureKind = "backend",
  ): { intent: AutoIntent } {
    if (projectId !== this.projectId || stepId !== this.stepId) return { intent: "none" }; // stale
    this.outstanding = false;
    if (status === "verified") {
      this.consecutiveFailures = 0;
      this.state = "verified";
      return { intent: "advance" };
    }
    if (status === "error") {
      this.failure(failure);
      return { intent: "none" };
    }
    this.consecutiveFailures = 0;
    this.lastOutcome = status === "uncertain" ? "uncertain" : "incorrect";
    this.state = status === "still_incorrect" ? "correction_required" : "uncertain";
    return { intent: "none" };
  }

  /** A manual (Verify Step / companion) result for this step while autonomous is on. */
  adoptManualResult(projectId: string, stepId: string, status: "correct" | "incorrect" | "uncertain", now = Date.now()) {
    if (projectId !== this.projectId || stepId !== this.stepId || this.outstanding) return;
    if (["idle", "completed", "paused"].includes(this.state)) return;
    this.hasInspection = true;
    this.lastOutcome = status;
    if (status === "correct") this.correctAt = now;
    this.state = this.resumeTarget();
  }

  /** Server progress for THIS step is verified (any path). */
  serverVerified(projectId: string, stepId: string) {
    if (projectId !== this.projectId || stepId !== this.stepId || this.outstanding) return;
    if (!["idle", "completed", "advancing_step"].includes(this.state)) this.state = "verified";
  }

  /**
   * Caller invokes this ONLY after server progress confirms `verified`
   * for the current step. Advances exactly once per step.
   */
  confirmAdvance(isLastStep: boolean): boolean {
    if (this.state !== "verified" || this.advancedFor === this.stepId) return false;
    this.advancedFor = this.stepId;
    if (isLastStep) {
      this.state = "completed";
      return true;
    }
    this.state = "advancing_step";
    return true;
  }

  /** After navigate() succeeds, arm the machine for the new step. */
  onAdvanced(newStepId: string) {
    this.beginStep(newStepId);
    this.state = "monitoring";
  }

  stepChanged(stepId: string) {
    if (stepId === this.stepId) return;
    this.beginStep(stepId);
    if (this.state === "paused") {
      this.pausedFrom = "monitoring";
      return;
    }
    if (this.state === "budget_exhausted") {
      // Per-step budget resets on a new step; the session budget does not.
      if (this.sessionUsed < this.config.maxPerSession) this.state = "monitoring";
      return;
    }
    if (!["idle", "completed", "camera_unavailable", "error", "anchoring", "camera_initializing", "calibrating"].includes(this.state))
      this.state = "monitoring";
  }
}
