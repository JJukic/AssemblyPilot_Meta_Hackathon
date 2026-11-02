/**
 * Baseline-referenced, motion-compensated assembly change detector (pure).
 *
 * Input: small luminance frames (e.g. 80×60) sampled a few times per
 * second from the live camera. Nothing here is uploaded or stored beyond
 * three bounded frames (previous, baseline, last-stable).
 *
 * Why a baseline: comparing only consecutive frames loses a placement as
 * soon as the wearer moves their head (the change is never "seen again").
 * Here every stable view is compared with the reference view of the last
 * accepted/inspected scene, after compensating global translation and
 * brightness/contrast. A latch remembers local activity (a hand or block
 * moving inside the assembly ROI while the background stayed still), so a
 * genuine placement survives later head movement.
 *
 * Limits (stated, not hidden): registration is a 2D translation + gain/
 * offset model. Large perspective changes (walking around, leaning in)
 * cannot be registered; they are reported as a viewpoint change. Without
 * a latch such a change only re-baselines (no paid inference); with a
 * latch it is treated conservatively as a possible change.
 */

export interface GrayFrame {
  gray: Uint8Array;
  w: number;
  h: number;
  /** Monotonic camera frame clock (media time / presented frames). */
  clock: number;
  /** Wall-clock ms. */
  at: number;
}

export interface RoiFraction { x0: number; y0: number; x1: number; y1: number }

/** Image-centre ROI. NOT projected from the anchored field (no camera calibration on HoloLens Edge). */
export const CENTER_ROI: RoiFraction = { x0: 0.22, y0: 0.18, x1: 0.78, y1: 0.86 };

export interface DetectorConfig {
  roi: RoiFraction;
  motionShift: number;
  baselineShift: number;
  pixelThreshold: number;
  stableSamples: number;
  /** ROI changed-pixel fraction vs previous frame that counts as local activity. */
  activityFraction: number;
  /** Background changed fraction above which the camera is considered moving. */
  movingBackground: number;
  /** ROI changed-pixel fraction vs baseline that counts as an assembly change. */
  changeFraction: number;
  /** Background changed fraction vs baseline under which registration is trusted. */
  alignBackground: number;
}

export const DEFAULT_DETECTOR: DetectorConfig = {
  roi: CENTER_ROI,
  motionShift: 4,
  baselineShift: 10,
  pixelThreshold: 0.14,
  stableSamples: 3,
  activityFraction: 0.02,
  movingBackground: 0.05,
  changeFraction: 0.01,
  alignBackground: 0.06,
};

export interface Registration {
  dx: number;
  dy: number;
  roiFraction: number;
  backgroundFraction: number;
  /** Bounding box of changed ROI pixels, normalised to the full frame. */
  box: { x: number; y: number; w: number; h: number; fraction: number } | null;
}

function roiPixels(w: number, h: number, roi: RoiFraction) {
  return {
    x0: Math.floor(roi.x0 * w), y0: Math.floor(roi.y0 * h),
    x1: Math.ceil(roi.x1 * w), y1: Math.ceil(roi.y1 * h),
  };
}

/**
 * Best integer translation of `b` relative to `a` (mean-removed SAD on a
 * stride-2 grid), then gain/offset-normalised changed-pixel fractions
 * inside and outside the ROI at that shift.
 */
export function register(
  a: Uint8Array, b: Uint8Array, w: number, h: number,
  roi: RoiFraction, maxShift: number, pixelThreshold: number,
): Registration {
  let meanA = 0, meanB = 0;
  for (let i = 0; i < a.length; i++) { meanA += a[i]; meanB += b[i]; }
  meanA /= a.length; meanB /= b.length;
  let best = { dx: 0, dy: 0, cost: Number.POSITIVE_INFINITY };
  const margin = maxShift;
  for (let dy = -maxShift; dy <= maxShift; dy++) {
    for (let dx = -maxShift; dx <= maxShift; dx++) {
      let sum = 0, n = 0;
      for (let y = margin; y < h - margin; y += 2) {
        const row = y * w, rowB = (y + dy) * w;
        for (let x = margin; x < w - margin; x += 2) {
          // Truncated (robust) cost: a locally changed block or a hand cannot
          // drag the global head-motion estimate away from the background.
          sum += Math.min(40, Math.abs((b[rowB + x + dx] - meanB) - (a[row + x] - meanA)));
          n++;
        }
      }
      // Tiny bias toward zero shift breaks ties on flat images.
      const cost = n ? sum / n + 0.01 * (Math.abs(dx) + Math.abs(dy)) : Number.POSITIVE_INFINITY;
      if (cost < best.cost) best = { dx, dy, cost };
    }
  }
  const { dx, dy } = best;
  // Gain/offset normalisation on the overlap (lighting/exposure changes).
  let sa = 0, sb = 0, saa = 0, sbb = 0, n = 0;
  for (let y = 0; y < h; y++) {
    const cy = y + dy;
    if (cy < 0 || cy >= h) continue;
    for (let x = 0; x < w; x++) {
      const cx = x + dx;
      if (cx < 0 || cx >= w) continue;
      const va = a[y * w + x], vb = b[cy * w + cx];
      sa += va; sb += vb; saa += va * va; sbb += vb * vb; n++;
    }
  }
  const ma = n ? sa / n : 0, mb = n ? sb / n : 0;
  const sdA = n ? Math.sqrt(Math.max(1, saa / n - ma * ma)) : 1;
  const sdB = n ? Math.sqrt(Math.max(1, sbb / n - mb * mb)) : 1;
  const gain = sdA / sdB;
  const r = roiPixels(w, h, roi);
  const threshold = pixelThreshold * 255;
  let roiChanged = 0, roiN = 0, bgChanged = 0, bgN = 0;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    const cy = y + dy;
    if (cy < 0 || cy >= h) continue;
    for (let x = 0; x < w; x++) {
      const cx = x + dx;
      if (cx < 0 || cx >= w) continue;
      const vb = (b[cy * w + cx] - mb) * gain + ma;
      const changed = Math.abs(vb - a[y * w + x]) > threshold;
      if (x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1) {
        roiN++;
        if (changed) {
          roiChanged++;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      } else {
        bgN++;
        if (changed) bgChanged++;
      }
    }
  }
  return {
    dx, dy,
    roiFraction: roiN ? roiChanged / roiN : 0,
    backgroundFraction: bgN ? bgChanged / bgN : 0,
    box: maxX >= 0 && roiChanged >= 4
      ? { x: minX / w, y: minY / h, w: (maxX - minX + 1) / w, h: (maxY - minY + 1) / h, fraction: roiChanged / (w * h) }
      : null,
  };
}

export type DetectorKind =
  | "warming"
  | "camera-moving"
  | "activity"
  | "settling"
  | "baseline-set"
  | "unchanged"
  | "rebaselined"
  | "change";

export interface DetectorReport {
  kind: DetectorKind;
  /** True while a change candidate is pending (survives head motion). */
  pending: boolean;
  latch: boolean;
  stableCount: number;
  motion: { dx: number; dy: number; roiFraction: number; backgroundFraction: number } | null;
  baseline: Registration | null;
  /** Why a change is pending ("assembly change", "change during viewpoint change", …). */
  reason: string;
  /** Registration against the reference view was trustworthy for this decision. */
  aligned: boolean | null;
}

export class ChangeDetector {
  private prev: GrayFrame | null = null;
  private baselineFrame: GrayFrame | null = null;
  private lastStable: GrayFrame | null = null;
  private stableCount = 0;
  private latch = false;
  private pendingReason = "";
  private wantNewView = false;
  private lastClock = Number.NEGATIVE_INFINITY;
  constructor(private config: DetectorConfig = DEFAULT_DETECTOR) {}

  get hasBaseline() { return this.baselineFrame !== null; }
  get pending() { return this.pendingReason !== ""; }
  get stable() { return this.stableCount >= this.config.stableSamples; }
  /** Most recent stable frame (what an inspection would see). */
  get stableFrame() { return this.lastStable; }

  /** New step or restart: forget everything (never reuse prior-step evidence). */
  reset() {
    this.prev = null;
    this.baselineFrame = null;
    this.lastStable = null;
    this.stableCount = 0;
    this.latch = false;
    this.pendingReason = "";
    this.wantNewView = false;
    this.lastClock = Number.NEGATIVE_INFINITY;
  }

  /** The current scene was sent for inspection: it becomes the reference. */
  accept(frame: GrayFrame | null = this.lastStable) {
    if (frame) this.baselineFrame = frame;
    this.latch = false;
    this.pendingReason = "";
    this.wantNewView = false;
  }

  /** After "another view needed": a clearly different stable viewpoint qualifies. */
  requestNewView() {
    this.wantNewView = true;
  }

  observe(frame: GrayFrame): DetectorReport {
    const c = this.config;
    const base: DetectorReport = {
      kind: "warming", pending: this.pending, latch: this.latch, stableCount: this.stableCount,
      motion: null, baseline: null, reason: this.pendingReason, aligned: null,
    };
    if (frame.clock <= this.lastClock) return { ...base, kind: "settling" }; // duplicate frame: no new evidence
    this.lastClock = frame.clock;
    const prev = this.prev;
    this.prev = frame;
    if (!prev || prev.w !== frame.w || prev.h !== frame.h) return base;
    const m = register(prev.gray, frame.gray, frame.w, frame.h, c.roi, c.motionShift, c.pixelThreshold);
    const motion = { dx: m.dx, dy: m.dy, roiFraction: m.roiFraction, backgroundFraction: m.backgroundFraction };
    const moving = Math.abs(m.dx) + Math.abs(m.dy) >= 2 || m.backgroundFraction >= c.movingBackground;
    // Local activity: the ROI changes much more than the background.
    const local = m.roiFraction >= c.activityFraction &&
      m.roiFraction > 3 * m.backgroundFraction + (moving ? 0.02 : 0);
    if (local) this.latch = true;
    const still = !moving && m.roiFraction <= 0.006 && m.backgroundFraction <= 0.012;
    this.stableCount = still ? this.stableCount + 1 : 0;
    const report = (kind: DetectorKind, extra: Partial<DetectorReport> = {}): DetectorReport => ({
      ...base, kind, motion, latch: this.latch, stableCount: this.stableCount,
      pending: this.pending, reason: this.pendingReason, ...extra,
    });
    if (moving) return report(local ? "activity" : "camera-moving");
    if (!still) return report(local ? "activity" : "settling");
    if (this.stableCount < c.stableSamples) return report("settling");
    this.lastStable = frame;
    if (!this.baselineFrame) {
      this.baselineFrame = frame;
      return report("baseline-set");
    }
    const b = register(
      this.baselineFrame.gray, frame.gray, frame.w, frame.h, c.roi, c.baselineShift, c.pixelThreshold,
    );
    const aligned = b.backgroundFraction <= c.alignBackground;
    if (aligned) {
      const clearChange = b.roiFraction >= c.changeFraction && b.roiFraction > 3 * b.backgroundFraction + 0.003;
      // Ambiguous: clearly more than noise in the ROI, but not a clean ratio.
      // After observed local activity that is treated as a change (never
      // silently dropped); without activity it is not worth a paid call.
      const ambiguous = !clearChange && b.roiFraction >= c.changeFraction && b.roiFraction > 1.5 * b.backgroundFraction;
      if (clearChange || (ambiguous && (this.latch || this.pending))) {
        this.pendingReason = this.latch ? "assembly change after local activity" : "assembly differs from the reference view";
        return report("change", { baseline: b, aligned, pending: true, reason: this.pendingReason });
      }
      // Same scene as the reference (e.g. a hand passed through): no inspection.
      this.latch = false;
      this.pendingReason = "";
      this.baselineFrame = frame; // adaptive refresh absorbs slow lighting drift
      return report("unchanged", { baseline: b, aligned, latch: false, pending: false, reason: "" });
    }
    // Viewpoint changed beyond 2D registration (moved closer, walked around).
    if (this.latch || this.pending) {
      this.pendingReason = "possible change during a viewpoint change";
      return report("change", { baseline: b, aligned, pending: true, reason: this.pendingReason });
    }
    if (this.wantNewView) {
      // Keep the old reference: the event stays pending until accept().
      this.pendingReason = "new viewpoint after 'another view needed'";
      return report("change", { baseline: b, aligned, pending: true, reason: this.pendingReason });
    }
    this.baselineFrame = frame; // head motion only: re-reference, never pay for it
    return report("rebaselined", { baseline: b, aligned });
  }
}
