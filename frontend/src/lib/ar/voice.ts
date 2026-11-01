/**
 * Deterministic, allowlisted voice commands for hands-free AR operation.
 * No LLM interpretation. Only finalized, exact (after normalization)
 * allowlisted phrases produce an action; anything else is rejected.
 */
export type VoiceAction =
  | "next"
  | "previous"
  | "verify"
  | "show-reference"
  | "hide-reference"
  | "show-instructions"
  | "read-instructions"
  | "re-anchor"
  | "recenter"
  | "help"
  | "stop-listening"
  | "exit";

export interface MatchedCommand {
  action: VoiceAction;
  phrase: string;
  language: "en" | "de";
}

const PHRASES: Record<string, { action: VoiceAction; language: "en" | "de" }> = {};
function add(action: VoiceAction, language: "en" | "de", phrases: string[]) {
  for (const p of phrases) PHRASES[p] = { action, language };
}
add("next", "en", ["next step", "go to next step", "go to the next step"]);
add("previous", "en", [
  "previous step",
  "go to previous step",
  "go to the previous step",
  "prev step",
]);
add("verify", "en", ["verify step", "verify this step", "verify the step"]);
add("show-reference", "en", [
  "show reference",
  "show reference photo",
  "show reference photograph",
  "display reference",
  "show the reference",
]);
add("hide-reference", "en", [
  "hide reference",
  "hide reference photo",
  "hide reference photograph",
  "hide the reference",
]);
add("show-instructions", "en", [
  "show instructions",
  "show instruction",
  "expand instructions",
  "show the instructions",
]);
add("read-instructions", "en", [
  "read instructions",
  "read instruction",
  "read instructions aloud",
  "read the instructions",
  "read the instruction aloud",
]);
add("re-anchor", "en", [
  "reanchor",
  "re anchor",
  "reset alignment",
  "reset tabletop alignment",
]);
add("recenter", "en", [
  "recenter",
  "recenter panel",
  "re centre",
  "re centre panel",
  "center panel",
  "centre panel",
]);
add("help", "en", ["help", "show commands", "show help", "list commands"]);
add("stop-listening", "en", [
  "stop listening",
  "stop voice",
  "disable voice",
  "turn off microphone",
  "stop microphone",
]);
add("exit", "en", ["exit ar", "leave ar", "close ar", "quit ar", "exit"]);
// German aliases (after umlaut folding these are the normalized forms).
add("next", "de", ["naechster schritt", "nachster schritt"]);
add("previous", "de", ["vorheriger schritt"]);
add("verify", "de", ["schritt pruefen", "schritt prufen"]);
add("show-reference", "de", ["referenz anzeigen", "referenz zeigen"]);
add("read-instructions", "de", ["anleitung vorlesen", "anleitung lesen"]);
add("exit", "de", ["ar beenden", "beenden"]);

/** Normalize a transcript for exact allowlist matching. */
export function normalizeTranscript(raw: string): string {
  let s = (raw ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[.,!?;:()"“”„'’`]/g, " ")
    .replace(/[-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Optional wake prefix: "AssemblyPilot" / "Assembly Pilot".
  s = s.replace(/^(hey |ok )?assembly ?pilot[ ,:]? /, "").trim();
  if (s === "assemblypilot" || s === "assembly pilot") s = "";
  // Fold German umlauts so both spoken/typed variants match.
  s = s
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
  return s.replace(/\s+/g, " ").trim();
}

const NEGATIONS = ["do not", "dont", "don't", "never", "not ", "no "];
const ACTION_KEYWORDS: Record<string, VoiceAction> = {
  next: "next",
  previous: "previous",
  prev: "previous",
  verify: "verify",
  recenter: "recenter",
  reanchor: "re-anchor",
};

/**
 * Match a finalized transcript. Returns null for empty, negated, ambiguous
 * (mentions two different actions / joined commands) or unlisted speech.
 */
export function matchCommand(raw: string): MatchedCommand | null {
  const normalized = normalizeTranscript(raw);
  if (!normalized) return null;
  if (NEGATIONS.some((n) => normalized.startsWith(n) || normalized.includes(` ${n}`)))
    return null;
  if (normalized.includes(" and ")) return null;
  // Ambiguity: keywords pointing at two distinct actions => reject.
  const mentioned = new Set<VoiceAction>();
  for (const token of normalized.split(" ")) {
    const a = ACTION_KEYWORDS[token];
    if (a) mentioned.add(a);
  }
  if (normalized.includes("exit") && normalized.includes("step")) return null;
  if (mentioned.size > 1) return null;
  const hit = PHRASES[normalized];
  if (!hit) return null;
  return { action: hit.action, phrase: normalized, language: hit.language };
}

export const VOICE_COMMANDS: { spoken: string; action: VoiceAction; description: string }[] = [
  { spoken: "Next step", action: "next", description: "Show next assembly step" },
  { spoken: "Previous step", action: "previous", description: "Show previous step" },
  { spoken: "Verify step", action: "verify", description: "Open camera verification (fresh photo required)" },
  { spoken: "Show reference", action: "show-reference", description: "Display expected reference photograph" },
  { spoken: "Hide reference", action: "hide-reference", description: "Hide reference photograph" },
  { spoken: "Show instructions", action: "show-instructions", description: "Expand assembly description" },
  { spoken: "Read instructions", action: "read-instructions", description: "Read instruction aloud (if enabled)" },
  { spoken: "Re-anchor", action: "re-anchor", description: "Reset tabletop alignment" },
  { spoken: "Recenter", action: "recenter", description: "Recenter instruction panel" },
  { spoken: "Help / Show commands", action: "help", description: "Display available commands" },
  { spoken: "Stop listening", action: "stop-listening", description: "Disable microphone recognition" },
  { spoken: "Exit AR", action: "exit", description: "Close immersive XR session" },
];

export const GERMAN_ALIASES: { spoken: string; action: VoiceAction }[] = [
  { spoken: "Nächster Schritt", action: "next" },
  { spoken: "Vorheriger Schritt", action: "previous" },
  { spoken: "Schritt prüfen", action: "verify" },
  { spoken: "Referenz anzeigen", action: "show-reference" },
  { spoken: "Anleitung vorlesen", action: "read-instructions" },
  { spoken: "AR beenden", action: "exit" },
];

/** Suppress duplicate finalized results and block repeats while pending. */
export class CommandGate {
  private lastAction: VoiceAction | null = null;
  private lastAt = 0;
  private pending = false;
  constructor(private cooldownMs = 1500) {}
  setPending(value: boolean) {
    this.pending = value;
  }
  get isPending() {
    return this.pending;
  }
  tryAccept(action: VoiceAction, now: number = Date.now()): boolean {
    if (this.pending) return false;
    if (this.lastAction === action && now - this.lastAt < this.cooldownMs)
      return false;
    this.lastAction = action;
    this.lastAt = now;
    return true;
  }
  reset() {
    this.lastAction = null;
    this.lastAt = 0;
    this.pending = false;
  }
}

export interface SpeechSupport {
  supported: boolean;
  apiName: "SpeechRecognition" | "webkitSpeechRecognition" | null;
  secureContext: boolean;
  mayUseCloudService: boolean;
  reason: string;
}

interface SpeechEnv {
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
  isSecureContext?: boolean;
}

/** Capability detection. Desktop support does NOT prove HoloLens support. */
export function detectSpeechSupport(
  env: SpeechEnv = globalThis as SpeechEnv,
): SpeechSupport {
  const secure = env.isSecureContext !== false;
  const apiName = typeof env.SpeechRecognition === "function"
    ? "SpeechRecognition"
    : typeof env.webkitSpeechRecognition === "function"
      ? "webkitSpeechRecognition"
      : null;
  if (!secure)
    return {
      supported: false,
      apiName,
      secureContext: false,
      mayUseCloudService: false,
      reason: "Speech recognition requires a secure (HTTPS) context.",
    };
  if (!apiName)
    return {
      supported: false,
      apiName: null,
      secureContext: true,
      mayUseCloudService: false,
      reason:
        "This browser exposes no SpeechRecognition API. Voice control is unavailable here; manual controls remain available. Support on HoloLens Edge must be confirmed on the device.",
    };
  return {
    supported: true,
    apiName,
    secureContext: true,
    // webkit-prefixed and most desktop/Edge implementations may send audio to
    // a browser-provider cloud service; this cannot be reliably detected.
    mayUseCloudService: true,
    reason:
      "Browser speech recognition detected. It may transmit audio to your browser provider's speech service (not to AssemblyPilot). HoloLens Edge behaviour must be confirmed on the device.",
  };
}

export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string; message?: string }) => void) | null;
  onend: (() => void) | null;
}
export interface RecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string; confidence?: number };
    length: number;
  }>;
}

export type VoiceState = "off" | "starting" | "listening" | "stopping" | "unsupported" | "error";
export interface VoiceSnapshot {
  state: VoiceState;
  message: string;
  errorCode?: string;
}

const ERROR_HELP: Record<string, string> = {
  "not-allowed": "Speech input was denied by the browser, OS privacy settings or policy. Website microphone permission alone may not be sufficient.",
  "service-not-allowed": "The browser exposes speech recognition but disallows or cannot use its recognition service. Microphone permission cannot establish service availability.",
  "audio-capture": "Speech recognition could not capture microphone audio. Run the separate microphone test and close other microphone users.",
  network: "The browser's speech service could not be reached. Microphone access may still work; check connectivity and service policy.",
  "language-not-supported": "The browser's speech service does not support the selected language. Choose another language and explicitly retry.",
  "no-speech": "No speech was detected. Explicitly enable voice again when ready.",
  aborted: "The browser aborted speech recognition unexpectedly. No automatic retry will occur.",
};

/** Requests access only when called by the explicit test button. Never records/uploads. */
export async function probeMicrophone(
  getUserMedia: ((constraints: MediaStreamConstraints) => Promise<MediaStream>) | undefined,
): Promise<{ ok: boolean; message: string }> {
  if (!getUserMedia) return { ok: false, message: "Unsupported: this browser exposes no microphone getUserMedia API in this context." };
  let stream: MediaStream | undefined;
  try {
    stream = await getUserMedia({ audio: true });
    if (!stream.getAudioTracks().some((track) => track.readyState === "live")) {
      return { ok: false, message: "Microphone test failed: no live audio track was provided." };
    }
    return { ok: true, message: "Microphone access passed; all test tracks stopped. This does not prove speech recognition service availability." };
  } catch (error) {
    const name = error instanceof Error ? error.name : "UnknownError";
    return { ok: false, message: `Microphone test failed (${name}). Check OS/browser permission and microphone availability; this is separate from speech recognition.` };
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
  }
}

/**
 * Event-driven recognition. Constructor presence and start() returning are not
 * proof of a working service. Every retry requires an explicit user action.
 */
export class VoiceController {
  private recognition: RecognitionLike | null = null;
  private snapshot: VoiceSnapshot = { state: "off", message: "Voice is off." };
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  readonly gate = new CommandGate();
  constructor(
    private create: () => RecognitionLike | null,
    private handlers: {
      onCommand: (cmd: MatchedCommand) => void;
      onStatus?: (s: string) => void;
      onError?: (s: string) => void;
      onListeningChange?: (listening: boolean) => void;
      onStateChange?: (snapshot: VoiceSnapshot) => void;
    },
    private options: { lang?: string; startupTimeoutMs?: number; stopTimeoutMs?: number } = {},
  ) {}
  get isListening() {
    return this.snapshot.state === "listening";
  }
  get status(): Readonly<VoiceSnapshot> { return this.snapshot; }

  private update(snapshot: VoiceSnapshot) {
    const wasListening = this.isListening;
    this.snapshot = snapshot;
    this.handlers.onStateChange?.(snapshot);
    this.handlers.onStatus?.(snapshot.message);
    if (wasListening !== this.isListening) this.handlers.onListeningChange?.(this.isListening);
  }
  private clearTimer() { clearTimeout(this.timer); this.timer = undefined; }
  private release(abort = false) {
    this.clearTimer();
    const rec = this.recognition;
    this.recognition = null;
    if (!rec) return;
    rec.onstart = null;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    if (abort) {
      try { rec.abort(); } catch { /* Already ended; callbacks are detached. */ }
    }
  }
  private fail(code: string, message: string) {
    this.release(true);
    this.update({ state: "error", errorCode: code, message });
    this.handlers.onError?.(message);
  }
  start(): boolean {
    if (this.disposed) return false;
    if (["starting", "listening", "stopping"].includes(this.snapshot.state)) return false;
    this.release(true);
    this.gate.reset();
    this.update({ state: "starting", message: "Waiting for the browser's speech recognition start event…" });
    let rec: RecognitionLike | null;
    try { rec = this.create(); } catch (error) {
      this.fail("constructor-failed", `Speech recognition constructor failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
      return false;
    }
    if (!rec) {
      this.update({ state: "unsupported", message: "Speech recognition is not available in this browser." });
      return false;
    }
    this.recognition = rec;
    try {
      rec.lang = this.options.lang ?? "en-US";
      rec.continuous = true;
      rec.interimResults = false;
      rec.maxAlternatives = 1;
    } catch (error) {
      this.fail("configuration-failed", `Speech recognition configuration failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
      return false;
    }
    const finalized = new Set<number>();
    rec.onstart = () => {
      if (this.disposed || this.recognition !== rec || this.snapshot.state !== "starting") return;
      this.clearTimer();
      this.update({ state: "listening", message: `Recognition service started (${rec.lang}). Say “Help” for commands.` });
    };
    rec.onresult = (event) => {
      if (this.disposed || this.recognition !== rec || !this.isListening) return;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result?.isFinal || finalized.has(i)) continue;
        finalized.add(i); // A browser may replay the same finalized result event.
        const transcript = result[0]?.transcript ?? "";
        const matched = matchCommand(transcript);
        if (!matched) continue;
        if (!this.gate.tryAccept(matched.action)) continue;
        this.handlers.onCommand(matched);
        if (!this.isListening || this.disposed || this.recognition !== rec) break;
      }
    };
    rec.onerror = (event) => {
      if (this.disposed || this.recognition !== rec) return;
      const error = event.error ?? "unknown";
      if (this.snapshot.state === "stopping" && error === "aborted") return;
      this.fail(error, `Speech recognition error (${error}): ${ERROR_HELP[error] ?? "The browser reported a recognition failure. Use manual controls or explicitly retry."}${event.message ? ` Browser detail: ${event.message}` : ""}`);
    };
    rec.onend = () => {
      if (this.disposed || this.recognition !== rec) return;
      if (this.snapshot.state === "stopping") {
        this.release();
        this.update({ state: "off", message: "Voice stopped." });
      } else {
        const beforeStart = this.snapshot.state === "starting";
        this.fail(beforeStart ? "ended-before-start" : "unexpected-end", beforeStart
          ? "Recognition ended before it confirmed startup. The API exists, but its service did not start. The browser supplied no more specific error. Run the microphone test; manual controls remain available."
          : "The recognition session ended unexpectedly. No automatic restart will occur; explicitly enable voice again.");
      }
    };
    this.timer = setTimeout(() => {
      if (this.recognition === rec && this.snapshot.state === "starting")
        this.fail("startup-timeout", "No recognition start event arrived within the startup deadline. The API exists, but service startup is unconfirmed. Check the browser permission prompt and run the microphone test.");
    }, this.options.startupTimeoutMs ?? 10000);
    try {
      rec.start();
      return this.snapshot.state === "starting" || this.isListening;
    } catch (error) {
      // A synchronous error event may already have provided a better diagnostic.
      if (this.snapshot.state !== "error") {
        const name = error instanceof Error ? error.name : "start-failed";
        this.fail(name, `Speech recognition start failed (${name}): ${error instanceof Error ? error.message : String(error)}`);
      }
      return false;
    }
  }
  stop() {
    if (this.disposed || !["starting", "listening"].includes(this.snapshot.state)) return;
    this.clearTimer();
    this.gate.reset();
    this.update({ state: "stopping", message: "Stopping speech recognition…" });
    this.timer = setTimeout(() => {
      this.release(true);
      this.update({ state: "off", message: "Voice stopped; the browser did not send an end event, so recognition was aborted." });
    }, this.options.stopTimeoutMs ?? 3000);
    try {
      this.recognition?.stop();
    } catch (error) {
      this.fail("stop-failed", `Speech recognition stop failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.release(true);
    this.gate.reset();
    if (this.snapshot.state !== "error" && this.snapshot.state !== "unsupported")
      this.update({ state: "off", message: "Voice stopped and recognition released." });
  }
}
