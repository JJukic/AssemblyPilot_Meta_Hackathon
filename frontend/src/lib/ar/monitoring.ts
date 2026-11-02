/**
 * Lightweight local frame gate for continuous monitoring (pure).
 *
 * The browser computes cheap per-sample statistics from a downscaled
 * frame; this gate decides whether a Meta inspection is justified.
 * It never decides correctness. No frames are stored here — only the
 * last hash and scalar statistics (bounded memory).
 */

export interface FrameSample {
  /** FNV-style hash of the downscaled frame; identical frame => identical hash. */
  hash: string;
  /** Mean absolute difference inside the assembly ROI, 0..1. */
  roiDiff: number;
  /** Mean absolute difference outside the ROI, 0..1 (camera-motion signal). */
  outsideDiff: number;
  /** Sharpness estimate (higher is sharper). */
  sharpness: number;
  /** Video frame clock (e.g. HTMLVideoElement.currentTime); must advance. */
  frameTime: number;
  /** Wall-clock timestamp ms. */
  at: number;
  occluded?: boolean;
}

export interface FrameGateConfig {
  changeThreshold: number;
  stableThreshold: number;
  cameraMoveThreshold: number;
  minSharpness: number;
  stableSamples: number;
}

export const DEFAULT_GATE: FrameGateConfig = {
  changeThreshold: 0.03,
  stableThreshold: 0.008,
  cameraMoveThreshold: 0.04,
  minSharpness: 4,
  stableSamples: 3,
};

export type GateDecision =
  | { kind: "unchanged" }
  | { kind: "frozen"; reason: string }
  | { kind: "camera-moved" }
  | { kind: "occluded" }
  | { kind: "blurry" }
  | { kind: "changed" }
  | { kind: "stabilizing"; stableCount: number }
  | { kind: "qualified"; hash: string };

export class FrameGate {
  private prev: FrameSample | null = null;
  private changed = false;
  private stableCount = 0;
  private lastFrameTime: number | null = null;
  private inspectedHash: string | null = null;
  private armed = true;
  constructor(private config: FrameGateConfig = DEFAULT_GATE) {}

  reset() {
    this.prev = null;
    this.changed = false;
    this.stableCount = 0;
    this.lastFrameTime = null;
    this.armed = true;
  }

  /** Mark a frame as sent for inspection; it can never qualify again. */
  noteInspected(hash: string) {
    this.inspectedHash = hash;
    this.armed = false;
    this.changed = false;
    this.stableCount = 0;
  }

  assess(sample: FrameSample): GateDecision {
    if (this.lastFrameTime !== null && sample.frameTime <= this.lastFrameTime) {
      return { kind: "frozen", reason: "Camera frame time is not advancing (stalled or frozen track)" };
    }
    this.lastFrameTime = sample.frameTime;
    const prev = this.prev;
    this.prev = sample;
    if (!prev) return { kind: "unchanged" };
    if (sample.hash === this.inspectedHash) return { kind: "unchanged" };
    if (sample.occluded) {
      this.stableCount = 0;
      return { kind: "occluded" };
    }
    // Camera movement moves the whole image; an assembly change is local.
    if (
      sample.outsideDiff >= this.config.cameraMoveThreshold &&
      sample.outsideDiff >= sample.roiDiff * 0.9
    ) {
      this.changed = false;
      this.stableCount = 0;
      return { kind: "camera-moved" };
    }
    if (!this.changed) {
      if (sample.roiDiff < this.config.changeThreshold) return { kind: "unchanged" };
      if (sample.sharpness < this.config.minSharpness) return { kind: "blurry" };
      this.changed = true;
      this.armed = true;
      this.stableCount = 0;
      return { kind: "changed" };
    }
    // Changed: wait for stillness (hysteresis), sharpness and visibility.
    if (sample.roiDiff <= this.config.stableThreshold) {
      if (sample.sharpness < this.config.minSharpness) {
        this.stableCount = 0;
        return { kind: "blurry" };
      }
      this.stableCount++;
      if (this.armed && this.stableCount >= this.config.stableSamples) {
        this.armed = false;
        return { kind: "qualified", hash: sample.hash };
      }
      return { kind: "stabilizing", stableCount: this.stableCount };
    }
    this.stableCount = 0;
    return { kind: "stabilizing", stableCount: 0 };
  }

  /**
   * A genuinely fresh frame for verification: new frame clock, not the
   * inspected hash, sharp and still — no assembly change required.
   */
  freshFrame(sample: FrameSample): boolean {
    return (
      sample.hash !== this.inspectedHash &&
      sample.sharpness >= this.config.minSharpness &&
      !sample.occluded &&
      sample.roiDiff <= this.config.stableThreshold * 2
    );
  }
}

/* ---------------- Camera + WebXR capability assessment ---------------- */

export type CameraSource = "hololens" | "external" | "manual";

export interface CameraProbe {
  secureContext: boolean;
  hasMediaDevices: boolean;
  hasXR: boolean;
  xrActive: boolean;
  trackState: string | null;
  /** Successive frame clocks + hashes observed during the probe. */
  frames: { frameTime: number; hash: string }[];
}

export interface CameraVerdict {
  status: "likely" | "stalled" | "unavailable" | "unknown";
  canCaptureDuringXR: boolean | null;
  reasons: string[];
}

/** Code-level verdict only; simultaneous XR+camera needs the real device. */
export function assessCameraProbe(probe: CameraProbe): CameraVerdict {
  const reasons: string[] = [];
  if (!probe.secureContext) reasons.push("Camera requires a secure (HTTPS) context.");
  if (!probe.hasMediaDevices) reasons.push("This browser exposes no mediaDevices.getUserMedia.");
  if (reasons.length) return { status: "unavailable", canCaptureDuringXR: false, reasons };
  if (!probe.trackState || probe.trackState !== "live") {
    reasons.push("No live video track was provided.");
    return { status: "unavailable", canCaptureDuringXR: false, reasons };
  }
  // Frame-clock advance is the freshness signal; a static tabletop scene
  // legitimately produces near-identical pixels between frames.
  const advancing = probe.frames.some(
    (f, i) => i > 0 && f.frameTime > probe.frames[i - 1].frameTime,
  );
  if (!advancing) {
    reasons.push(
      probe.xrActive
        ? "Video track is live but frames are not advancing while immersive AR is active on this device/browser. Use the external tabletop camera or manual capture."
        : "Video track is live but no advancing, changing frames were observed (frozen track).",
    );
    return { status: "stalled", canCaptureDuringXR: probe.xrActive ? false : null, reasons };
  }
  reasons.push(
    probe.xrActive
      ? "Frames are advancing during immersive AR in this probe. Reliability still requires the physical HoloLens check."
      : "Frames are advancing. Start the probe inside immersive AR to test simultaneous capture.",
  );
  return { status: "likely", canCaptureDuringXR: probe.xrActive ? true : null, reasons };
}
