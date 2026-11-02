/**
 * Autonomous Assembly state machine (pure, testable).
 *
 * This machine only decides WHEN an existing Meta inspection or
 * fresh-image verification is justified and when the verified step may
 * advance. It never marks anything verified: advancement requires the
 * caller to confirm server progress for the exact project/step first.
 * At most one Meta request is outstanding; unchanged scenes, duplicate
 * frames, cooldowns and per-step caps cannot trigger paid inference.
 */

export type AutoState =
  | "idle"
  | "camera_initializing"
  | "calibrating"
  | "anchoring"
  | "monitoring"
  | "change_detected"
  | "waiting_for_stability"
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
  | "paused"
  | "completed";

export type AutoIntent = "inspect" | "verify" | "advance" | "none";

export interface AutoConfig {
  minIntervalMs: number;
  maxAutoPerStep: number;
}

export const DEFAULT_AUTO: AutoConfig = { minIntervalMs: 20_000, maxAutoPerStep: 4 };

export class AutonomousMachine {
  state: AutoState = "idle";
  projectId = "";
  stepId = "";
  inspectionsUsed = 0;
  lastRequestAt = 0;
  hasInspection = false;
  lastOutcome: "correct" | "incorrect" | "uncertain" | "error" | null = null;
  private outstanding = false;
  private advancedFor = "";
  private pausedFrom: AutoState = "monitoring";
  constructor(private config: AutoConfig = DEFAULT_AUTO) {}

  get busy() {
    return this.outstanding;
  }

  start(projectId: string, stepId: string) {
    this.projectId = projectId;
    this.beginStep(stepId);
    this.state = "camera_initializing";
  }

  private beginStep(stepId: string) {
    this.stepId = stepId;
    this.inspectionsUsed = 0;
    this.lastRequestAt = 0;
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
  anchored() {
    if (["anchoring", "tracking_lost"].includes(this.state)) this.state = "monitoring";
  }
  anchorLost() {
    if (!["idle", "completed", "paused"].includes(this.state)) this.state = "tracking_lost";
  }
  cameraUnavailable() {
    if (this.state !== "idle") this.state = "camera_unavailable";
  }
  cameraRecovered() {
    if (this.state === "camera_unavailable") this.state = "camera_initializing";
  }

  pause() {
    if (!["idle", "completed"].includes(this.state)) {
      this.pausedFrom = this.state;
      this.state = "paused";
    }
  }
  resume() {
    if (this.state === "paused") this.state = this.pausedFrom;
  }
  stop() {
    this.state = "idle";
    this.outstanding = false;
  }

  changeDetected() {
    if (this.state === "monitoring") this.state = "change_detected";
    else if (this.state === "correction_required") this.state = "awaiting_correction";
  }
  stabilizing() {
    if (["change_detected", "awaiting_correction"].includes(this.state))
      this.state = "waiting_for_stability";
  }

  /**
   * Request one Meta call for the current step. `kind` selects the
   * existing pipeline: no prior inspection => inspect; a prior correct
   * or incorrect inspection => fresh-image verify against it.
   */
  requestTrigger(now: number, opts: { manual?: boolean } = {}): { intent: AutoIntent; reason?: string } {
    const active = [
      "monitoring", "change_detected", "waiting_for_stability", "ready_to_inspect",
      "awaiting_correction", "correct_awaiting_verification", "uncertain",
      "correction_required", "inspection_failed",
    ].includes(this.state);
    if (!active) return { intent: "none", reason: `Autonomous mode is ${this.state}` };
    if (this.outstanding) return { intent: "none", reason: "A Meta request is already running" };
    if (this.inspectionsUsed >= this.config.maxAutoPerStep)
      return { intent: "none", reason: `Automatic inspection limit (${this.config.maxAutoPerStep}) reached for this step — use Inspect Now or continue manually` };
    if (!opts.manual && now - this.lastRequestAt < this.config.minIntervalMs && this.lastRequestAt > 0)
      return { intent: "none", reason: "Inspection cooldown — waiting before the next automatic Meta request" };
    this.outstanding = true;
    this.inspectionsUsed++;
    this.lastRequestAt = now;
    const intent: AutoIntent = this.hasInspection ? "verify" : "inspect";
    this.state = intent === "verify" ? "verifying" : "inspecting";
    return { intent };
  }

  onInspectResult(projectId: string, stepId: string, status: "correct" | "incorrect" | "uncertain" | "error") {
    if (projectId !== this.projectId || stepId !== this.stepId) return; // stale
    this.outstanding = false;
    if (status === "error") {
      this.state = "inspection_failed";
      this.lastOutcome = "error";
      return;
    }
    this.hasInspection = true;
    this.lastOutcome = status;
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
  ): { intent: AutoIntent } {
    if (projectId !== this.projectId || stepId !== this.stepId) return { intent: "none" }; // stale
    this.outstanding = false;
    if (status === "verified") {
      this.state = "verified";
      return { intent: "advance" };
    }
    this.lastOutcome = status === "error" ? "error" : status === "uncertain" ? "uncertain" : "incorrect";
    this.state =
      status === "still_incorrect"
        ? "correction_required"
        : status === "uncertain"
          ? "uncertain"
          : "inspection_failed";
    return { intent: "none" };
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
    if (!["idle", "paused", "completed", "camera_unavailable"].includes(this.state))
      this.state = "monitoring";
  }
}
