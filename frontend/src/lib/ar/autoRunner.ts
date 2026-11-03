/**
 * Autonomous Assembly lifecycle (framework-free, testable).
 *
 * Owns exactly one camera, one AutoController and one tick timer per run.
 * Every run has an epoch: stop() increments it, so anything that resolves
 * later (camera permission, a tick, an in-flight inspection, a status
 * callback) can neither restart monitoring nor mutate the stopped state.
 *
 * Phases: off → starting → running ⇄ paused → off, and running → completed.
 *  - pause(): camera kept open, no analysis, no Meta requests.
 *  - stop():  timer cleared, controller stopped, the client-side request
 *             of this run aborted, camera tracks released. It never ends
 *             the XR session and never touches the anchored field/hologram.
 * Server side: an HTTP request that already reached the backend cannot be
 * cancelled by the browser; its late result is ignored by this run.
 */
import { AutoController, type AutoDeps, type AutoStatus, type Selection } from "./autoController";
import type { AutoCamera } from "./autoController";

export type RunnerPhase = "off" | "starting" | "running" | "paused" | "completed";

export interface RunnerCamera extends AutoCamera {
  start(deviceId?: string): Promise<void>;
  stop(): void;
  selectBest(minClock: number): Promise<Selection>;
}

export interface RunnerDeps {
  /** Reuse a live camera or create a new one. */
  camera(): RunnerCamera;
  controller: Omit<AutoDeps, "camera" | "selectFrame" | "onStatus">;
  onStatus(status: AutoStatus): void;
  onPhase(phase: RunnerPhase, message: string): void;
  /** Abort the browser request owned by Autonomous (never a manual Verify Step). */
  abortOwnRequest(): void;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  tickMs?: number;
}

export type StartResult = "started" | "ignored" | "cancelled" | "camera_error";

export class AutonomousRunner {
  phase: RunnerPhase = "off";
  controller: AutoController | null = null;
  camera: RunnerCamera | null = null;
  private timer: unknown = null;
  private epoch = 0;
  constructor(private deps: RunnerDeps) {}

  get machine() {
    return this.controller?.machine ?? null;
  }
  /** Phase of an active run (anything except off/completed). */
  get active() {
    return this.phase === "starting" || this.phase === "running" || this.phase === "paused";
  }

  private setPhase(phase: RunnerPhase, message: string) {
    this.phase = phase;
    this.deps.onPhase(phase, message);
  }

  async start(opts: { projectId: string; stepId: string; deviceId?: string; assessExisting?: boolean }): Promise<StartResult> {
    if (this.active) return "ignored";
    const epoch = ++this.epoch;
    this.setPhase("starting", "CAMERA STARTING — opening the camera…");
    const camera = this.deps.camera();
    this.camera = camera;
    if (!camera.live) {
      try {
        await camera.start(opts.deviceId);
      } catch (cause) {
        if (epoch !== this.epoch) return "cancelled"; // stopped meanwhile; stop() released it
        camera.stop();
        this.camera = null;
        this.setPhase("off", `CAMERA ERROR — ${cause instanceof Error ? cause.message : "camera unavailable"}. Nothing was sent to Meta.`);
        return "camera_error";
      }
    }
    if (epoch !== this.epoch) {
      // Stop (or a new run) happened while the camera was opening: release it, never continue.
      camera.stop();
      return "cancelled";
    }
    const controller = new AutoController({
      ...this.deps.controller,
      camera,
      selectFrame: (minClock) => camera.selectBest(minClock),
      onStatus: (status) => {
        if (epoch === this.epoch && this.controller === controller) this.deps.onStatus(status);
      },
    });
    this.controller = controller;
    controller.start(opts.projectId, opts.stepId, { assessExisting: opts.assessExisting });
    const set = this.deps.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
    this.timer = set(() => {
      if (epoch === this.epoch && this.controller === controller) void controller.tick();
    }, this.deps.tickMs ?? 500);
    this.setPhase("running", "Autonomous Assembly running.");
    return "started";
  }

  pause(): boolean {
    if (this.phase !== "running" || !this.controller) return false;
    this.controller.pause();
    this.setPhase("paused", "PAUSED — camera kept open; no frames analysed and no Meta requests until you resume.");
    return true;
  }

  resume(): boolean {
    if (this.phase !== "paused" || !this.controller) return false;
    this.controller.resume();
    this.setPhase("running", "RESUMED — re-establishing the reference view.");
    return true;
  }

  private clearTimer() {
    if (this.timer !== null) (this.deps.clearInterval ?? ((h: unknown) => clearInterval(h as ReturnType<typeof setInterval>)))(this.timer);
    this.timer = null;
  }

  /** Full stop: nothing of this run can act afterwards. Idempotent. */
  stop(message = "Autonomous Assembly stopped. Camera released; no automatic Meta requests will be made."): boolean {
    const wasActive = this.phase !== "off";
    this.epoch++;
    this.clearTimer();
    const controller = this.controller;
    this.controller = null;
    controller?.stop();
    this.deps.abortOwnRequest();
    this.camera?.stop();
    this.camera = null;
    this.setPhase("off", message);
    return wasActive;
  }

  /** Final step verified: no more calls, camera released; the machine keeps its "completed" state. */
  complete() {
    this.epoch++;
    this.clearTimer();
    this.camera?.stop();
    this.camera = null;
    this.setPhase("completed", "ASSEMBLY COMPLETE — automatic requests stopped.");
  }
}
