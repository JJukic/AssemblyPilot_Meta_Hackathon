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
 *
 * Uncertain is a HOLD, never a loop: after an uncertain verdict no
 * automatic request is made (no timer, no change trigger) until the user
 * explicitly selects Check Again (a manual request) or Confirm Position.
 *
 * Scheduled re-checks (no physical change required, see `scheduledRetry`):
 *   incorrect  → one bounded reassessment `correctionReassessMs` later
 *                (a detected correction normally triggers it sooner)
 * At most `maxTimedRetries` consecutive scheduled checks; after that (or
 * when Meta asked for another viewpoint) a new view / change is required.
 * The schedule never bypasses the cooldown, back-off or budgets.
 *
 * Pause is sticky: a result that arrives while paused (a request that was
 * already in flight) is recorded, but the machine stays "paused" — the
 * verdict only becomes the state to resume into. Nothing can leave "paused"
 * except resume() or stop().
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
  /** Incorrect result without a detected correction → one reassessment after this long. */
  correctionReassessMs: number;
  /** Consecutive scheduled (timer-based) checks without a new view or change. */
  maxTimedRetries: number;
}

export const DEFAULT_AUTO: AutoConfig = {
  minIntervalMs: 20_000,
  verifyDelayMs: 5_000,
  maxAutoPerStep: 4,
  maxPerSession: 12,
  maxConsecutiveFailures: 3,
  correctionReassessMs: 60_000,
  maxTimedRetries: 2,
};

export type RetryPlan =
  | { kind: "none" }
  /** A scheduled Check Step; `at` already includes cooldown/back-off. */
  | { kind: "reassess"; at: number; reason: string }
  /** No timed retry allowed: a new viewpoint or a physical change is required. */
  | { kind: "wait_view"; reason: string }
  /** Uncertain: nothing automatic — only an explicit Check Again (manual request) continues. */
  | { kind: "await_user"; reason: string };

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
  /** Last VISUAL verdict of this step (survives infrastructure errors). */
  lastVerdict: "correct" | "incorrect" | "uncertain" | null = null;
  /** Time the last result (inspection or verification) arrived. */
  resultAt = 0;
  /** Meta asked for a different viewpoint: timed retries wait for a new view. */
  needsView = false;
  /** Consecutive scheduled checks without a new view/change (bounded). */
  timedRetries = 0;
  /** Earliest time for the next scheduled check after a rejected burst. */
  private retryNotBefore = 0;
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
  /**
   * The last visual verdict of this step is uncertain: automatic requests are
   * held until an explicit Check Again (manual trigger) produces a new verdict.
   */
  get awaitingUserCheck() {
    return this.lastVerdict === "uncertain" && !this.outstanding &&
      !["idle", "completed", "verified", "advancing_step"].includes(this.state);
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
    this.lastVerdict = null;
    this.resultAt = 0;
    this.needsView = false;
    this.timedRetries = 0;
    this.retryNotBefore = 0;
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

  /**
   * The next scheduled Check Step for the current verdict, if any. Pure: the
   * caller still needs a stable view of the field and `requestTrigger`
   * (cooldown, back-off, budgets, single flight) before anything is sent.
   */
  scheduledRetry(): RetryPlan {
    if (this.outstanding || this.nextIntent === "verify") return { kind: "none" };
    if (!["uncertain", "correction_required", "awaiting_correction", "waiting_for_view", "inspection_failed"].includes(this.state))
      return { kind: "none" };
    const verdict = this.lastVerdict;
    if (verdict !== "uncertain" && verdict !== "incorrect") return { kind: "none" };
    if (verdict === "uncertain")
      return { kind: "await_user", reason: this.needsView
        ? "Look from the requested side, then select Check Again. Nothing is checked automatically."
        : "Select Check Again for a new check, or Confirm Position. Nothing is checked automatically." };
    if (this.timedRetries >= this.config.maxTimedRetries)
      return { kind: "wait_view", reason: "Fix the assembly as shown; the corrected assembly is detected automatically." };
    const cooldown = this.lastRequestAt > 0
      ? this.lastRequestAt + this.config.minIntervalMs * 2 ** Math.max(0, this.consecutiveFailures - 1)
      : 0;
    return {
      kind: "reassess",
      at: Math.max(this.resultAt + this.config.correctionReassessMs, cooldown, this.retryNotBefore),
      reason: "Reassessing the assembly",
    };
  }
  /** A scheduled check found no usable frame: try again a little later (nothing spent). */
  deferRetry(until: number) {
    this.retryNotBefore = until;
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
  requestTrigger(now: number, opts: { manual?: boolean; timed?: boolean } = {}): { intent: AutoIntent; reason?: string } {
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
    // Scheduled checks are bounded; a change-, view- or user-triggered check restarts the count.
    if (gate.intent === "inspect") this.timedRetries = opts.timed ? this.timedRetries + 1 : 0;
    this.state = gate.intent === "verify" ? "verifying" : "inspecting";
    return { intent: gate.intent };
  }

  /** Apply a result state; while paused it only becomes the state to resume into. */
  private settle(next: AutoState) {
    if (this.state === "paused") this.pausedFrom = next;
    else this.state = next;
  }

  private failure(kind: FailureKind) {
    this.lastFailure = kind;
    this.lastOutcome = "error";
    if (kind === "conflict" || kind === "stale") this.hasInspection = false; // start a fresh transaction
    if (kind === "aborted") {
      this.settle(this.resumeTarget());
      return;
    }
    this.consecutiveFailures++;
    this.settle(this.consecutiveFailures >= this.config.maxConsecutiveFailures ? "error" : "inspection_failed");
  }

  onInspectResult(
    projectId: string,
    stepId: string,
    status: "correct" | "incorrect" | "uncertain" | "error",
    failure: FailureKind = "backend",
    now = Date.now(),
    needsView = false,
  ) {
    if (projectId !== this.projectId || stepId !== this.stepId) return; // stale
    this.outstanding = false;
    if (status === "error") return this.failure(failure);
    this.consecutiveFailures = 0;
    this.lastFailure = null;
    this.hasInspection = true;
    this.lastOutcome = status;
    this.noteVerdict(status, now, needsView);
    if (status === "correct") this.correctAt = now;
    this.settle(
      status === "correct"
        ? "correct_awaiting_verification"
        : status === "incorrect"
          ? "correction_required"
          : "uncertain",
    );
  }

  onVerifyResult(
    projectId: string,
    stepId: string,
    status: "verified" | "still_incorrect" | "uncertain" | "error",
    failure: FailureKind = "backend",
    now = Date.now(),
    needsView = false,
  ): { intent: AutoIntent } {
    if (projectId !== this.projectId || stepId !== this.stepId) return { intent: "none" }; // stale
    this.outstanding = false;
    if (status === "verified") {
      this.consecutiveFailures = 0;
      if (this.state === "paused") {
        this.pausedFrom = "verified"; // advance only after Resume
        return { intent: "none" };
      }
      this.state = "verified";
      return { intent: "advance" };
    }
    if (status === "error") {
      this.failure(failure);
      return { intent: "none" };
    }
    this.consecutiveFailures = 0;
    this.lastOutcome = status === "uncertain" ? "uncertain" : "incorrect";
    this.noteVerdict(this.lastOutcome, now, needsView);
    this.settle(status === "still_incorrect" ? "correction_required" : "uncertain");
    return { intent: "none" };
  }

  private noteVerdict(verdict: "correct" | "incorrect" | "uncertain", now: number, needsView: boolean) {
    this.lastVerdict = verdict;
    this.resultAt = now;
    this.needsView = verdict === "uncertain" && needsView;
    this.retryNotBefore = 0;
    if (verdict === "correct") this.timedRetries = 0; // progress: the next failure may retry again
  }

  /** A manual (Verify Step / companion) result for this step while autonomous is on. */
  adoptManualResult(projectId: string, stepId: string, status: "correct" | "incorrect" | "uncertain", now = Date.now()) {
    if (projectId !== this.projectId || stepId !== this.stepId || this.outstanding) return;
    if (["idle", "completed", "paused"].includes(this.state)) return;
    this.hasInspection = true;
    this.lastOutcome = status;
    this.noteVerdict(status, now, false);
    this.timedRetries = 0;
    if (status === "correct") this.correctAt = now;
    this.state = this.resumeTarget();
  }

  /** Server progress for THIS step is verified (any path). */
  serverVerified(projectId: string, stepId: string) {
    if (projectId !== this.projectId || stepId !== this.stepId || this.outstanding) return;
    if (this.state === "paused") this.pausedFrom = "verified"; // no advance while paused
    else if (!["idle", "completed", "advancing_step"].includes(this.state)) this.state = "verified";
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
