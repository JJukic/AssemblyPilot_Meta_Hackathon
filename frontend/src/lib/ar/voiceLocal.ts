/**
 * Local voice control: HoloLens microphone audio is transcribed by Whisper
 * running locally on the MacBook backend (no cloud speech, no Meta inference).
 *
 * Two capture modes share one controller:
 *  - Continuous (default, used in AR): ONE microphone stream and ONE
 *    AudioContext are acquired and kept alive across utterances. A VAD
 *    segmenter emits utterances while transcription/dispatch run serially in
 *    the background, so speech during Whisper processing is buffered, never
 *    lost. The stream survives `requestSession("immersive-ar")` because it is
 *    never torn down per clip; it is released only on stop/dispose.
 *  - Bounded push-to-talk: one explicit utterance. When a test (or caller)
 *    injects `recordClip`, the legacy bounded-clip path is used unchanged.
 * Audio is never stored or logged; diagnostics carry levels/counts only.
 */
import { apiRequest } from "../api";
import {
  CommandGate,
  matchCommand,
  type CommandDiagnostic,
  type ExecutionOutcome,
  type MatchedCommand,
  type VoiceAction,
} from "./voice";

export interface TranscribeResult {
  matched: boolean;
  action: VoiceAction | null;
  phrase: string | null;
  language: string | null;
  transcript: string;
  duration_seconds: number;
}

/** Encode mono Float32 samples as 16-bit PCM WAV (pure, testable). */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = 44 + samples.length * 2;
  const buffer = new ArrayBuffer(bytes);
  const view = new DataView(buffer);
  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeText(0, "RIFF");
  view.setUint32(4, bytes - 8, true);
  writeText(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  });
  return new Uint8Array(buffer);
}

export function downsample(samples: Float32Array, fromRate: number, toRate = 16000): Float32Array {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) out[i] = samples[Math.floor(i * ratio)] ?? 0;
  return out;
}

export function rms(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / samples.length);
}

export interface VoiceApi {
  createSession(): Promise<{ token: string }>;
  revokeSession(token: string): Promise<void>;
  transcribe(blob: Blob, token: string, language: string): Promise<TranscribeResult>;
  status(): Promise<{ available: boolean; engine: string; model: string; reason: string }>;
}

export const backendVoiceApi: VoiceApi = {
  createSession: () => apiRequest("/api/voice/session", { method: "POST" }),
  revokeSession: async (token) => {
    await apiRequest("/api/voice/session", {
      method: "DELETE",
      headers: { "X-Voice-Session": token },
    }).catch(() => undefined);
  },
  transcribe: (blob, token, language) => {
    const body = new FormData();
    body.append("audio", blob, "clip.wav");
    body.append("language", language);
    return apiRequest("/api/voice/transcribe", {
      method: "POST",
      body,
      headers: { "X-Voice-Session": token },
    });
  },
  status: () => apiRequest("/api/voice/status"),
};

export interface RecordedClip {
  samples: Float32Array;
  sampleRate: number;
  stream: MediaStream;
  cleanup: () => void;
}

/* ------------------------------------------------------------------ */
/* Continuous capture: single stream, VAD segmentation, bounded memory */
/* ------------------------------------------------------------------ */

export type MicState = "active" | "unavailable" | "suspended" | "muted" | "off";

export interface CaptureHealth {
  mic: MicState;
  trackState: string;
  trackMuted: boolean | null;
  contextState: string;
  bufferedSamples: number;
  totalSamples: number;
  lastRms: number;
  utterances: number;
}

export interface CapturedUtterance {
  samples: Float32Array;
  sampleRate: number;
  durationMs: number;
  rms: number;
}

export type CapturePhase =
  | "recording"
  | "waiting"
  | "processing"
  | "executing"
  | "error"
  | "off";

/** Structured, audio-free diagnostic for the in-XR panel. */
export interface CaptureDiagnostic {
  mic: MicState;
  phase: CapturePhase;
  message: string;
  transcript?: string;
  action?: VoiceAction | null;
  samples?: number;
  durationMs?: number;
  rms?: number;
  trackState?: string;
  contextState?: string;
}

export interface MicCapture {
  start(): Promise<void>;
  release(): void;
  /** Next segmented utterance, or null on timeout (caller polls health). */
  nextUtterance(timeoutMs?: number): Promise<CapturedUtterance | null>;
  /** Emit the in-progress utterance now (push-to-talk inside AR). */
  flush(): void;
  health(): CaptureHealth;
  /** Resume a suspended context; re-acquire only if the track has ended. */
  ensureAlive(): Promise<boolean>;
}

const SPEECH_RMS = 0.012;
const SILENCE_CHUNKS = 9; // ≈765 ms at 4096 samples / 48 kHz
const PRE_ROLL_CHUNKS = 3;
const MAX_QUEUE = 3;

interface CaptureEnv {
  getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
  audioContext?: typeof AudioContext;
  speechRms?: number;
  silenceChunks?: number;
  maxUtteranceMs?: number;
}

type TrackLike = {
  readyState?: string;
  muted?: boolean;
  stop: () => void;
  onended?: (() => void) | null;
};
type StreamLike = { getTracks: () => TrackLike[]; getAudioTracks?: () => TrackLike[] };
type ProcessorLike = {
  onaudioprocess: ((e: { inputBuffer: { getChannelData: (n: number) => Float32Array } }) => void) | null;
  connect: (dest: unknown) => void;
  disconnect: () => void;
};
type ContextLike = {
  state?: string;
  sampleRate: number;
  destination?: unknown;
  createMediaStreamSource: (s: StreamLike) => { connect: (d: unknown) => void; disconnect: () => void };
  createScriptProcessor: (a: number, b: number, c: number) => ProcessorLike;
  resume?: () => Promise<void>;
  close?: () => Promise<void>;
};

export class PersistentMicCapture implements MicCapture {
  private stream: StreamLike | null = null;
  private context: ContextLike | null = null;
  private source: { connect: (d: unknown) => void; disconnect: () => void } | null = null;
  private processor: ProcessorLike | null = null;
  private released = false;
  private chunks: Float32Array[] = [];
  private preRoll: Float32Array[] = [];
  private inUtterance = false;
  private silenceRun = 0;
  private lastSpeechChunk = 0;
  private queue: CapturedUtterance[] = [];
  private waiters: { resolve: (u: CapturedUtterance | null) => void; timer?: ReturnType<typeof setTimeout> }[] = [];
  private totalSamples = 0;
  private lastRms = 0;
  private utteranceCount = 0;
  onUnavailable: (() => void) | null = null;

  constructor(private env: CaptureEnv = {}) {}

  async start(): Promise<void> {
    if (this.stream && this.context) return;
    this.released = false;
    await this.acquire();
  }

  private async acquire(): Promise<void> {
    const gum =
      this.env.getUserMedia ??
      (typeof navigator !== "undefined"
        ? navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices)
        : undefined);
    if (!gum) throw new Error("Microphone unavailable");
    const stream = (await gum({ audio: true })) as unknown as StreamLike;
    if (this.released) {
      stream.getTracks().forEach((t) => t.stop());
      throw new DOMException("Recording cancelled", "AbortError");
    }
    const Ctor =
      this.env.audioContext ??
      (typeof window !== "undefined"
        ? (window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
        : undefined);
    if (!Ctor) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error("Microphone unavailable");
    }
    const context = new Ctor() as unknown as ContextLike;
    this.stream = stream;
    this.context = context;
    if (context.state === "suspended" && context.resume) {
      await context.resume().catch(() => undefined);
    }
    const track = stream.getAudioTracks?.()[0] ?? stream.getTracks()[0];
    if (track) track.onended = () => this.onUnavailable?.();
    this.source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    this.processor = processor;
    processor.onaudioprocess = (event) => {
      if (this.released || !this.context) return;
      try {
        this.pushChunk(new Float32Array(event.inputBuffer.getChannelData(0)));
      } catch {
        /* a torn-down context must never break the XR frame loop */
      }
    };
    this.source.connect(processor);
    try {
      if (context.destination) processor.connect(context.destination);
    } catch {
      /* destination is optional for capture on some browsers */
    }
  }

  private pushChunk(chunk: Float32Array) {
    const level = rms(chunk);
    this.lastRms = level;
    this.totalSamples += chunk.length;
    const speech = level >= (this.env.speechRms ?? SPEECH_RMS);
    if (!this.inUtterance) {
      this.preRoll.push(chunk);
      if (this.preRoll.length > PRE_ROLL_CHUNKS) this.preRoll.shift();
      if (!speech) return;
      this.inUtterance = true;
      this.chunks = [...this.preRoll];
      this.preRoll = [];
      this.silenceRun = 0;
      this.lastSpeechChunk = this.chunks.length - 1;
      return;
    }
    this.chunks.push(chunk);
    if (speech) {
      this.silenceRun = 0;
      this.lastSpeechChunk = this.chunks.length - 1;
    } else if (++this.silenceRun >= (this.env.silenceChunks ?? SILENCE_CHUNKS)) {
      this.emit();
      return;
    }
    const maxMs = this.env.maxUtteranceMs ?? 6000;
    const rate = this.context?.sampleRate ?? 48000;
    if ((this.chunks.length * 4096) / rate >= maxMs / 1000) this.emit();
  }

  private emit() {
    if (!this.context || !this.chunks.length) {
      this.inUtterance = false;
      this.chunks = [];
      return;
    }
    const keep = this.chunks.slice(0, this.lastSpeechChunk + 1 + PRE_ROLL_CHUNKS);
    const total = keep.reduce((n, c) => n + c.length, 0);
    const samples = new Float32Array(total);
    let offset = 0;
    for (const c of keep) {
      samples.set(c, offset);
      offset += c.length;
    }
    this.chunks = [];
    this.inUtterance = false;
    this.silenceRun = 0;
    if (total < 1200) return; // click / breath, not an utterance
    const rate = this.context.sampleRate;
    const utterance: CapturedUtterance = {
      samples,
      sampleRate: rate,
      durationMs: Math.round((total / rate) * 1000),
      rms: rms(samples),
    };
    this.utteranceCount++;
    const waiter = this.waiters.shift();
    if (waiter) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve(utterance);
    } else {
      this.queue.push(utterance);
      if (this.queue.length > MAX_QUEUE) this.queue.shift(); // bounded memory
    }
  }

  flush(): void {
    if (this.inUtterance) this.emit();
  }

  nextUtterance(timeoutMs = 1500): Promise<CapturedUtterance | null> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    if (this.released) return Promise.resolve(null);
    return new Promise((resolve) => {
      const waiter: { resolve: (u: CapturedUtterance | null) => void; timer?: ReturnType<typeof setTimeout> } = {
        resolve,
      };
      if (timeoutMs > 0) {
        waiter.timer = setTimeout(() => {
          this.waiters = this.waiters.filter((w) => w !== waiter);
          resolve(null);
        }, timeoutMs);
      }
      this.waiters.push(waiter);
    });
  }

  health(): CaptureHealth {
    const track = this.stream
      ? (this.stream.getAudioTracks?.()[0] ?? this.stream.getTracks()[0])
      : undefined;
    const trackState = track?.readyState ?? "none";
    const contextState = this.context?.state ?? "none";
    let mic: MicState = "off";
    if (this.stream && track) {
      if (trackState !== "live") mic = "unavailable";
      else if (track.muted) mic = "muted";
      else if (contextState === "suspended") mic = "suspended";
      else mic = "active";
    } else if (this.stream) mic = "unavailable";
    return {
      mic,
      trackState,
      trackMuted: track ? (track.muted ?? null) : null,
      contextState,
      bufferedSamples: this.queue.reduce((n, u) => n + u.samples.length, 0),
      totalSamples: this.totalSamples,
      lastRms: this.lastRms,
      utterances: this.utteranceCount,
    };
  }

  async ensureAlive(): Promise<boolean> {
    if (this.released || !this.stream || !this.context) return false;
    const h = this.health();
    if (h.mic === "active") return true;
    if (h.contextState === "suspended" && this.context.resume) {
      await this.context.resume().catch(() => undefined);
      if (this.health().mic === "active") return true;
    }
    if (h.trackState !== "live" && h.trackState !== "none") {
      // Track ended (e.g. XR entry interrupted it): rebuild once, same stream
      // lifecycle — this is recovery, not a per-clip permission request.
      this.teardownPipeline();
      try {
        await this.acquire();
        return this.health().mic === "active";
      } catch {
        return false;
      }
    }
    return this.health().mic === "active";
  }

  private teardownPipeline() {
    try {
      this.processor?.disconnect();
    } catch { /* already disconnected */ }
    try {
      this.source?.disconnect();
    } catch { /* already disconnected */ }
    if (this.processor) this.processor.onaudioprocess = null;
    this.processor = null;
    this.source = null;
    this.stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    this.stream = null;
    const ctx = this.context;
    this.context = null;
    void ctx?.close?.().catch(() => undefined);
    this.chunks = [];
    this.preRoll = [];
    this.inUtterance = false;
  }

  release(): void {
    this.released = true;
    this.teardownPipeline();
    this.queue = [];
    const waiters = this.waiters;
    this.waiters = [];
    waiters.forEach((w) => {
      if (w.timer) clearTimeout(w.timer);
      w.resolve(null);
    });
  }
}

export interface LocalVoiceDeps {
  api?: VoiceApi;
  /** Inject a bounded clip recorder (push-to-talk tests / legacy path). */
  recordClip?: (maxMs: number, signal?: AbortSignal) => Promise<RecordedClip>;
  /** Inject continuous capture (tests); default PersistentMicCapture. */
  captureFactory?: () => MicCapture;
  onCommand: (cmd: MatchedCommand) => Promise<ExecutionOutcome | void>;
  onDiagnostic?: (diagnostic: CommandDiagnostic) => void;
  onCaptureDiagnostic?: (diagnostic: CaptureDiagnostic) => void;
  onStatus?: (status: string) => void;
  onError?: (message: string) => void;
  onListeningChange?: (listening: boolean) => void;
  language?: string;
  windowMs?: number;
}

const SILENCE_RMS = 0.008;

export class LocalVoiceController {
  // One segmented utterance is transcribed exactly once; consecutive clips /
  // utterances are legitimate repeats. Duplicate protection is the pending
  // lock plus one-action-per-utterance, not a same-action cooldown.
  readonly gate = new CommandGate(0);
  private api: VoiceApi;
  private token: string | null = null;
  private running = false;
  private starting = false;
  private busy = false;
  private processing = false;
  private generation = 0;
  private recording: AbortController | null = null;
  private clipCleanup: (() => void) | null = null;
  private failures = 0;
  private capture: MicCapture | null = null;
  private xrActive = false;
  private lastHealthMic: MicState | null = null;
  constructor(private deps: LocalVoiceDeps) {
    this.api = deps.api ?? backendVoiceApi;
  }
  get isListening() {
    return this.running;
  }
  get isBusy() {
    return this.running || this.starting || this.busy;
  }
  get isProcessing() {
    return this.processing;
  }
  get inXR() {
    return this.xrActive;
  }
  captureHealth(): CaptureHealth | null {
    return this.capture?.health() ?? null;
  }
  private get legacy() {
    return !!this.deps.recordClip;
  }
  private emitCapture(d: Partial<CaptureDiagnostic> & { message: string }) {
    const h = this.capture?.health();
    this.deps.onCaptureDiagnostic?.({
      mic: h?.mic ?? "off",
      phase: this.processing ? "processing" : this.running ? "recording" : "off",
      trackState: h?.trackState,
      contextState: h?.contextState,
      ...d,
    });
  }
  private async openSession(epoch: number): Promise<boolean> {
    if (this.token) return true;
    try {
      const session = await this.api.createSession();
      if (epoch !== this.generation) {
        void this.api.revokeSession(session.token);
        return false;
      }
      this.token = session.token;
      return true;
    } catch {
      if (epoch === this.generation)
        this.deps.onError?.("Could not start a local voice session. Check the backend connection.");
      return false;
    }
  }
  async start(): Promise<boolean> {
    if (this.running) return true;
    if (this.isBusy) return false;
    this.starting = true;
    const epoch = this.generation;
    try {
      if (!(await this.openSession(epoch))) return false;
    } finally {
      this.starting = false;
    }
    if (epoch !== this.generation) return false;
    if (this.legacy) {
      this.running = true;
      this.failures = 0;
      this.deps.onListeningChange?.(true);
      void this.loop(epoch);
      return true;
    }
    // Continuous path: acquire the single persistent stream BEFORE claiming
    // to listen. A permission/device failure never reports "Listening".
    const capture = (this.capture ??= (this.deps.captureFactory ?? (() => new PersistentMicCapture()))());
    try {
      await capture.start();
    } catch (cause) {
      if (epoch !== this.generation) return false;
      const name = (cause as { name?: string } | null)?.name ?? "";
      this.deps.onError?.(
        name === "NotAllowedError"
          ? "Microphone permission was denied. Allow microphone access, then enable local voice again."
          : "Microphone is unavailable on this device/browser.",
      );
      this.emitCapture({ phase: "error", message: "Microphone unavailable — not listening" });
      this.teardownToken();
      return false;
    }
    if (epoch !== this.generation) {
      capture.release();
      return false;
    }
    this.running = true;
    this.failures = 0;
    this.deps.onListeningChange?.(true);
    const health = capture.health();
    if (health.mic === "active") {
      this.deps.onStatus?.(
        `Listening (${this.deps.language ?? "en"}) — microphone active. Speak one complete command; capture continues while processing.`,
      );
    } else {
      this.deps.onStatus?.(
        `Microphone ${health.mic} (track ${health.trackState}, audio ${health.contextState}) — not yet capturing. Trying to recover…`,
      );
    }
    this.emitCapture({ message: `Microphone ${health.mic}` });
    void this.continuousLoop(epoch);
    return true;
  }

  /** XR lifecycle hook: entering immersive AR must not recreate the stream. */
  setXRActive(active: boolean) {
    this.xrActive = active;
    if (!active) return;
    this.emitCapture({ message: "Entered immersive AR — keeping the existing microphone stream" });
    if (this.capture && this.running) {
      void this.capture.ensureAlive().then((ok) => {
        if (!this.running) return;
        if (ok) {
          this.deps.onStatus?.(
            `Listening (${this.deps.language ?? "en"}) in AR — microphone active. Say a command such as “Show result”.`,
          );
          this.emitCapture({ message: "Microphone active in immersive AR" });
        } else {
          const h = this.capture?.health();
          this.deps.onError?.(
            `Microphone is not capturing inside AR (track ${h?.trackState ?? "?"}, audio ${h?.contextState ?? "?"}). Use the in-AR Speak button or Next/Previous panel buttons.`,
          );
          this.emitCapture({ phase: "error", message: "Microphone not capturing in AR" });
        }
      });
    }
  }

  /** Explicit in-AR push-to-talk: flush the current utterance, or listen for one. */
  async pushToTalk(): Promise<void> {
    if (this.running && this.capture) {
      this.capture.flush();
      this.deps.onStatus?.("Push-to-talk: processing what you just said — keep speaking for the next command.");
      this.emitCapture({ message: "Push-to-talk utterance sent for transcription" });
      return;
    }
    await this.recordOnce();
  }

  /** One explicit push-to-talk clip (outside AR, or AR fallback). */
  async recordOnce(): Promise<void> {
    if (this.running) {
      await this.pushToTalk();
      return;
    }
    if (this.isBusy) {
      this.deps.onStatus?.("A voice command is already recording, processing or executing. Wait for the next listening window.");
      return;
    }
    if (this.legacy) {
      await this.runClip(this.generation);
      return;
    }
    this.busy = true;
    const epoch = this.generation;
    try {
      if (!(await this.openSession(epoch))) return;
      const capture = (this.capture ??= (this.deps.captureFactory ?? (() => new PersistentMicCapture()))());
      try {
        await capture.start();
      } catch (cause) {
        const name = (cause as { name?: string } | null)?.name ?? "";
        this.deps.onError?.(
          name === "NotAllowedError"
            ? "Microphone permission was denied. Allow microphone access, then enable local voice again."
            : "Microphone is unavailable on this device/browser.",
        );
        return;
      }
      this.deps.onStatus?.(`Push-to-talk (${this.deps.language ?? "en"}): speak one complete command now.`);
      this.emitCapture({ phase: "recording", message: "Push-to-talk recording" });
      let utterance = await capture.nextUtterance(this.deps.windowMs ?? 6000);
      if (!utterance) {
        capture.flush();
        utterance = await capture.nextUtterance(400);
      }
      if (epoch !== this.generation) return;
      if (!utterance) {
        this.deps.onStatus?.("Push-to-talk: no speech heard. Try again and speak one complete command.");
        this.emitCapture({ phase: "waiting", message: "Push-to-talk heard no speech" });
        return;
      }
      await this.processSamples(utterance.samples, utterance.sampleRate, epoch);
    } finally {
      this.capture?.release();
      this.capture = null;
      this.busy = false;
    }
  }

  private async continuousLoop(epoch: number) {
    const capture = this.capture;
    if (!capture) return;
    while (this.running && epoch === this.generation) {
      let utterance: CapturedUtterance | null = null;
      try {
        utterance = await capture.nextUtterance(1200);
      } catch {
        break;
      }
      if (!this.running || epoch !== this.generation) break;
      if (!utterance) {
        // Health poll: never sit on a generic "Listening" while suspended,
        // muted, ended or silent. Try one resume/recovery, then report.
        const h = capture.health();
        if (h.mic !== this.lastHealthMic) {
          this.lastHealthMic = h.mic;
          if (h.mic === "active") {
            this.deps.onStatus?.(`Listening (${this.deps.language ?? "en"}) — microphone active.`);
          } else if (h.mic !== "off") {
            this.deps.onStatus?.(
              `Microphone ${h.mic} (track ${h.trackState}, audio ${h.contextState}, last level ${h.lastRms.toFixed(3)}) — not capturing speech right now.`,
            );
          }
          this.emitCapture({ message: `Microphone ${h.mic}` });
        }
        if (h.mic === "suspended" || h.mic === "unavailable" || h.mic === "muted") {
          const ok = await capture.ensureAlive().catch(() => false);
          if (!ok && h.trackState !== "live") {
            this.deps.onError?.(
              "Microphone stopped capturing (track ended). Voice is off — re-enable local voice; in AR use Speak / Next / Previous.",
            );
            this.emitCapture({ phase: "error", message: "Microphone track ended" });
            break;
          }
        }
        continue;
      }
      this.lastHealthMic = "active";
      const keepGoing = await this.processSamples(utterance.samples, utterance.sampleRate, epoch);
      if (!keepGoing) break;
    }
    if (this.running && epoch === this.generation) this.stop();
  }

  /** Transcribe + validate + dispatch one captured utterance (serial). */
  private async processSamples(
    rawSamples: Float32Array,
    sampleRate: number,
    epoch: number,
  ): Promise<boolean> {
    if (!this.token) return false;
    const token = this.token;
    const samples = downsample(rawSamples, sampleRate, 16000);
    const level = rms(samples);
    const durationMs = Math.round((samples.length / 16000) * 1000);
    if (level < SILENCE_RMS) {
      this.deps.onStatus?.("Listening… no speech heard in that window.");
      this.emitCapture({
        phase: "waiting",
        message: "Silent window skipped (no transcription sent)",
        samples: samples.length,
        durationMs,
        rms: level,
      });
      return true;
    }
    this.processing = true;
    this.emitCapture({
      phase: "processing",
      message: "Transcribing locally with Whisper… (microphone still capturing)",
      samples: samples.length,
      durationMs,
      rms: level,
    });
    this.deps.onStatus?.(
      `Processing ${(samples.length / 16000).toFixed(1)} s locally (${this.deps.language ?? "en"}) — microphone still capturing; you may keep speaking.`,
    );
    try {
      const wav = encodeWav(samples, 16000);
      const result = await this.api.transcribe(
        new Blob([wav.buffer as ArrayBuffer], { type: "audio/wav" }),
        token,
        this.deps.language ?? "en",
      );
      if (epoch !== this.generation) return false;
      this.failures = 0;
      await this.handleTranscript(result, epoch);
      return true;
    } catch (cause) {
      if (epoch !== this.generation) return false;
      this.failures++;
      this.deps.onError?.(
        `Local voice failed (${this.failures}/3): ${cause instanceof Error ? cause.message : "backend unavailable"}`,
      );
      this.emitCapture({ phase: "error", message: "Transcription failed" });
      return this.failures < 3;
    } finally {
      this.processing = false;
    }
  }

  private async handleTranscript(result: TranscribeResult, epoch: number): Promise<void> {
    if (epoch !== this.generation) return;
    if (!result.matched || !result.action) {
      if (result.transcript.trim())
        this.deps.onDiagnostic?.({
          transcript: result.transcript,
          action: null,
          state: "rejected",
          reason: "Phrase not recognized",
        });
      this.emitCapture({
        phase: "waiting",
        message: result.transcript.trim() ? "Phrase not recognized" : "No speech transcribed",
        transcript: result.transcript,
        action: null,
      });
      return;
    }
    const matched: MatchedCommand = {
      action: result.action,
      phrase: result.phrase ?? result.transcript,
      language: result.language === "de" ? "de" : "en",
    };
    // Validate the actual transcript, never a backend-supplied replacement.
    const localMatch = matchCommand(result.transcript);
    if (!localMatch || localMatch.action !== matched.action) {
      this.deps.onDiagnostic?.({
        transcript: result.transcript,
        action: matched.action,
        state: "rejected",
        reason: "Frontend validation rejected the backend result",
      });
      this.emitCapture({
        phase: "waiting",
        message: "Frontend validation rejected the backend result",
        transcript: result.transcript,
        action: matched.action,
      });
      return;
    }
    if (!this.gate.tryAccept(matched.action)) {
      this.deps.onDiagnostic?.({
        transcript: result.transcript,
        action: matched.action,
        state: "rejected",
        reason: this.gate.isPending
          ? "Another command is still executing"
          : "Duplicate command suppressed",
      });
      this.emitCapture({
        phase: "waiting",
        message: this.gate.isPending ? "Another command is still executing" : "Duplicate suppressed",
        transcript: result.transcript,
        action: matched.action,
      });
      return;
    }
    this.deps.onDiagnostic?.({
      transcript: result.transcript,
      action: matched.action,
      state: "executing",
    });
    this.emitCapture({
      phase: "executing",
      message: `Executing “${matched.action}”`,
      transcript: result.transcript,
      action: matched.action,
    });
    this.gate.setPending(true);
    try {
      const outcome = await this.deps.onCommand(matched);
      this.deps.onDiagnostic?.({
        transcript: result.transcript,
        action: matched.action,
        state: !outcome || outcome.ok ? "completed" : "failed",
        reason: outcome && !outcome.ok ? outcome.reason : undefined,
        detail: outcome?.detail,
      });
      this.emitCapture({
        phase: "waiting",
        message: !outcome || outcome.ok ? `Executed “${matched.action}”` : `Command failed: ${outcome.reason ?? "unknown"}`,
        transcript: result.transcript,
        action: matched.action,
      });
    } catch (cause) {
      this.deps.onDiagnostic?.({
        transcript: result.transcript,
        action: matched.action,
        state: "failed",
        reason: cause instanceof Error ? cause.message : "Command execution failed",
      });
      this.emitCapture({
        phase: "error",
        message: "Command execution failed",
        transcript: result.transcript,
        action: matched.action,
      });
    } finally {
      this.gate.setPending(false);
    }
  }

  /* ---------------- legacy bounded-clip path (injected recordClip) ---------------- */
  private async loop(epoch: number) {
    while (this.running && epoch === this.generation) {
      const keepGoing = await this.runClip(epoch);
      if (!keepGoing) break;
      if (this.running) await new Promise((r) => setTimeout(r, 350));
    }
    if (this.running && epoch === this.generation) this.stop();
  }
  private async runClip(epoch: number): Promise<boolean> {
    if (this.busy || epoch !== this.generation) return false;
    this.busy = true;
    try {
      if (!(await this.openSession(epoch))) return false;
      return await this.processOneClip(epoch);
    } finally {
      this.busy = false;
    }
  }
  private async processOneClip(epoch: number): Promise<boolean> {
    if (!this.token) return false;
    let clip: RecordedClip;
    const recording = new AbortController();
    this.recording = recording;
    try {
      this.deps.onStatus?.(`Listening (${this.deps.language ?? "en"})… speak one complete command during this four-second window.`);
      clip = await (this.deps.recordClip as NonNullable<LocalVoiceDeps["recordClip"]>)(
        this.deps.windowMs ?? 4000,
        recording.signal,
      );
    } catch (cause) {
      if (epoch !== this.generation) return false;
      const name = (cause as { name?: string } | null)?.name ?? "";
      this.deps.onError?.(
        name === "NotAllowedError"
          ? "Microphone permission was denied. Allow microphone access, then enable local voice again."
          : "Microphone is unavailable on this device/browser.",
      );
      return false;
    } finally {
      if (this.recording === recording) this.recording = null;
    }
    this.clipCleanup = clip.cleanup;
    try {
      clip.cleanup();
      if (epoch !== this.generation) return false;
      this.processing = true;
      try {
        const samples = downsample(clip.samples, clip.sampleRate, 16000);
        if (rms(samples) < SILENCE_RMS) {
          this.deps.onStatus?.("Listening… no speech heard in that window.");
          return true;
        }
        const wav = encodeWav(samples, 16000);
        this.deps.onStatus?.(`Processing ${(samples.length / 16000).toFixed(1)} s locally (${this.deps.language ?? "en"}) — wait before the next command.`);
        const result = await this.api.transcribe(
          new Blob([wav.buffer as ArrayBuffer], { type: "audio/wav" }),
          this.token,
          this.deps.language ?? "en",
        );
        if (epoch !== this.generation) return false;
        this.failures = 0;
        await this.handleTranscript(result, epoch);
        return true;
      } finally {
        this.processing = false;
      }
    } catch (cause) {
      if (epoch !== this.generation) return false;
      this.failures++;
      this.deps.onError?.(
        `Local voice failed (${this.failures}/3): ${cause instanceof Error ? cause.message : "backend unavailable"}`,
      );
      return this.failures < 3;
    } finally {
      clip.cleanup();
      if (this.clipCleanup === clip.cleanup) this.clipCleanup = null;
    }
  }

  private teardownToken() {
    if (this.token) {
      const token = this.token;
      this.token = null;
      void this.api.revokeSession(token);
    }
  }
  stop() {
    this.generation++;
    this.running = false;
    this.recording?.abort();
    this.recording = null;
    this.gate.reset();
    this.clipCleanup?.();
    this.clipCleanup = null;
    this.capture?.release();
    this.capture = null;
    this.processing = false;
    this.lastHealthMic = null;
    this.teardownToken();
    this.deps.onListeningChange?.(false);
    this.deps.onStatus?.("Local voice off. Microphone released.");
    this.emitCapture({ phase: "off", mic: "off", message: "Local voice off. Microphone released." });
  }
  dispose() {
    this.stop();
  }
}

/** Browser recorder: getUserMedia + AudioContext -> one bounded PCM clip. */
export async function recordMicClip(maxMs: number, signal?: AbortSignal): Promise<RecordedClip> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone unavailable");
  if (signal?.aborted) throw new DOMException("Recording cancelled", "AbortError");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const AudioCtor: typeof AudioContext =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let processor: ScriptProcessorNode | undefined;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      processor?.disconnect();
      source?.disconnect();
    } catch {
      /* already disconnected */
    }
    stream.getTracks().forEach((track) => track.stop());
    void context?.close().catch(() => {});
  };
  try {
    if (signal?.aborted) throw new DOMException("Recording cancelled", "AbortError");
    context = new AudioCtor();
    if (context.state === "suspended") await context.resume().catch(() => undefined);
    source = context.createMediaStreamSource(stream);
    processor = context.createScriptProcessor(4096, 1, 1);
    const chunks: Float32Array[] = [];
    processor.onaudioprocess = (event) => {
      if (!cleaned) chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    };
    source.connect(processor);
    processor.connect(context.destination);
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new DOMException("Recording cancelled", "AbortError")); };
      const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, maxMs);
      signal?.addEventListener("abort", abort, { once: true });
    });
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const samples = new Float32Array(total);
    let offset = 0;
    for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
    return { samples, sampleRate: context.sampleRate, stream, cleanup };
  } finally {
    cleanup();
  }
}
