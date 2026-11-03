/**
 * Camera capability, frame quality and burst frame selection (pure).
 *
 * Change detection lives in changeDetector.ts. Nothing here stores image
 * data beyond the arguments it is given.
 */

/** Minimal per-sample record used by the freshness probe. */
export interface FrameSample {
  hash: string;
  /** Video frame clock; must advance for a live camera. */
  frameTime: number;
  at: number;
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

/* ---------------- Burst frame selection ---------------- */

export interface CandidateStats {
  /** Camera frame clock of this candidate. */
  clock: number;
  /** Variance of the 4-neighbour Laplacian over the ROI (focus / motion blur). */
  sharpness: number;
  meanBrightness: number;
  /** Standard deviation of ROI luminance (content / contrast). */
  contrast: number;
  /** Fraction of ROI pixels near black or white. */
  clipped: number;
}

/** Statistics of one candidate from its ROI luminance. */
export function candidateStats(gray: ArrayLike<number>, w: number, h: number, clock: number): CandidateStats {
  let sum = 0, sq = 0, clipped = 0;
  const n = w * h;
  for (let i = 0; i < n; i++) {
    const v = gray[i];
    sum += v;
    sq += v * v;
    if (v <= 6 || v >= 249) clipped++;
  }
  const mean = n ? sum / n : 0;
  const contrast = n ? Math.sqrt(Math.max(0, sq / n - mean * mean)) : 0;
  let ls = 0, lsq = 0, ln = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w] - 4 * gray[i];
      ls += lap;
      lsq += lap * lap;
      ln++;
    }
  }
  const lm = ln ? ls / ln : 0;
  return { clock, sharpness: ln ? lsq / ln - lm * lm : 0, meanBrightness: mean, contrast, clipped: n ? clipped / n : 1 };
}

/** Why a single candidate is unusable, or null when usable. */
export function candidateDefect(c: CandidateStats): string | null {
  if (c.meanBrightness < 18) return "too dark";
  if (c.meanBrightness > 240) return "overexposed";
  if (c.contrast < 6) return "no visible content (uniform frame)";
  if (c.clipped > 0.35) return "large clipped (black/white) area";
  return null;
}

/**
 * Pick the most suitable candidate: fresh (newer than the last sent frame,
 * no duplicate clocks), not defective, then highest relative sharpness,
 * exposure and contrast. Sharpness is ranked RELATIVE to the burst so a
 * low-texture tabletop is never rejected outright (no deadlock); only
 * reliably broken frames are rejected.
 */
export function pickBestCandidate(
  candidates: CandidateStats[],
  minClock = Number.NEGATIVE_INFINITY,
): { ok: true; index: number; reason: string } | { ok: false; reason: string } {
  const seen = new Set<number>();
  const usable: { c: CandidateStats; i: number }[] = [];
  const defects: string[] = [];
  candidates.forEach((c, i) => {
    if (!(c.clock > minClock)) { defects.push("not newer than the last sent frame"); return; }
    if (seen.has(c.clock)) { defects.push("duplicate frame"); return; }
    seen.add(c.clock);
    const defect = candidateDefect(c);
    if (defect) defects.push(defect);
    else usable.push({ c, i });
  });
  if (!usable.length) {
    const reason = defects.length ? Array.from(new Set(defects)).join(", ") : "no candidate frames";
    return { ok: false, reason: `No usable fresh frame in the burst (${reason}).` };
  }
  const maxSharp = Math.max(...usable.map((u) => u.c.sharpness), 1e-6);
  let best = usable[0], bestScore = -1;
  for (const u of usable) {
    const score = 0.6 * (u.c.sharpness / maxSharp)
      + 0.25 * (1 - Math.min(1, Math.abs(u.c.meanBrightness - 128) / 128))
      + 0.15 * Math.min(1, u.c.contrast / 50);
    if (score > bestScore) { bestScore = score; best = u; }
  }
  const others = usable.filter((u) => u !== best).map((u) => u.c.sharpness.toFixed(0));
  return {
    ok: true,
    index: best.i,
    reason: `best of ${candidates.length}: sharpness ${best.c.sharpness.toFixed(0)}${others.length ? ` (others ${others.join(", ")})` : ""}, brightness ${best.c.meanBrightness.toFixed(0)}, contrast ${best.c.contrast.toFixed(0)}${defects.length ? `; rejected ${defects.length} (${Array.from(new Set(defects)).join(", ")})` : ""}`,
  };
}
