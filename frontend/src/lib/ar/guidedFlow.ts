/**
 * Guided HoloLens assembly flow (pure, testable).
 *
 * One short visible instruction ("Lege den roten 2×4-Stein auf die grüne
 * Markierung."), one clear state and at most two large contextual buttons.
 * The state is derived ONLY from real data: server progress, the latest
 * inspection summary for this step, a running check, and an explicit
 * user confirmation. Nothing here marks a step verified.
 *
 * "Position bestätigen" is a visible manual fallback when the automatic
 * check is uncertain or unavailable. It is recorded as USER-confirmed, never
 * as AI/backend verification, and is never triggered by voice.
 */

export type GuideState =
  | "placing"
  | "ready"
  | "checking"
  | "almost"
  | "correct"
  | "retry"
  | "partial"
  | "error"
  | "confirmed"
  | "complete";

export type GuideAction = "verify" | "next" | "confirm";
export type GuideTone = "ready" | "info" | "ok" | "warn" | "bad";

export interface GuideButton {
  id: GuideAction;
  label: string;
}

export interface GuideView {
  state: GuideState;
  /** Short state label for the status pill. */
  label: string;
  /** One short sentence: what happened / what to do now. */
  message: string;
  tone: GuideTone;
  /** Colour of the tabletop target marker (hex). */
  marker: number;
  /** Ghost-model tint, or null to keep the neutral transparent ghost. */
  ghostTint: number | null;
  buttons: GuideButton[];
}

export interface GuideInput {
  /** null when not in immersive AR (2D page). */
  anchored: boolean | null;
  checking: boolean;
  serverVerified: boolean;
  manuallyConfirmed: boolean;
  isLastStep: boolean;
  /** The last check could not even run (e.g. camera unavailable); shown instead of an older result. */
  checkError?: string | null;
  /** Latest inspection summary for THIS step (null when none). */
  summary: {
    kind: "inspection" | "verification" | "error" | "inspecting";
    overall: { kind: string } | null;
  } | null;
}

export const MARKER = {
  target: 0x2ee66b,
  correct: 0x2ee66b,
  wrong: 0xff3b3b,
  partial: 0xffd23f,
} as const;

const NEXT: GuideButton = { id: "next", label: "Nächster Schritt ▶" };
const CHECK: GuideButton = { id: "verify", label: "Prüfen" };
const RECHECK: GuideButton = { id: "verify", label: "Erneut prüfen" };
const CONFIRM: GuideButton = { id: "confirm", label: "Position bestätigen" };

export function deriveGuide(input: GuideInput): GuideView {
  const done = (state: GuideState, label: string, message: string): GuideView => ({
    state, label, message, tone: "ok", marker: MARKER.correct, ghostTint: MARKER.correct,
    buttons: input.isLastStep ? [] : [NEXT],
  });
  if (input.serverVerified)
    return input.isLastStep
      ? done("complete", "Fertig", "Alle Schritte korrekt — Montage abgeschlossen.")
      : done("correct", "Korrekt", "Schritt korrekt.");
  if (input.manuallyConfirmed)
    return input.isLastStep
      ? { ...done("complete", "Bestätigt", "Position von dir bestätigt (nicht KI-geprüft). Letzter Schritt."), tone: "warn" }
      : { ...done("confirmed", "Bestätigt", "Position von dir bestätigt (nicht KI-geprüft)."), tone: "warn" };
  if (input.anchored === false)
    return {
      state: "placing", label: "Feld setzen", tone: "info", marker: MARKER.target, ghostTint: null,
      message: "Schau auf den Tisch und tippe oben aufs Panel, um das Feld zu setzen.", buttons: [],
    };
  if (input.checking || input.summary?.kind === "inspecting")
    return { state: "checking", label: "Prüfe …", message: "Bitte nicht bewegen — Bild wird geprüft.", tone: "info", marker: MARKER.target, ghostTint: null, buttons: [] };
  if (input.checkError)
    return { state: "error", label: "Prüfung nicht möglich", message: input.checkError, tone: "warn", marker: MARKER.partial, ghostTint: null, buttons: [RECHECK, CONFIRM] };
  const s = input.summary;
  if (!s) return { state: "ready", label: "Bereit", message: "Baustein ablegen, dann „Prüfen“.", tone: "ready", marker: MARKER.target, ghostTint: null, buttons: [CHECK] };
  if (s.kind === "error")
    return { state: "error", label: "Prüfung nicht möglich", message: "Kamera oder Verbindung prüfen — oder Position selbst bestätigen.", tone: "warn", marker: MARKER.partial, ghostTint: null, buttons: [RECHECK, CONFIRM] };
  switch (s.overall?.kind) {
    case "verified":
      return input.isLastStep ? done("complete", "Fertig", "Montage abgeschlossen.") : done("correct", "Korrekt", "Schritt korrekt.");
    case "correct":
      // An inspection said correct; the separate fresh verification is still missing.
      return { state: "almost", label: "Fast korrekt", message: "Sieht korrekt aus — „Erneut prüfen“ für das Bestätigungsbild.", tone: "ok", marker: MARKER.correct, ghostTint: null, buttons: [RECHECK] };
    case "incorrect":
      return { state: "retry", label: "Noch einmal versuchen", message: "Baustein ausrichten.", tone: "bad", marker: MARKER.wrong, ghostTint: MARKER.wrong, buttons: [RECHECK] };
    case "uncertain":
      return { state: "partial", label: "Teilweise korrekt", message: "Position unklar — Baustein ausrichten oder Position bestätigen.", tone: "warn", marker: MARKER.partial, ghostTint: MARKER.partial, buttons: [RECHECK, CONFIRM] };
    default:
      return { state: "error", label: "Prüfung nicht möglich", message: "Kein gültiges Ergebnis — erneut prüfen oder Position bestätigen.", tone: "warn", marker: MARKER.partial, ghostTint: null, buttons: [RECHECK, CONFIRM] };
  }
}

const COLOR_DE: Record<string, string> = {
  red: "roten", rot: "roten", blue: "blauen", blau: "blauen", yellow: "gelben", gelb: "gelben",
  green: "grünen", "grün": "grünen", gruen: "grünen", white: "weißen", "weiß": "weißen", weiss: "weißen",
  black: "schwarzen", schwarz: "schwarzen", gray: "grauen", grey: "grauen", grau: "grauen",
  orange: "orangen", brown: "braunen", braun: "braunen", pink: "pinken", purple: "lila",
};

/**
 * Short, visible instruction from structured step data (never from camera
 * text recognition). Example: "Lege den roten 2×4-Stein auf die grüne Markierung."
 */
export function shortInstruction(
  blocks: { color: string; name: string; quantity: number }[],
  hasMarker: boolean,
): string {
  const where = hasMarker ? "auf die grüne Markierung" : "in das Montagefeld";
  const first = blocks[0];
  if (!first) return "Keine Bausteine in diesem Schritt — weiter zum nächsten Schritt.";
  const adjective = COLOR_DE[first.color.trim().toLowerCase()] ?? "";
  const size = first.name.match(/(\d+)\s*[x×]\s*(\d+)/i);
  const noun = size ? `${size[1]}×${size[2]}-Stein` : `Baustein „${first.name.trim().slice(0, 24)}“`;
  const subject = first.quantity > 1
    ? `${first.quantity} ${adjective ? adjective.replace(/en$/, "e") + " " : ""}${size ? `${size[1]}×${size[2]}-Steine` : `× ${noun}`}`
    : `den ${adjective ? adjective + " " : ""}${noun}`;
  const more = blocks.length > 1 ? " (und die weiteren Bausteine)" : "";
  return `Lege ${subject}${more} ${where}.`;
}
