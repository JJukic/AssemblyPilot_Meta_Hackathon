/**
 * Autonomous Assembly orchestration (framework-free, dependency-injected).
 *
 * One tick = read camera health → check the anchored field → feed one
 * small luminance frame to the change detector → decide whether a paid
 * Meta request is justified. The controller never decides correctness and
 * never navigates by itself: verification comes only from the backend and
 * advancing is delegated to `advance`, which re-checks server progress.
 *
 * Invariants (tested in unit/auto-controller.test.cjs):
 *  - at most one request in flight; ticks are skipped while one runs
 *  - head motion / unchanged scenes never reach `inspect`
 *  - a frame is selected (bounded burst) BEFORE budget is consumed
 *  - verify only follows a "correct" inspection, with a newer frame
 *  - a result for a step that is no longer current is discarded
 *  - camera/anchor problems pause inspections and recover by themselves
 *  - nothing here can end the XR session or leave immersive AR
 *  - uncertain / incorrect verdicts schedule a bounded re-check on this same
 *    tick (no second timer); it still needs a stable view, a fresh frame,
 *    the cooldown/back-off and the budgets
 *  - in AR a request needs a trustworthy anchor AND a current viewer pose;
 *    both are re-checked after the async frame selection and immediately
 *    before the upload (`guard`). Re-anchor (anchor epoch change) invalidates
 *    every prepared capture and discards results of earlier requests
 *  - Pause is sticky: a late result is recorded but never resumes monitoring,
 *    starts a request or advances; a verified step advances only after Resume
 */
import type { Snapshot } from "@/types/assembly";
import { AutonomousMachine, type AutoConfig, type AutoState, type FailureKind, type RetryPlan } from "./autonomous";
import { ChangeDetector, type DetectorReport, type GrayFrame } from "./changeDetector";

export interface CameraHealth {
  state: "starting" | "advancing" | "stalled" | "ended";
  /** Presented frames per second when measurable (requestVideoFrameCallback), else null. */
  fps: number | null;
  framesSeen: number;
  lastAdvanceAgoMs: number | null;
  clockSource: "video-frame-callback" | "media-time" | "none";
  label: string;
}

export interface AutoCamera {
  readonly live: boolean;
  health(now: number): CameraHealth;
  grab(): GrayFrame | null;
}

export interface SelectedFrame {
  snapshot: Snapshot;
  clock: number;
  reason: string;
  /** Centre-ROI rectangle in source pixels (metadata only; the full frame is sent). */
  roiPx: { x: number; y: number; w: number; h: number };
  sharpness: number;
}

/** On rejection, `preview` is the best rejected candidate — shown as NOT SENT, never uploaded. */
export type Selection = { ok: true; frame: SelectedFrame } | { ok: false; reason: string; preview?: Snapshot | null };

export type InspectOutcome =
  | { kind: "inspection"; status: "correct" | "incorrect" | "uncertain"; needsView?: boolean }
  | { kind: "verification"; status: "verified" | "still_incorrect" | "uncertain"; needsView?: boolean }
  | { kind: "error"; failure: FailureKind; message: string }
  | { kind: "stale" };

export interface AutoContext {
  projectId: string;
  stepId: string | null;
  xrActive: boolean;
  anchored: boolean;
  anchorState: string;
  /** XR viewer pose available in the last frame (false = head tracking lost). */
  viewerTracked?: boolean;
  /** Incremented by every Re-anchor: captures prepared under another epoch are invalid. */
  anchorEpoch?: number;
  /** Head-gaze relation to the anchored field (null = unknown / not in AR). */
  fieldInView: boolean | null;
  /** A manual or companion inspection holds the step lease. */
  otherInspectionRunning: boolean;
  externalPending: boolean;
}

export type AutoStatusCode =
  | "off" | "camera_starting" | "camera_error" | "field_not_placed" | "tracking_lost"
  | "monitoring" | "change_detected" | "waiting_view" | "quality_insufficient" | "cooldown"
  | "selecting" | "inspecting" | "correction_required" | "another_view" | "awaiting_verification"
  | "verifying" | "verified" | "complete" | "paused" | "budget" | "error" | "busy_elsewhere"
  | "retry_scheduled";

export interface AutoStatus {
  code: AutoStatusCode;
  headline: string;
  detail: string;
  machineState: AutoState;
  camera: CameraHealth | null;
  detector: DetectorReport | null;
  fieldInView: boolean | null;
  budget: { stepUsed: number; stepMax: number; sessionUsed: number; sessionMax: number };
  lastSelection: string | null;
  lastRejection: string | null;
  lastFailure: FailureKind | null;
  /** Compact live detector numbers (stillness, change vs reference, shift). */
  metrics: string;
}

export interface AutoDeps {
  camera: AutoCamera;
  selectFrame(minClock: number): Promise<Selection>;
  /**
   * Run one paid request. `guard()` must be true after every async preparation
   * step and directly before the upload; when it turns false, nothing is sent.
   */
  inspect(intent: "inspect" | "verify", frame: SelectedFrame, stepId: string, guard: () => boolean): Promise<InspectOutcome>;
  context(): AutoContext;
  /** Re-check server progress and advance exactly one step if verified. */
  advance(stepId: string): Promise<void>;
  /** A burst was rejected before upload (panel shows the unsent frame and why). */
  onFrameRejected?(preview: Snapshot | null, reason: string): void;
  onStatus(status: AutoStatus): void;
  now(): number;
}

/** Changed region smaller than this fraction of the frame is too small to read a print. */
export const MIN_TARGET_FRACTION = 0.0025;
/** After a scheduled check found no usable frame, wait this long before the next burst. */
export const REJECTED_RETRY_MS = 2_000;

export class AutoController {
  readonly machine: AutonomousMachine;
  readonly detector = new ChangeDetector();
  private ticking = false;
  private stopped = false;
  private lastSentClock = Number.NEGATIVE_INFINITY;
  private lastSelection: string | null = null;
  private lastRejection: string | null = null;
  private lastReport: DetectorReport | null = null;
  private lastCamera: CameraHealth | null = null;
  private lastFieldInView: boolean | null = null;
  private metrics = "";
  /** Anchor epoch the detector reference belongs to (Re-anchor ⇒ new epoch). */
  private anchorEpoch: number | undefined = undefined;
  /** A verified step that must advance once Resume happened (never while paused). */
  private advanceAfterResume: string | null = null;
  status: AutoStatus;

  constructor(private deps: AutoDeps, config: Partial<AutoConfig> = {}) {
    this.machine = new AutonomousMachine(config);
    this.status = this.compose("off", "AUTONOMOUS OFF", "No automatic Meta requests are made.");
  }

  start(projectId: string, stepId: string, opts: { assessExisting?: boolean } = {}) {
    this.stopped = false;
    this.detector.reset();
    this.lastSentClock = Number.NEGATIVE_INFINITY;
    this.machine.start(projectId, stepId);
    if (opts.assessExisting) this.machine.armInitialAssessment();
    this.emit("camera_starting", "CAMERA STARTING", "Opening the camera and waiting for real, advancing video frames…");
  }
  stop() {
    this.stopped = true;
    this.machine.stop();
    this.emit("off", "AUTONOMOUS OFF", "Stopped. Camera released; no automatic Meta requests will be made.");
  }
  pause() {
    this.machine.pause();
    this.emit("paused", "PAUSED", "Camera kept open; no frames are analysed and no Meta requests are made until you resume.");
  }
  resume() {
    this.machine.resume();
    this.detector.reset(); // the scene may have changed while paused: re-reference, don't pay for it
    // A verification that arrived while paused advances now (once), never earlier.
    if (this.machine.state === "verified") this.advanceAfterResume = this.machine.stepId;
    this.emit("monitoring", "RESUMED", "Re-establishing the reference view…");
  }
  /** Read live (not narrowed): a pause can happen during any await. */
  private get paused(): boolean {
    return this.machine.state === "paused";
  }
  /** In AR: a request needs a trustworthy anchor, a viewer pose and an unchanged anchor epoch. */
  private trackingValid(ctx: AutoContext, epoch: number | undefined): boolean {
    if (!ctx.xrActive) return true;
    return ctx.anchored && ctx.viewerTracked !== false && ctx.anchorEpoch === epoch;
  }
  onStepChanged(stepId: string) {
    this.advanceAfterResume = null;
    this.machine.stepChanged(stepId);
    this.detector.reset(); // never reuse previous-step frames
    this.lastSentClock = Number.NEGATIVE_INFINITY;
  }
  /** A manual Verify Step result for the current step while autonomous is on. */
  adoptManual(status: "correct" | "incorrect" | "uncertain", stepId: string) {
    this.machine.adoptManualResult(this.machine.projectId, stepId, status, this.deps.now());
    this.detector.accept();
  }

  async tick(): Promise<void> {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      await this.step(false);
    } finally {
      this.ticking = false;
    }
  }

  /** Explicit "Inspect Now": bypasses the cooldown, never the budgets or the single-flight rule. */
  async inspectNow(): Promise<string> {
    if (this.ticking) return "A Meta request or frame selection is already running";
    this.ticking = true;
    try {
      return await this.step(true);
    } finally {
      this.ticking = false;
    }
  }

  private async step(manual: boolean): Promise<string> {
    const m = this.machine;
    const now = this.deps.now();
    const ctx = this.deps.context();
    if (m.state === "idle") return "Autonomous Assembly is off";
    if (m.state === "paused") { this.pause(); return "Paused"; }
    if (this.advanceAfterResume) {
      const verifiedStep = this.advanceAfterResume;
      this.advanceAfterResume = null;
      if (m.state === "verified" && verifiedStep === ctx.stepId && verifiedStep === m.stepId) {
        this.emit("verified", "VERIFIED — ADVANCING", "Resumed after a verification that arrived while paused. Loading next step…");
        await this.deps.advance(verifiedStep);
        return "Verified";
      }
    }
    if (m.state === "completed") {
      this.emit("complete", "ASSEMBLY COMPLETE", "All steps verified by the backend. No further Meta requests.");
      return "Complete";
    }
    if (m.state === "error") {
      this.emit("error", "ERROR — MONITORING STOPPED", `${m.consecutiveFailures} consecutive failures (${m.lastFailure ?? "unknown"}). Fix the cause, then Resume.`);
      return "Error";
    }
    if (!ctx.stepId) return "No current step";
    // 1) Camera: truthful health from the frame clock, never from getUserMedia alone.
    const camera = this.deps.camera.health(now);
    this.lastCamera = camera;
    if (!this.deps.camera.live || camera.state === "ended" || camera.state === "stalled") {
      m.cameraUnavailable();
      this.emit("camera_error", "CAMERA ERROR", camera.state === "ended"
        ? "The camera track ended. Stop and start Autonomous Assembly again, or use an external camera."
        : `Camera feed stalled — no new frame for ${Math.round((camera.lastAdvanceAgoMs ?? 0) / 1000)} s. Waiting for frames to resume; nothing is sent to Meta.`);
      return "Camera unavailable";
    }
    if (camera.state === "starting") {
      this.emit("camera_starting", "CAMERA STARTING", "Stream acquired; waiting for advancing video frames…");
      return "Camera starting";
    }
    if (m.state === "camera_unavailable") m.cameraRecovered();
    if (m.state === "camera_initializing") m.cameraReady(true);
    // 2) Field: in AR, inspections need a trustworthy anchored field AND a
    // current viewer pose (an anchored field without head tracking is not enough).
    this.lastFieldInView = ctx.fieldInView;
    if (ctx.xrActive && ctx.anchorEpoch !== this.anchorEpoch) {
      // Re-anchor: frames/reference of the previous placement are never reused.
      if (this.anchorEpoch !== undefined) this.detector.reset();
      this.anchorEpoch = ctx.anchorEpoch;
    }
    if (ctx.xrActive && (!ctx.anchored || ctx.viewerTracked === false)) {
      if (ctx.anchorState === "tracking_lost" || (ctx.anchored && ctx.viewerTracked === false)) {
        m.anchorLost();
        this.emit("tracking_lost", "TRACKING LOST", ctx.viewerTracked === false && ctx.anchored
          ? "Head tracking is unavailable (no viewer pose). Inspections paused; nothing is sent until tracking recovers."
          : "The spatial field cannot currently be reliably tracked. Inspections paused; it recovers automatically or Re-anchor.");
      } else {
        m.awaitAnchor();
        this.emit("field_not_placed", "AR FIELD NOT PLACED", "Position the assembly field on your tabletop and confirm it. Camera frames are arriving.");
      }
      return "Waiting for anchor";
    }
    m.anchored();
    if (m.state === "budget_exhausted") {
      this.emit("budget", "BUDGET EXHAUSTED", `Automatic Meta budget used (${m.inspectionsUsed}/${m.limits.maxAutoPerStep} this step, ${m.sessionUsed}/${m.limits.maxPerSession} session). Use Verify Step, or stop and restart Autonomous Assembly.`);
      return "Budget exhausted";
    }
    // 3) Local, free change detection on one small frame.
    const frame = this.deps.camera.grab();
    if (!frame) {
      this.emit("camera_starting", "CAMERA STARTING", "Waiting for a decodable video frame…");
      return "No frame";
    }
    const report = this.detector.observe(frame);
    this.lastReport = report;
    if (ctx.otherInspectionRunning || ctx.externalPending) {
      this.emit("busy_elsewhere", "INSPECTION RUNNING ELSEWHERE", ctx.externalPending
        ? "Waiting for the external camera result; no automatic request is made meanwhile."
        : "A manual inspection holds this step; automatic requests wait for it.");
      return "Busy elsewhere";
    }
    // 4) Separate fresh verification after a correct inspection.
    if (m.nextIntent === "verify") {
      if (!this.detector.stable && !manual) {
        this.emit("awaiting_verification", "CORRECT — PREPARING VERIFICATION", "Hold the assembly still: a separate fresh frame will verify it (Check Again).");
        return "Waiting for a still view";
      }
      if (ctx.fieldInView === false && !manual) {
        this.emit("waiting_view", "LOOK AT THE FIELD", "Look at the assembly field so the verification frame shows the construction.");
        return "Field not in view";
      }
      const gate = m.canTrigger(now, { manual });
      if (!gate.ok) {
        this.emit("awaiting_verification", "CORRECT — PREPARING VERIFICATION", gate.reason ?? "");
        return gate.reason ?? "Not yet";
      }
      return this.run(ctx, manual);
    }
    // 5) Inspection on a real change, one armed initial assessment, an explicit
    // request, or a DUE scheduled re-check after uncertain/incorrect (no physical
    // change needed — but still a stable, fresh view of the field).
    const initial = m.initialAssessmentArmed && this.detector.stable && this.detector.hasBaseline && m.state === "monitoring";
    const plan = m.scheduledRetry();
    if (plan.kind === "wait_view") this.detector.requestNewView(); // a clearly new viewpoint qualifies
    const changed = report.kind === "change" || (report.pending && this.detector.stable);
    const timed = !manual && !changed && !initial && (plan.kind === "retry" || plan.kind === "reassess") &&
      now >= plan.at && this.detector.stable && this.detector.hasBaseline;
    if (manual || changed || initial || timed) {
      m.changeDetected();
      if (ctx.fieldInView === false && !manual) {
        m.waitingForView();
        this.emit("waiting_view", "LOOK AT THE FIELD", "Change detected, but you are not looking at the assembly field. Look at it to inspect.");
        return "Field not in view";
      }
      const box = report.baseline?.box;
      if (!manual && !initial && !timed && report.aligned && box && box.fraction < MIN_TARGET_FRACTION) {
        m.waitingForView();
        this.emit("waiting_view", "IMAGE QUALITY INSUFFICIENT", "The changed block is very small in the camera image. Move closer so the block and its printed side fill more of the view.");
        return "Target too small";
      }
      const gate = m.canTrigger(now, { manual });
      if (!gate.ok) {
        if (/limit|budget/i.test(gate.reason ?? "") && !manual) {
          m.requestTrigger(now); // records budget_exhausted
          this.emit("budget", "BUDGET EXHAUSTED", gate.reason ?? "");
        } else this.emit("cooldown", "CHANGE DETECTED — WAITING", gate.reason ?? "");
        return gate.reason ?? "Not allowed";
      }
      if (initial) m.noteInitialAssessment();
      return this.run(ctx, manual, timed);
    }
    // 6) Passive, truthful monitoring feedback (no requests) — each waiting
    // state says what it waits for, with live numbers readable in AR.
    const need = this.detector.stableTarget;
    this.metrics = report.motion
      ? `still ${Math.min(report.stableCount, need)}/${need} · Δref ${report.baseline ? (report.baseline.roiFraction * 100).toFixed(1) + "%" : "–"} · shift ${report.motion.dx},${report.motion.dy}`
      : "";
    const live = this.metrics ? ` [${this.metrics}]` : "";
    if (plan.kind !== "none" && report.kind !== "activity") {
      this.emitRetry(plan, now, ctx.fieldInView);
      return "Waiting for the next check";
    }
    if (m.state === "inspection_failed" && m.lastFailure) {
      const gate = m.canTrigger(now);
      this.emit("error", failureHeadline(m.lastFailure),
        `The last request failed (not a visual judgment). ${gate.ok ? "Monitoring continues; the next real change retries." : gate.reason ?? ""}`);
      return "Backing off";
    }
    const intro = m.lastOutcome === "incorrect" ? "CORRECTION REQUIRED" : m.lastOutcome === "uncertain" ? "ANOTHER VIEW NEEDED" : null;
    if (report.kind === "activity") {
      m.changeDetected();
      m.stabilizing();
      this.emit("change_detected", "CHANGE DETECTED", "LEGO assembly change detected — waiting for a clear, still view.");
    } else if (report.kind === "camera-moving") {
      this.emit(intro ? (m.lastOutcome === "incorrect" ? "correction_required" : "another_view") : "monitoring", intro ?? "WATCHING · HEAD MOVING",
        `Camera moving — not counted as an assembly change${report.latch ? " (a pending change is remembered)" : ""}.${live}`);
    } else if (!this.detector.hasBaseline) {
      this.emit("monitoring", "WATCHING · HOLD STILL", `Hold still a moment to capture the reference view of the assembly.${live}`);
    } else if (!this.detector.stable) {
      this.emit(intro ? (m.lastOutcome === "incorrect" ? "correction_required" : "another_view") : "monitoring", intro ?? "WATCHING · HOLD STILL",
        `Hold your head still on the field for about 1.5 s.${live}`);
    } else {
      this.emit(intro ? (m.lastOutcome === "incorrect" ? "correction_required" : "another_view") : "monitoring", intro ?? "WATCHING · NO CHANGE",
        `${intro ? "Fix the assembly as shown; the change is detected automatically." : "Watching for physical assembly changes — the scene matches the reference."}${live}`);
    }
    return "Monitoring";
  }

  private async run(ctx: AutoContext, manual: boolean, timed = false): Promise<string> {
    const m = this.machine;
    const stepId = ctx.stepId!;
    const projectId = m.projectId;
    const stableBefore = this.detector.stableFrame;
    const epoch = ctx.anchorEpoch;
    /** The prepared run may still send: not stopped/paused, same step, tracking + anchor epoch intact. */
    const guard = () => {
      if (this.stopped || this.paused || m.stepId !== stepId) return false;
      const now = this.deps.context();
      return now.stepId === stepId && this.trackingValid(now, epoch);
    };
    m.noteSelecting();
    this.emit("selecting", "SELECTING FRAME", "Capturing a short burst and choosing the sharpest, best-exposed fresh frame…");
    const selection = await this.deps.selectFrame(this.lastSentClock);
    if (this.stopped || this.deps.context().stepId !== stepId || m.stepId !== stepId) return "Step changed";
    if (this.paused) {
      this.pause();
      return "Paused";
    }
    if (!this.trackingValid(this.deps.context(), epoch)) {
      // Tracking lost or Re-anchor during the (async) frame selection: the prepared capture is invalid.
      m.frameRejected();
      this.emit("tracking_lost", "TRACKING LOST — CAPTURE DISCARDED",
        "Tracking or the field anchor changed while the frame was selected. The prepared capture was discarded; nothing was sent to Meta.");
      return "Tracking lost";
    }
    if (!selection.ok) {
      this.lastRejection = selection.reason;
      this.deps.onFrameRejected?.(selection.preview ?? null, selection.reason);
      m.frameRejected();
      if (timed) m.deferRetry(this.deps.now() + REJECTED_RETRY_MS); // no burst every tick
      this.emit("quality_insufficient", "IMAGE QUALITY INSUFFICIENT", `${selection.reason} Nothing was sent to Meta.`);
      return selection.reason;
    }
    this.lastSelection = selection.frame.reason;
    const trigger = m.requestTrigger(this.deps.now(), { manual, timed });
    if (trigger.intent === "none") {
      this.emit(m.state === "budget_exhausted" ? "budget" : "cooldown", m.state === "budget_exhausted" ? "BUDGET EXHAUSTED" : "WAITING", trigger.reason ?? "");
      return trigger.reason ?? "Not allowed";
    }
    const intent = trigger.intent === "verify" ? "verify" : "inspect";
    this.lastSentClock = selection.frame.clock;
    this.emit(intent === "verify" ? "verifying" : "inspecting",
      intent === "verify" ? "CHECK AGAIN — VERIFYING" : timed ? "CHECKING STEP AGAIN WITH META AI…" : "CHECKING STEP WITH META AI…",
      intent === "verify" ? "Real verification request with a separate fresh frame in progress." : "Real inspection request in progress — keep the assembly still.");
    if (!guard()) {
      // Final pre-request check (synchronous path): release the reserved slot, send nothing.
      m.onInspectResult(projectId, stepId, "error", "aborted");
      if (this.paused) this.pause();
      else this.emit("tracking_lost", "TRACKING LOST — CAPTURE DISCARDED", "Tracking or the field anchor changed before the upload. Nothing was sent to Meta.");
      return "Not sent";
    }
    const outcome = await this.deps.inspect(intent, selection.frame, stepId, guard);
    if (this.stopped) return "Stopped";
    if (outcome.kind === "stale" || this.deps.context().stepId !== stepId || m.stepId !== stepId) {
      // The machine already moved to the new step (beginStep cleared the outstanding flag).
      if (m.stepId === stepId) m.onInspectResult(projectId, stepId, "error", "stale");
      return "Stale result discarded";
    }
    const after = this.deps.context();
    if (after.xrActive && after.anchorEpoch !== epoch) {
      // Re-anchored while the request ran: this result belongs to the old placement.
      m.onInspectResult(projectId, stepId, "error", "aborted");
      if (this.paused) this.pause();
      else this.emit("tracking_lost", "RE-ANCHORED — RESULT DISCARDED", "The field was re-anchored while the request ran; that result is not used.");
      return "Re-anchored";
    }
    this.detector.accept(stableBefore ?? this.detector.stableFrame);
    if (outcome.kind === "error") {
      if (intent === "verify") m.onVerifyResult(projectId, stepId, "error", outcome.failure);
      else m.onInspectResult(projectId, stepId, "error", outcome.failure);
      if (this.paused) return this.pausedResult(`request failed (${outcome.failure})`);
      this.emit(m.state === "error" ? "error" : "error", failureHeadline(outcome.failure),
        `${outcome.message} No step advance.${m.state === "error" ? " Monitoring stopped after repeated failures — Resume when fixed." : " Automatic retry after a back-off."}`);
      return outcome.message;
    }
    if (outcome.kind === "verification") {
      const result = m.onVerifyResult(projectId, stepId, outcome.status, undefined, this.deps.now(), !!outcome.needsView);
      if (outcome.status === "uncertain" && outcome.needsView) this.detector.requestNewView();
      if (this.paused) return this.pausedResult(outcome.status === "verified" ? "verified (advances after Resume)" : outcome.status);
      if (result.intent === "advance") {
        this.emit("verified", "VERIFIED — ADVANCING", "Backend confirmed the step. Loading next step…");
        await this.deps.advance(stepId);
        return "Verified";
      }
      this.emit(outcome.status === "still_incorrect" ? "correction_required" : "another_view",
        outcome.status === "still_incorrect" ? "CORRECTION REQUIRED" : "ANOTHER VIEW NEEDED",
        outcome.status === "still_incorrect"
          ? "The verification frame shows a difference from the expected step. Follow the correction in the panel."
          : "The verification frame did not show the required evidence. A new Check Step follows automatically.");
      return outcome.status;
    }
    m.onInspectResult(projectId, stepId, outcome.status, undefined, this.deps.now(), !!outcome.needsView);
    if (outcome.status === "uncertain" && outcome.needsView) this.detector.requestNewView();
    if (this.paused) return this.pausedResult(outcome.status);
    if (outcome.status === "correct")
      this.emit("awaiting_verification", "CORRECT — PREPARING VERIFICATION", "Looks correct. A separate, later fresh frame must verify it (Check Again) before the step can advance.");
    else if (outcome.status === "incorrect")
      this.emit("correction_required", "CORRECTION REQUIRED", "The physical assembly differs from the expected step. See the panel; your fix is detected automatically.");
    else if (outcome.needsView)
      this.emit("another_view", "ANOTHER CAMERA VIEW REQUIRED", "Required evidence is not visible. Follow the requested view (move closer / show the printed side); the check follows automatically.");
    else
      this.emit("retry_scheduled", "UNCERTAIN — RETRYING WHEN READY", "Meta could not decide from this frame. A new Check Step with a fresh frame follows automatically.");
    return outcome.status;
  }

  /** A late result arrived while paused: shown, recorded, but nothing continues until Resume. */
  private pausedResult(result: string): string {
    this.emit("paused", "PAUSED — RESULT RECEIVED",
      `The request that was already running returned: ${result}. Still paused — no new requests and no step advance until you resume.`);
    return "Paused";
  }

  /** Truthful waiting status for a scheduled re-check (countdown only when it can really run). */
  private emitRetry(plan: Exclude<RetryPlan, { kind: "none" }>, now: number, fieldInView: boolean | null) {
    const m = this.machine;
    const incorrect = m.lastVerdict === "incorrect";
    const failed = m.state === "inspection_failed" && m.lastFailure ? `Last request failed (${m.lastFailure}, not a visual judgment). ` : "";
    if (plan.kind === "wait_view") {
      this.emit(incorrect ? "correction_required" : "another_view", incorrect ? "CORRECTION REQUIRED" : "ANOTHER CAMERA VIEW REQUIRED", failed + plan.reason);
      return;
    }
    const remaining = m.remaining;
    if (remaining.step === 0 || remaining.session === 0) {
      const gate = m.requestTrigger(now); // records budget_exhausted (spends nothing)
      this.emit("budget", "AUTOMATIC INSPECTION LIMIT REACHED", gate.reason ?? "Automatic inspection budget used.");
      return;
    }
    if (fieldInView === false) {
      this.emit("waiting_view", "LOOK AT THE FIELD", `${failed}Look at the assembly field — the next check needs a view of the construction.`);
      return;
    }
    const headline = incorrect ? "CORRECTION REQUIRED" : "UNCERTAIN — RETRYING WHEN READY";
    if (now < plan.at) {
      const s = Math.ceil((plan.at - now) / 1000);
      this.emit(incorrect ? "correction_required" : "retry_scheduled", incorrect ? headline : `UNCERTAIN — NEXT CHECK IN ${s} S`,
        incorrect
          ? `${failed}Fix the assembly as shown; the correction is detected automatically. Otherwise it is rechecked in ${s} s.`
          : `${failed}Next check in ${s} seconds with a fresh frame.`);
      return;
    }
    this.emit(incorrect ? "correction_required" : "retry_scheduled", headline,
      `${failed}Hold your head still on the field — the next check runs as soon as the view is steady.`);
  }

  private emit(code: AutoStatusCode, headline: string, detail: string) {
    if (!["monitoring", "change_detected", "correction_required", "another_view", "retry_scheduled"].includes(code)) this.metrics = "";
    this.status = this.compose(code, headline, detail);
    this.deps.onStatus(this.status);
  }

  private compose(code: AutoStatusCode, headline: string, detail: string): AutoStatus {
    const m = this.machine;
    return {
      code, headline, detail,
      machineState: m.state,
      camera: this.lastCamera,
      detector: this.lastReport,
      fieldInView: this.lastFieldInView,
      budget: { stepUsed: m.inspectionsUsed, stepMax: m.limits.maxAutoPerStep, sessionUsed: m.sessionUsed, sessionMax: m.limits.maxPerSession },
      lastSelection: this.lastSelection,
      lastRejection: this.lastRejection,
      lastFailure: m.lastFailure,
      metrics: this.metrics,
    };
  }
}

export function failureHeadline(kind: FailureKind): string {
  switch (kind) {
    case "camera": return "CAMERA ERROR";
    case "transport": return "TRANSPORT ERROR — backend unreachable";
    case "provider": return "META PROVIDER ERROR";
    case "conflict": return "REVISION CONFLICT — step changed during inspection";
    case "stale": return "STALE REQUEST — superseded or expired";
    case "rejected": return "REQUEST REJECTED by the backend";
    case "invalid_response": return "INVALID RESPONSE — not accepted";
    case "aborted": return "REQUEST CANCELLED";
    default: return "BACKEND ERROR";
  }
}

/** Map a thrown request error to a failure kind (never to a visual judgment). */
export function classifyFailure(error: unknown): FailureKind {
  const status = typeof error === "object" && error && "status" in error ? Number((error as { status: unknown }).status) : NaN;
  const message = error instanceof Error ? error.message : String(error ?? "");
  const name = error instanceof Error ? error.name : "";
  if (name === "AbortError" || /aborted|cancel/i.test(message)) return "aborted";
  if (/Cannot reach the backend|Failed to fetch|NetworkError/i.test(message)) return "transport";
  if (status === 409) return "conflict";
  if (status === 404 || status === 410) return "stale";
  if (status === 429 || status === 502 || status === 503 || status === 504 || status === 402) return "provider";
  if (status === 413 || status === 415 || status === 422 || status === 400) return "rejected";
  if (/invalid|identity|not accepted/i.test(message) && !Number.isFinite(status)) return "invalid_response";
  if (/camera|frame/i.test(message) && !Number.isFinite(status)) return "camera";
  return "backend";
}
