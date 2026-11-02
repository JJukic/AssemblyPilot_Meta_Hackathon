/**
 * Browser camera monitor for Autonomous Assembly.
 *
 * Owns ONE getUserMedia video stream (HoloLens camera attempt, a
 * browser-enumerated external/USB camera, or a companion-device camera),
 * computes cheap downscaled statistics for FrameGate, and captures fresh
 * JPEG snapshots on demand. Frames are never stored or uploaded by the
 * monitor itself; only an explicitly triggered inspection uploads one
 * fresh snapshot through the existing Meta pipeline.
 */
import type { Snapshot } from "@/types/assembly";
import { assessCameraProbe, type CameraVerdict, type FrameSample } from "./monitoring";

const W = 64, H = 48;

export class MonitorCamera {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private statsCanvas: HTMLCanvasElement | null = null;
  private prev: Uint8Array | null = null;
  deviceLabel = "";

  get live() {
    return !!this.stream?.getVideoTracks().some((t) => t.readyState === "live");
  }
  get trackState() {
    return this.stream?.getVideoTracks()[0]?.readyState ?? null;
  }

  async start(deviceId?: string): Promise<void> {
    this.stop();
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera unavailable in this browser");
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: deviceId ? { deviceId: { exact: deviceId } } : true,
    });
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = this.stream;
    await video.play().catch(() => undefined);
    this.video = video;
    this.deviceLabel = this.stream.getVideoTracks()[0]?.label ?? "";
    this.statsCanvas = document.createElement("canvas");
    this.statsCanvas.width = W;
    this.statsCanvas.height = H;
    this.prev = null;
  }

  /** Probe frame freshness (used inside and outside immersive AR). */
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

  sample(): FrameSample | null {
    const video = this.video, canvas = this.statsCanvas;
    if (!video || !canvas || video.readyState < 2 || !video.videoWidth) return null;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, W, H);
    let data: Uint8ClampedArray;
    try {
      data = ctx.getImageData(0, 0, W, H).data;
    } catch {
      return null;
    }
    const gray = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) gray[i] = data[i * 4];
    const prev = this.prev;
    this.prev = gray;
    let hash = 2166136261;
    for (let i = 0; i < gray.length; i += 2) {
      hash ^= gray[i] >> 2;
      hash = Math.imul(hash, 16777619);
    }
    const inRoi = (x: number, y: number) => x >= 16 && x < 48 && y >= 12 && y < 36;
    let roiSum = 0, roiN = 0, outSum = 0, outN = 0, sharp = 0, sharpN = 0;
    if (prev) {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const d = Math.abs(gray[i] - prev[i]) / 255;
        if (inRoi(x, y)) { roiSum += d; roiN++; } else { outSum += d; outN++; }
        if (inRoi(x, y) && x + 1 < W) { sharp += Math.abs(gray[i] - gray[i + 1]); sharpN++; }
      }
    }
    const sharpness = sharpN ? sharp / sharpN : 0;
    return {
      hash: (hash >>> 0).toString(16),
      roiDiff: roiN ? roiSum / roiN : 0,
      outsideDiff: outN ? outSum / outN : 0,
      sharpness,
      frameTime: video.currentTime,
      at: Date.now(),
      occluded: sharpness > 0 && sharpness < 1.5,
    };
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
    return {
      dataUrl: canvas.toDataURL("image/jpeg", 0.85),
      width: canvas.width,
      height: canvas.height,
      capturedAt: new Date().toISOString(),
    };
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.video = null;
    this.prev = null;
  }
}

export async function listVideoDevices(): Promise<{ deviceId: string; label: string }[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  return devices
    .filter((d) => d.kind === "videoinput")
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
}
