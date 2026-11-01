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
  const apiName = env.SpeechRecognition
    ? "SpeechRecognition"
    : env.webkitSpeechRecognition
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
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
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

const FATAL_ERRORS = new Set([
  "not-allowed",
  "service-not-allowed",
  "audio-capture",
  "language-not-supported",
]);

/**
 * Thin controller over the browser recognition object. Never restarts in an
 * uncontrolled loop: at most `maxRestarts` automatic restarts, never after a
 * fatal/permission error, and never after stop()/dispose().
 */
export class VoiceController {
  private recognition: RecognitionLike | null = null;
  private listening = false;
  private disposed = false;
  private restarts = 0;
  readonly gate = new CommandGate();
  constructor(
    private create: () => RecognitionLike | null,
    private handlers: {
      onCommand: (cmd: MatchedCommand) => void;
      onStatus?: (s: string) => void;
      onError?: (s: string) => void;
      onListeningChange?: (listening: boolean) => void;
    },
    private options: { lang?: string; maxRestarts?: number } = {},
  ) {}
  get isListening() {
    return this.listening;
  }
  start(): boolean {
    if (this.disposed || this.listening) return this.listening;
    const rec = this.create();
    if (!rec) {
      this.handlers.onError?.("Speech recognition is not available in this browser.");
      return false;
    }
    this.recognition = rec;
    this.restarts = 0;
    rec.lang = this.options.lang ?? "en-US";
    rec.continuous = true;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result?.isFinal) continue; // finalized results only
        const transcript = result[0]?.transcript ?? "";
        const matched = matchCommand(transcript);
        if (!matched) continue;
        if (!this.gate.tryAccept(matched.action)) continue;
        this.handlers.onCommand(matched);
      }
    };
    rec.onerror = (event) => {
      const error = event.error ?? "unknown";
      this.handlers.onError?.(`Speech recognition error: ${error}`);
      if (FATAL_ERRORS.has(error)) {
        this.restarts = Number.POSITIVE_INFINITY; // never auto-restart
        this.setListening(false);
      }
    };
    rec.onend = () => {
      this.setListening(false);
      const max = this.options.maxRestarts ?? 3;
      if (!this.disposed && this.shouldListen && this.restarts < max) {
        this.restarts++;
        try {
          rec.start();
          this.setListening(true);
        } catch {
          /* bounded: give up silently, status already reported */
        }
      }
    };
    this.shouldListen = true;
    try {
      rec.start();
      this.setListening(true);
      return true;
    } catch {
      this.handlers.onError?.("Speech recognition could not be started.");
      return false;
    }
  }
  private shouldListen = false;
  private setListening(value: boolean) {
    if (this.listening === value) return;
    this.listening = value;
    this.handlers.onListeningChange?.(value);
  }
  stop() {
    this.shouldListen = false;
    this.gate.reset();
    try {
      this.recognition?.stop();
    } catch {
      /* already stopped */
    }
    this.setListening(false);
  }
  dispose() {
    this.disposed = true;
    this.stop();
    if (this.recognition) {
      this.recognition.onresult = null;
      this.recognition.onerror = null;
      this.recognition.onend = null;
      try {
        this.recognition.abort();
      } catch {
        /* ignore */
      }
      this.recognition = null;
    }
  }
}
