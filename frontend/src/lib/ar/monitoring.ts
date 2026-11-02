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

/* ---------------- Frame quality (blank/black detection) ---------------- */

export interface FrameQuality {
  ok: boolean;
  reason: string;
  meanBrightness: number;
  variance: number;
}

/** Reliably detectable invalid frames only; never judges assembly content. */
export function assessFrameQuality(meanBrightness: number, variance: number): FrameQuality {
  if (!Number.isFinite(meanBrightness) || !Number.isFinite(variance))
    return { ok: false, reason: "Frame statistics unavailable", meanBrightness, variance };
  if (meanBrightness < 3)
    return { ok: false, reason: "Frame is black (camera covered, unavailable or delivering no image)", meanBrightness, variance };
  if (meanBrightness > 252)
    return { ok: false, reason: "Frame is blank white (no usable image)", meanBrightness, variance };
  if (variance < 1)
    return { ok: false, reason: "Frame has no image content (uniform/blank frame)", meanBrightness, variance };
  return { ok: true, reason: "Frame has usable image content", meanBrightness, variance };
}

/* ---------------- Why "Uncertain"? (cause taxonomy) ---------------- */

export type UncertainCause =
  | "print"
  | "face"
  | "geometry"
  | "semantic"
  | "image-quality"
  | "infrastructure"
  | "none";

export interface UncertainDiagnosis {
  cause: UncertainCause;
  reason: string;
}

export function classifyUncertain(input: {
  kind?: string | null;
  state?: string | null;
  status?: string | null;
  printGate?: string | null;
  faceStatus?: string | null;
  geometryStatus?: string | null;
  geometryConstrained?: boolean;
}): UncertainDiagnosis {
  if (input.kind === "error")
    return { cause: "infrastructure", reason: "The inspection request failed (camera, upload, backend or Meta transport). This is a system failure, not a Meta visual judgment." };
  if (input.printGate === "uncertain")
    return { cause: "print", reason: "The required printed side or its physical direction could not be verified from this image. Capture a clearer close side view of the print together with the calibrated board." };
  if (input.faceStatus === "uncertain")
    return { cause: "face", reason: "The expected block face or physical direction could not be established. Capture the requested side view." };
  if (input.geometryConstrained && (input.geometryStatus === "uncertain" || input.geometryStatus === "not_measured"))
    return { cause: "geometry", reason: "Geometric verification lacked sufficient calibrated evidence for this step." };
  if (input.state === "uncertain" || input.status === "uncertain")
    return { cause: "semantic", reason: "Meta Muse Spark assessed the physical image but could not establish correctness (visibility, occlusion or ambiguity). Follow the requested additional view." };
  return { cause: "none", reason: "" };
}

/* --------- Global-motion compensation on downscaled gray frames --------- */

export interface RoiRect { x0: number; y0: number; x1: number; y1: number }

/**
 * Best integer translation of `curr` relative to `prev` (searched on a
 * stride-2 grid). Head sway mostly translates the whole image; aligning
 * by this shift removes that global motion before local diffing. This
 * is a cheap registration, not a claim of exact camera calibration.
 */
export function estimateGlobalShift(
  prev: Uint8Array, curr: Uint8Array, w: number, h: number, maxShift = 3,
): { dx: number; dy: number; alignedDiff: number } {
  let best = { dx: 0, dy: 0, alignedDiff: Number.POSITIVE_INFINITY };
  for (let dy = -maxShift; dy <= maxShift; dy++) {
    for (let dx = -maxShift; dx <= maxShift; dx++) {
      let sum = 0, n = 0;
      for (let y = 2; y < h - 2; y += 2) {
        for (let x = 2; x < w - 2; x += 2) {
          const cx = x + dx, cy = y + dy;
          if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
          sum += Math.abs(curr[cy * w + cx] - prev[y * w + x]) / 255;
          n++;
        }
      }
      const diff = n ? sum / n : 1;
      if (diff < best.alignedDiff) best = { dx, dy, alignedDiff: diff };
    }
  }
  return best;
}

/** ROI/outside diffs AFTER compensating the estimated global shift. */
export function alignedDiffs(
  prev: Uint8Array, curr: Uint8Array, w: number, h: number, roi: RoiRect,
): { dx: number; dy: number; roiDiff: number; outsideDiff: number } {
  const { dx, dy } = estimateGlobalShift(prev, curr, w, h);
  // Global exposure/lighting shift is not an assembly change: estimate
  // and remove the mean brightness delta before diffing.
  let deltaSum = 0, deltaN = 0;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const cx = x + dx, cy = y + dy;
      if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
      deltaSum += curr[cy * w + cx] - prev[y * w + x];
      deltaN++;
    }
  }
  const meanDelta = deltaN ? deltaSum / deltaN : 0;
  let roiSum = 0, roiN = 0, outSum = 0, outN = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cx = x + dx, cy = y + dy;
      if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
      const d = Math.abs(curr[cy * w + cx] - meanDelta - prev[y * w + x]) / 255;
      if (x >= roi.x0 && x < roi.x1 && y >= roi.y0 && y < roi.y1) { roiSum += d; roiN++; }
      else { outSum += d; outN++; }
    }
  }
  return {
    dx, dy,
    roiDiff: roiN ? roiSum / roiN : 0,
    outsideDiff: outN ? outSum / outN : 0,
  };
}

/** Normalized bounding box of locally changed pixels (after alignment). */
export function diffBoundingBox(
  prev: Uint8Array, curr: Uint8Array, w: number, h: number,
  threshold = 0.12, dx = 0, dy = 0,
): { x: number; y: number; w: number; h: number; fraction: number } | null {
  let minX = w, minY = h, maxX = -1, maxY = -1, count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cx = x + dx, cy = y + dy;
      if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
      if (Math.abs(curr[cy * w + cx] - prev[y * w + x]) / 255 > threshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        count++;
      }
    }
  }
  if (maxX < 0 || count < 8) return null;
  return {
    x: minX / w, y: minY / h,
    w: (maxX - minX + 1) / w, h: (maxY - minY + 1) / h,
    fraction: count / (w * h),
  };
}

/* ---------------- Bounded best-frame selection ---------------- */

export interface FrameCandidate {
  at: number;
  frameTime: number;
  hash: string;
  sharpness: number;
  meanBrightness: number;
  roiDiff: number;
}

export function frameQualityScore(c: FrameCandidate): number {
  const sharp = Math.min(1, c.sharpness / 40);
  const exposure = 1 - Math.min(1, Math.abs(c.meanBrightness - 128) / 128);
  const still = 1 - Math.min(1, c.roiDiff / 0.05);
  return sharp * 0.55 + exposure * 0.25 + still * 0.2;
}

/** Small ring of recent candidate metadata — never stores image data. */
export class BestFrameWindow {
  private items: FrameCandidate[] = [];
  constructor(private capacity = 10) {}
  add(c: FrameCandidate) {
    this.items.push(c);
    if (this.items.length > this.capacity) this.items.shift();
  }
  get size() { return this.items.length; }
  best(minScore = 0.35): FrameCandidate | null {
    let winner: FrameCandidate | null = null;
    let score = -1;
    for (const item of this.items) {
      const s = frameQualityScore(item);
      if (s > score) { score = s; winner = item; }
    }
    return winner && score >= minScore ? winner : null;
  }
  clear() { this.items = []; }
}
