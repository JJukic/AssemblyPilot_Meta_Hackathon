/**
 * In-AR voice control (pure, testable).
 *
 * The panel's Start/Stop Voice button is the only way to start recording in
 * AR, behind an explicit in-panel consent tap. The status line always shows the
 * real controller state — an error is shown as an error, never as a silent Off.
 */
import type { CommandDiagnostic } from "./voice";

export type VoiceToggle = "stop" | "busy" | "ask-consent" | "start";

export function voiceToggle(s: { listening: boolean; busy: boolean; consented: boolean; consentPending: boolean }): VoiceToggle {
  if (s.listening) return "stop";
  if (s.busy) return "busy";
  if (!s.consented && !s.consentPending) return "ask-consent";
  return "start";
}

export interface VoicePanelInput {
  listening: boolean;
  busy: boolean;
  consentPending: boolean;
  processing: boolean;
  error: string;
  diagnostic: CommandDiagnostic | null;
}

export interface VoicePanelView {
  line: string;
  tone: "idle" | "info" | "ok" | "warn" | "error";
  button: string;
}

export const VOICE_CONSENT_TEXT =
  "Voice sends short clips to Whisper on your Mac (local, not stored). Select Confirm Voice to start.";

export function voicePanel(v: VoicePanelInput): VoicePanelView {
  const d = v.diagnostic;
  const heard = d
    ? ` · Heard “${d.transcript}”${d.action
      ? ` → ${d.state === "completed" ? "Executed" : d.state === "failed" || d.state === "rejected" ? "Not executed" : "…"}${d.detail ? `: ${d.detail}` : d.reason ? `: ${d.reason}` : ""}`
      : " → not a command"}`
    : "";
  if (v.consentPending) return { line: VOICE_CONSENT_TEXT, tone: "warn", button: "Confirm Voice" };
  if (v.listening) return { line: `Voice: ${v.processing ? "Processing" : "Listening"}${heard}`, tone: "ok", button: "Stop Voice" };
  if (v.busy) return { line: "Voice: Starting…", tone: "info", button: "Starting…" };
  if (v.error) return { line: `Voice error: ${v.error}`, tone: "error", button: "Start Voice" };
  return { line: "Voice: Off", tone: "idle", button: "Start Voice" };
}
