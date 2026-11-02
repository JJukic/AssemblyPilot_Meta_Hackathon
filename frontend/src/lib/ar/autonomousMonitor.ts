/**
 * Browser camera monitor for Autonomous Assembly.
 *
 * Owns ONE getUserMedia video stream (HoloLens camera attempt, a
 * browser-enumerated external/USB camera, or a companion-device camera).
 *
 *  - health(): truthful liveness from an ADVANCING frame clock
 *    (requestVideoFrameCallback presented frames when available, else
 *    media time) — never inferred from a resolved getUserMedia promise.
 *  - grab(): one small luminance frame for the free local change detector.
 *  - selectBest(): bounded burst of full-resolution candidates, scored for
 *    sharpness/exposure/contrast/freshness; only the winner is encoded.
 *
 * Frames are never stored or uploaded by the monitor itself.
 */
import type { Snapshot } from "@/types/assembly";
import type { AutoCamera, CameraHealth, Selection } from "./autoController";
import { CENTER_ROI, type GrayFrame } from "./changeDetector";
import {
  assessCameraProbe, assessFrameQuality, candidateStats, pickBestCandidate,
  type CameraVerdict, type FrameQuality, type FrameSample,
} from "./monitoring";

/** Detector resolution (cheap enough for HoloLens at 2 Hz). */
const W = 80, H = 60;
/** ROI scoring resolution for burst candidates. */
const SW = 192, SH = 144;
const STALL_MS = 3000;
const START_GRACE_MS = 5000;

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { presentedFrames?: number; mediaTime?: number }) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export class MonitorCamera implements AutoCamera {
  private stream: MediaStream | null = null;
  private video: VideoWithFrameCallback | null = null;
  private statsCanvas: HTMLCanvasElement | null = null;
  private startedAt = 0;
  private lastClock = Number.NEGATIVE_INFINITY;
  private lastAdvanceAt = 0;
  private framesSeen = 0;
  private presented = 0;
  private presentedWindow: number[] = [];
  private vfcHandle: number | null = null;
  private vfcActive = false;
  deviceLabel = "";

  get live() {
    return !!this.stream?.getVideoTracks().some((t) => t.readyState === "live");
  }
  get trackState() {
    return this.stream?.getVideoTracks()[0]?.readyState ?? null;
  }
  get resolution() {
    return this.video?.videoWidth ? { width: this.video.videoWidth, height: this.video.videoHeight } : null;
  }

  async start(deviceId?: string): Promise<void> {
    this.stop();
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera unavailable in this browser");
    // Same constraints as the hardware-proven immersive capture path.
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: deviceId ? { deviceId: { exact: deviceId } } : true,
    });
    const video = document.createElement("video") as VideoWithFrameCallback;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = this.stream;
    await video.play().catch(() => undefined);
    this.video = video;
    this.deviceLabel = this.stream.getVideoTracks()[0]?.label ?? "";
    this.statsCanvas = document.createElement("canvas");
    this.statsCanvas.width = W;
    this.statsCanvas.height = H;
    this.startedAt = Date.now();
    this.lastClock = Number.NEGATIVE_INFINITY;
    this.lastAdvanceAt = 0;
    this.framesSeen = 0;
    this.presented = 0;
    this.presentedWindow = [];
    if (typeof video.requestVideoFrameCallback === "function") {
      const onFrame = (_now: number, meta: { presentedFrames?: number }) => {
        if (this.video !== video) return;
        this.vfcActive = true;
        this.presented = meta.presentedFrames ?? this.presented + 1;
        const t = Date.now();
        this.lastAdvanceAt = t;
        this.presentedWindow.push(t);
        while (this.presentedWindow.length && t - this.presentedWindow[0] > 2000) this.presentedWindow.shift();
        this.vfcHandle = video.requestVideoFrameCallback!(onFrame);
      };
      this.vfcHandle = video.requestVideoFrameCallback(onFrame);
    }
  }

  /**
   * Monotonic frame clock = media time (proven on HoloLens inside immersive
   * AR). requestVideoFrameCallback runs with page rendering, which can pause
   * while the immersive session owns the display, so it is only an extra
   * liveness signal and the FPS source — never the sole proof of life.
   */
  private clock(): number {
    return this.video?.currentTime ?? Number.NEGATIVE_INFINITY;
  }

  health(now: number): CameraHealth {
    const source = this.vfcActive && this.presentedWindow.length ? "video-frame-callback" : this.video ? "media-time" : "none";
    const ago = this.lastAdvanceAt ? now - this.lastAdvanceAt : null;
    const fresh = this.presentedWindow.length && now - this.presentedWindow[this.presentedWindow.length - 1] < 1000;
    const fps = fresh ? this.presentedWindow.length / 2 : null;
    const base = { fps, framesSeen: this.framesSeen, lastAdvanceAgoMs: ago, clockSource: source as CameraHealth["clockSource"] };
    if (!this.stream || this.trackState !== "live")
      return { ...base, state: "ended", label: "no live video track" };
    if (!this.lastAdvanceAt)
      return now - this.startedAt < START_GRACE_MS
        ? { ...base, state: "starting", label: "stream acquired, waiting for the first advancing frame" }
        : { ...base, state: "stalled", label: "stream acquired but no frame ever advanced" };
    if (ago !== null && ago > STALL_MS)
      return { ...base, state: "stalled", label: `no new frame for ${(ago / 1000).toFixed(1)} s` };
    return { ...base, state: "advancing", label: `frames advancing${fps !== null ? ` (${fps.toFixed(0)} fps)` : ""}, last ${ago ?? 0} ms ago` };
  }

  grab(): GrayFrame | null {
    const video = this.video, canvas = this.statsCanvas;
    if (!video || !canvas || video.readyState < 2 || !video.videoWidth) return null;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    const clock = this.clock();
    if (clock > this.lastClock) {
      this.lastClock = clock;
      this.framesSeen++;
      this.lastAdvanceAt = Date.now();
    }
    ctx.drawImage(video, 0, 0, W, H);
    let data: Uint8ClampedArray;
    try {
      data = ctx.getImageData(0, 0, W, H).data;
    } catch {
      return null;
    }
    const gray = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++)
      gray[i] = (data[i * 4] * 77 + data[i * 4 + 1] * 150 + data[i * 4 + 2] * 29) >> 8;
    return { gray, w: W, h: H, clock, at: Date.now() };
  }

  /**
   * Bounded burst (≤ `count` full-resolution canvases, released before
   * returning). Only the selected candidate is JPEG-encoded and returned.
   */
  async selectBest(minClock: number, count = 4, intervalMs = 160): Promise<Selection> {
    const video = this.video;
    if (!video || video.readyState < 2 || !video.videoWidth) return { ok: false, reason: "Camera has no decodable frame." };
    const vw = video.videoWidth, vh = video.videoHeight;
    const roiPx = {
      x: Math.round(CENTER_ROI.x0 * vw), y: Math.round(CENTER_ROI.y0 * vh),
      w: Math.round((CENTER_ROI.x1 - CENTER_ROI.x0) * vw), h: Math.round((CENTER_ROI.y1 - CENTER_ROI.y0) * vh),
    };
    const score = document.createElement("canvas");
    score.width = SW;
    score.height = SH;
    const sctx = score.getContext("2d", { willReadFrequently: true });
    const candidates: { canvas: HTMLCanvasElement; capturedAt: string; stats: ReturnType<typeof candidateStats> }[] = [];
    try {
      for (let attempt = 0; attempt < count * 2 && candidates.length < count; attempt++) {
        if (this.video !== video) break;
        const clock = this.clock();
        if (candidates.length && clock <= candidates[candidates.length - 1].stats.clock) {
          await new Promise((r) => setTimeout(r, intervalMs / 2));
          continue;
        }
        const canvas = document.createElement("canvas");
        canvas.width = vw;
        canvas.height = vh;
        const ctx = canvas.getContext("2d");
        if (!ctx || !sctx) break;
        ctx.drawImage(video, 0, 0);
        sctx.drawImage(canvas, roiPx.x, roiPx.y, roiPx.w, roiPx.h, 0, 0, SW, SH);
        let data: Uint8ClampedArray;
        try {
          data = sctx.getImageData(0, 0, SW, SH).data;
        } catch {
          break;
        }
        const gray = new Uint8Array(SW * SH);
        for (let i = 0; i < SW * SH; i++)
          gray[i] = (data[i * 4] * 77 + data[i * 4 + 1] * 150 + data[i * 4 + 2] * 29) >> 8;
        candidates.push({ canvas, capturedAt: new Date().toISOString(), stats: candidateStats(gray, SW, SH, clock) });
        if (candidates.length < count) await new Promise((r) => setTimeout(r, intervalMs));
      }
      const pick = pickBestCandidate(candidates.map((c) => c.stats), minClock);
      if (!pick.ok) return { ok: false, reason: pick.reason };
      const winner = candidates[pick.index];
      return {
        ok: true,
        frame: {
          snapshot: { dataUrl: winner.canvas.toDataURL("image/jpeg", 0.9), width: vw, height: vh, capturedAt: winner.capturedAt },
          clock: winner.stats.clock,
          reason: pick.reason,
          roiPx,
          sharpness: winner.stats.sharpness,
        },
      };
    } finally {
      for (const c of candidates) { c.canvas.width = 0; c.canvas.height = 0; }
      score.width = 0;
      score.height = 0;
    }
  }

  /** Probe frame freshness (manual in-AR Verify path). */
  async probe(xrActive: boolean, durationMs = 1200): Promise<CameraVerdict> {
    const frames: { frameTime: number; hash: string }[] = [];
    const started = Date.now();
    while (Date.now() - started < durationMs) {
      const s = this.sample();
      if (s) frames.push({ frameTime: s.frameTime, hash: s.hash });
      await new Promise((r) => setTimeout(r, 200));
    }
    return assessCameraProbe({
      secureContext: window.isSecureContext,
      hasMediaDevices: !!navigator.mediaDevices?.getUserMedia,
      hasXR: !!navigator.xr,
      xrActive,
      trackState: this.trackState,
      frames,
    });
  }

  /** Freshness sample (frame clock + content hash). No detector side effects. */
  sample(): FrameSample | null {
    const frame = this.grab();
    if (!frame) return null;
    let hash = 2166136261;
    for (let i = 0; i < frame.gray.length; i += 2) {
      hash ^= frame.gray[i] >> 2;
      hash = Math.imul(hash, 16777619);
    }
    return { hash: (hash >>> 0).toString(16), frameTime: frame.clock, at: frame.at };
  }

  /** Fresh frame plus reliably-detectable quality stats (black/blank). Manual path. */
  captureValidated(): { snapshot: Snapshot; quality: FrameQuality; frameTime: number } | null {
    const frame = this.grab();
    const snapshot = this.captureSnapshot();
    if (!snapshot || !frame) return null;
    let sum = 0;
    for (const v of frame.gray) sum += v;
    const mean = sum / frame.gray.length;
    let sq = 0;
    for (const v of frame.gray) sq += (v - mean) * (v - mean);
    return { snapshot, quality: assessFrameQuality(mean, sq / frame.gray.length), frameTime: frame.clock };
  }

  /** One genuinely fresh full-resolution frame, captured now. */
  captureSnapshot(): Snapshot | null {
    const video = this.video;
    if (!video || video.readyState < 2 || !video.videoWidth) return null;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    const snapshot = {
      dataUrl: canvas.toDataURL("image/jpeg", 0.85),
      width: canvas.width,
      height: canvas.height,
      capturedAt: new Date().toISOString(),
    };
    canvas.width = 0;
    canvas.height = 0;
    return snapshot;
  }

  stop() {
    if (this.video && this.vfcHandle !== null) this.video.cancelVideoFrameCallback?.(this.vfcHandle);
    this.vfcHandle = null;
    this.vfcActive = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.video = null;
    if (this.statsCanvas) { this.statsCanvas.width = 0; this.statsCanvas.height = 0; }
    this.statsCanvas = null;
  }
}

export async function listVideoDevices(): Promise<{ deviceId: string; label: string }[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  return devices
    .filter((d) => d.kind === "videoinput")
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
}
