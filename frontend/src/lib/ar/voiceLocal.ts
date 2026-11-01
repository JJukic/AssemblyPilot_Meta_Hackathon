/**
 * Local voice control: HoloLens microphone clips are transcribed by Whisper
 * running locally on the MacBook backend (no cloud speech, no Meta inference).
 * Bounded listening windows + push-to-talk; audio is never stored.
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

export interface LocalVoiceDeps {
  api?: VoiceApi;
  /** Record one bounded clip. Default uses getUserMedia + WebAudio in-browser. */
  recordClip?: (maxMs: number, signal?: AbortSignal) => Promise<RecordedClip>;
  onCommand: (cmd: MatchedCommand) => Promise<ExecutionOutcome | void>;
  onDiagnostic?: (diagnostic: CommandDiagnostic) => void;
  onStatus?: (status: string) => void;
  onError?: (message: string) => void;
  onListeningChange?: (listening: boolean) => void;
  language?: string;
  windowMs?: number;
}

const SILENCE_RMS = 0.008;

export class LocalVoiceController {
  // One bounded clip is one utterance and is transcribed exactly once, so a
  // repeated phrase in the NEXT clip is a new legitimate command (e.g.
  // consecutive "Previous Step"). Duplicate protection here is the pending
  // lock plus one-action-per-clip, not a same-action cooldown.
  readonly gate = new CommandGate(0);
  private api: VoiceApi;
  private token: string | null = null;
  private running = false;
  private starting = false;
  private busy = false;
  private generation = 0;
  private recording: AbortController | null = null;
  private clipCleanup: (() => void) | null = null;
  private failures = 0;
  constructor(private deps: LocalVoiceDeps) {
    this.api = deps.api ?? backendVoiceApi;
  }
  get isListening() {
    return this.running;
  }
  get isBusy() { return this.running || this.starting || this.busy; }
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
      if (!await this.openSession(epoch)) return false;
    } finally {
      this.starting = false;
    }
    if (epoch !== this.generation) return false;
    this.running = true;
    this.failures = 0;
    this.deps.onListeningChange?.(true);
    void this.loop(epoch);
    return true;
  }
  /** One explicit push-to-talk clip (also used as the bounded-window fallback). */
  async recordOnce(): Promise<void> {
    if (this.isBusy) {
      this.deps.onStatus?.("A voice command is already recording, processing or executing. Wait for the next listening window.");
      return;
    }
    await this.runClip(this.generation);
  }
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
      if (!await this.openSession(epoch)) return false;
      return await this.processOneClip(epoch);
    } finally { this.busy = false; }
  }
  private async processOneClip(epoch: number): Promise<boolean> {
    if (!this.token) return false;
    const token = this.token;
    let clip: RecordedClip;
    const recording = new AbortController();
    this.recording = recording;
    try {
      this.deps.onStatus?.(`Listening (${this.deps.language ?? "en"})… speak one complete command during this four-second window.`);
      clip = await (this.deps.recordClip ?? recordMicClip)(this.deps.windowMs ?? 4000, recording.signal);
    } catch (cause) {
      if (epoch !== this.generation) return false;
      const name = (cause as { name?: string } | null)?.name ?? "";
      this.deps.onError?.(
        name === "NotAllowedError"
          ? "Microphone permission was denied. Allow microphone access, then enable local voice again."
          : "Microphone is unavailable on this device/browser.",
      );
      return false; // permission/device errors never loop
    } finally {
      if (this.recording === recording) this.recording = null;
    }
    this.clipCleanup = clip.cleanup;
    try {
      clip.cleanup(); // Capture ends before waiting for Whisper or dispatch.
      if (epoch !== this.generation) return false;
      const samples = downsample(clip.samples, clip.sampleRate, 16000);
      if (rms(samples) < SILENCE_RMS) {
        this.deps.onStatus?.("Listening… no speech heard in that window.");
        return true;
      }
      const wav = encodeWav(samples, 16000);
      this.deps.onStatus?.(`Processing ${(samples.length / 16000).toFixed(1)} s locally (${this.deps.language ?? "en"}) — wait before the next command.`);
      const result = await this.api.transcribe(
        new Blob([wav.buffer as ArrayBuffer], { type: "audio/wav" }),
        token,
        this.deps.language ?? "en",
      );
      if (epoch !== this.generation) return false;
      this.failures = 0;
      if (!result.matched || !result.action) {
        // Empty transcripts (silence) never overwrite a real command result.
        if (result.transcript.trim())
          this.deps.onDiagnostic?.({
            transcript: result.transcript,
            action: null,
            state: "rejected",
            reason: "Phrase not recognized",
          });
        return true;
      }
      const matched: MatchedCommand = {
        action: result.action,
        phrase: result.phrase ?? result.transcript,
        language: result.language === "de" ? "de" : "en",
      };
      // Validate the actual transcript, never a backend-supplied replacement
      // phrase that could hide negation or unrelated speech.
      const localMatch = matchCommand(result.transcript);
      if (!localMatch || localMatch.action !== matched.action) {
        this.deps.onDiagnostic?.({
          transcript: result.transcript,
          action: matched.action,
          state: "rejected",
          reason: "Frontend validation rejected the backend result",
        });
        return true;
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
        return true;
      }
      this.deps.onDiagnostic?.({
        transcript: result.transcript,
        action: matched.action,
        state: "executing",
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
      } catch (cause) {
        this.deps.onDiagnostic?.({
          transcript: result.transcript,
          action: matched.action,
          state: "failed",
          reason: cause instanceof Error ? cause.message : "Command execution failed",
        });
      } finally {
        this.gate.setPending(false);
      }
      return true;
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
  stop() {
    this.generation++;
    this.running = false;
    this.recording?.abort();
    this.recording = null;
    this.gate.reset();
    this.clipCleanup?.();
    this.clipCleanup = null;
    if (this.token) {
      const token = this.token;
      this.token = null;
      void this.api.revokeSession(token);
    }
    this.deps.onListeningChange?.(false);
    this.deps.onStatus?.("Local voice off. Microphone released.");
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
    source = context.createMediaStreamSource(stream);
    processor = context.createScriptProcessor(4096, 1, 1);
    const chunks: Float32Array[] = [];
    processor.onaudioprocess = (event) => {
      if (!cleaned) chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    };
    source.connect(processor);
    processor.connect(context.destination);
    // Restore the known working bounded window. A click/breath or quiet
    // syllable must not close the clip before the command is complete.
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
