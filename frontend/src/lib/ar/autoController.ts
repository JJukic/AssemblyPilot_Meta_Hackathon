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
 */
import type { Snapshot } from "@/types/assembly";
import { AutonomousMachine, type AutoConfig, type AutoState, type FailureKind } from "./autonomous";
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
  | "verifying" | "verified" | "complete" | "paused" | "budget" | "error" | "busy_elsewhere";

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
}

export interface AutoDeps {
  camera: AutoCamera;
  selectFrame(minClock: number): Promise<Selection>;
  inspect(intent: "inspect" | "verify", frame: SelectedFrame, stepId: string): Promise<InspectOutcome>;
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
    this.emit("monitoring", "RESUMED", "Re-establishing the reference view…");
  }
  onStepChanged(stepId: string) {
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
    // 2) Field: in AR, inspections need a trustworthy anchored field.
    this.lastFieldInView = ctx.fieldInView;
    if (ctx.xrActive && !ctx.anchored) {
      if (ctx.anchorState === "tracking_lost") {
        m.anchorLost();
        this.emit("tracking_lost", "TRACKING LOST", "The spatial field cannot currently be reliably tracked. Inspections paused; it recovers automatically or Re-anchor.");
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
        this.emit("awaiting_verification", "CORRECT — VERIFYING SOON", "Hold the assembly still: a separate fresh frame will verify it.");
        return "Waiting for a still view";
      }
      if (ctx.fieldInView === false && !manual) {
        this.emit("waiting_view", "LOOK AT THE FIELD", "Look at the assembly field so the verification frame shows the construction.");
        return "Field not in view";
      }
      const gate = m.canTrigger(now, { manual });
      if (!gate.ok) {
        this.emit("awaiting_verification", "CORRECT — VERIFYING SOON", gate.reason ?? "");
        return gate.reason ?? "Not yet";
      }
      return this.run(ctx, manual);
    }
    // 5) Inspection on a real change (or one armed initial assessment / explicit request).
    const initial = m.initialAssessmentArmed && this.detector.stable && this.detector.hasBaseline && m.state === "monitoring";
    if (manual || report.kind === "change" || (report.pending && this.detector.stable) || initial) {
      m.changeDetected();
      if (ctx.fieldInView === false && !manual) {
        m.waitingForView();
        this.emit("waiting_view", "LOOK AT THE FIELD", "Change detected, but you are not looking at the assembly field. Look at it to inspect.");
        return "Field not in view";
      }
      const box = report.baseline?.box;
      if (!manual && !initial && report.aligned && box && box.fraction < MIN_TARGET_FRACTION) {
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
      return this.run(ctx, manual);
    }
    // 6) Passive, truthful monitoring feedback (no requests).
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
      this.emit(intro ? (m.lastOutcome === "incorrect" ? "correction_required" : "another_view") : "monitoring", intro ?? "MONITORING",
        `Camera moving — not counted as an assembly change${report.latch ? " (a pending change is remembered)" : ""}.`);
    } else if (!this.detector.hasBaseline) {
      this.emit("monitoring", "MONITORING", "Hold still a moment to capture the reference view of the assembly.");
    } else {
      this.emit(intro ? (m.lastOutcome === "incorrect" ? "correction_required" : "another_view") : "monitoring", intro ?? "MONITORING",
        intro ? "Fix the assembly as shown; the change is detected automatically." : "Watching for physical assembly changes.");
    }
    return "Monitoring";
  }

  private async run(ctx: AutoContext, manual: boolean): Promise<string> {
    const m = this.machine;
    const stepId = ctx.stepId!;
    const projectId = m.projectId;
    const stableBefore = this.detector.stableFrame;
    m.noteSelecting();
    this.emit("selecting", "SELECTING FRAME", "Capturing a short burst and choosing the sharpest, best-exposed fresh frame…");
    const selection = await this.deps.selectFrame(this.lastSentClock);
    if (this.stopped || this.deps.context().stepId !== stepId || m.stepId !== stepId) return "Step changed";
    if (!selection.ok) {
      this.lastRejection = selection.reason;
      this.deps.onFrameRejected?.(selection.preview ?? null, selection.reason);
      m.frameRejected();
      this.emit("quality_insufficient", "IMAGE QUALITY INSUFFICIENT", `${selection.reason} Nothing was sent to Meta.`);
      return selection.reason;
    }
    this.lastSelection = selection.frame.reason;
    const trigger = m.requestTrigger(this.deps.now(), { manual });
    if (trigger.intent === "none") {
      this.emit(m.state === "budget_exhausted" ? "budget" : "cooldown", m.state === "budget_exhausted" ? "BUDGET EXHAUSTED" : "WAITING", trigger.reason ?? "");
      return trigger.reason ?? "Not allowed";
    }
    const intent = trigger.intent === "verify" ? "verify" : "inspect";
    this.lastSentClock = selection.frame.clock;
    this.emit(intent === "verify" ? "verifying" : "inspecting",
      intent === "verify" ? "VERIFYING" : "INSPECTING WITH META",
      intent === "verify" ? "Real verification request with a separate fresh frame in progress." : "Real inspection request in progress — keep the assembly still.");
    const outcome = await this.deps.inspect(intent, selection.frame, stepId);
    if (this.stopped) return "Stopped";
    if (outcome.kind === "stale" || this.deps.context().stepId !== stepId || m.stepId !== stepId) {
      // The machine already moved to the new step (beginStep cleared the outstanding flag).
      if (m.stepId === stepId) m.onInspectResult(projectId, stepId, "error", "stale");
      return "Stale result discarded";
    }
    this.detector.accept(stableBefore ?? this.detector.stableFrame);
    if (outcome.kind === "error") {
      if (intent === "verify") m.onVerifyResult(projectId, stepId, "error", outcome.failure);
      else m.onInspectResult(projectId, stepId, "error", outcome.failure);
      this.emit(m.state === "error" ? "error" : "error", failureHeadline(outcome.failure),
        `${outcome.message} No step advance.${m.state === "error" ? " Monitoring stopped after repeated failures — Resume when fixed." : " Automatic retry after a back-off."}`);
      return outcome.message;
    }
    if (outcome.kind === "verification") {
      const result = m.onVerifyResult(projectId, stepId, outcome.status);
      if (outcome.status === "uncertain" && outcome.needsView) this.detector.requestNewView();
      if (result.intent === "advance") {
        this.emit("verified", "STEP VERIFIED", "Backend confirmed the step. Loading next step…");
        await this.deps.advance(stepId);
        return "Verified";
      }
      this.emit(outcome.status === "still_incorrect" ? "correction_required" : "another_view",
        outcome.status === "still_incorrect" ? "CORRECTION REQUIRED" : "ANOTHER VIEW NEEDED",
        outcome.status === "still_incorrect"
          ? "The verification frame shows a difference from the expected step. Follow the correction in the panel."
          : "The verification frame did not show the required evidence. Follow the requested view; a new inspection follows automatically.");
      return outcome.status;
    }
    m.onInspectResult(projectId, stepId, outcome.status, undefined, this.deps.now());
    if (outcome.status === "uncertain" && outcome.needsView) this.detector.requestNewView();
    if (outcome.status === "correct")
      this.emit("awaiting_verification", "CORRECT — AWAITING VERIFICATION", "Looks correct. A separate, later fresh frame must verify it before the step can advance.");
    else if (outcome.status === "incorrect")
      this.emit("correction_required", "CORRECTION REQUIRED", "The physical assembly differs from the expected step. See the panel; your fix is detected automatically.");
    else
      this.emit("another_view", "ANOTHER VIEW NEEDED", "Required evidence is not visible. Follow the requested view (move closer / show the printed side).");
    return outcome.status;
  }

  private emit(code: AutoStatusCode, headline: string, detail: string) {
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
