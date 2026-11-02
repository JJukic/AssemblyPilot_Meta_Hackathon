/**
 * Inspection-capture preview state (pure, testable).
 *
 * Holds at most TWO records: the latest capture (camera view) and the
 * capture that produced the currently displayed result. A record is
 * created only from the exact snapshot handed to the inspection pipeline
 * (same data URL / JPEG bytes, same SHA-256), never from live video.
 * Phases advance only on real pipeline events; a superseded record id can
 * never be updated, so late async work cannot overwrite a newer capture.
 * Images stay in memory only (no storage, no extra uploads).
 */

export type CapturePhase =
  | "validating"
  | "rejected"
  | "uploading"
  | "complete"
  | "failed"
  | "stale";

export interface CaptureRecord {
  id: number;
  projectId: string;
  stepId: string;
  source: string;
  intent: "inspect" | "verify" | "none";
  capturedAt: string;
  width: number;
  height: number;
  /** The exact JPEG data URL that is (or would have been) uploaded. */
  dataUrl: string;
  /** SHA-256 of the uploaded JPEG bytes (same as the trace correlation id). */
  fingerprint: string | null;
  phase: CapturePhase;
  detail: string;
  /** True only once the HTTP request carrying this image was started. */
  sent: boolean;
  /** Short result headline bound to THIS capture (set when finished). */
  result: string | null;
}

export type CaptureInput = Omit<CaptureRecord, "id" | "phase" | "sent" | "result" | "fingerprint"> & {
  phase?: CapturePhase;
  fingerprint?: string | null;
};

export class CapturePreviewStore {
  private seq = 0;
  current: CaptureRecord | null = null;
  /** The capture whose outcome is the latest finished result. */
  lastResult: CaptureRecord | null = null;
  constructor(private onChange: () => void = () => {}) {}

  begin(input: CaptureInput): number {
    const id = ++this.seq;
    this.current = {
      ...input,
      id,
      phase: input.phase ?? "validating",
      fingerprint: input.fingerprint ?? null,
      sent: false,
      result: null,
    };
    this.onChange();
    return id;
  }

  isCurrent(id: number) {
    return this.current?.id === id;
  }
  /** Still displayed somewhere (camera view or result view). */
  wants(id: number) {
    return this.current?.id === id || this.lastResult?.id === id;
  }
  byId(id: number | null | undefined): CaptureRecord | null {
    if (id == null) return null;
    if (this.current?.id === id) return this.current;
    if (this.lastResult?.id === id) return this.lastResult;
    return null;
  }

  /** Update the CURRENT capture only; superseded ids are ignored. */
  update(id: number, patch: Partial<Pick<CaptureRecord, "phase" | "detail" | "fingerprint" | "sent">>): boolean {
    if (!this.current || this.current.id !== id || this.current.phase === "stale") return false;
    // A capture that was sent can never be relabelled "not sent".
    this.current = { ...this.current, ...patch, sent: this.current.sent || !!patch.sent };
    this.onChange();
    return true;
  }

  /** Bind the final outcome to this capture and keep it for the Result view. */
  finish(id: number, phase: "complete" | "failed" | "rejected", detail: string, result: string): boolean {
    if (!this.current || this.current.id !== id || this.current.phase === "stale") return false;
    this.current = { ...this.current, phase, detail, result };
    this.lastResult = this.current;
    this.onChange();
    return true;
  }

  /** The step changed or the request was superseded: nothing old stays "current". */
  invalidate() {
    if (!this.current && !this.lastResult) return;
    this.current = null;
    this.lastResult = null;
    this.onChange();
  }
}

export type IndicatorTone = "idle" | "info" | "ok" | "warn" | "error";

export interface CaptureView {
  id: number;
  time: string;
  title: string;
  status: string;
  tone: IndicatorTone;
  lines: string[];
  sent: boolean;
  isNew: boolean;
}

const PHASE_LABEL: Record<CapturePhase, { status: string; tone: IndicatorTone }> = {
  validating: { status: "FRAME CAPTURED · VALIDATING", tone: "info" },
  rejected: { status: "IMAGE REJECTED — NOT SENT TO META", tone: "error" },
  uploading: { status: "SENT TO BACKEND · INSPECTION RUNNING", tone: "info" },
  complete: { status: "INSPECTION COMPLETE", tone: "ok" },
  failed: { status: "INSPECTION FAILED", tone: "error" },
  stale: { status: "DISCARDED — STEP CHANGED", tone: "warn" },
};

export function shortTime(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toTimeString().slice(0, 8) : "?";
}

/** Concise, truthful panel text for one capture. */
export function captureView(r: CaptureRecord, now = Date.now()): CaptureView {
  const label = PHASE_LABEL[r.phase];
  const lines = [
    `Captured ${shortTime(r.capturedAt)} · ${r.width}×${r.height}`,
    `Source: ${r.source}`,
    r.fingerprint ? `Image SHA-256 ${r.fingerprint.slice(0, 12)}…` : "Image SHA-256: computing…",
    r.sent ? "Upload started: yes (this exact image)" : "Upload started: no — not sent",
  ];
  if (r.result) lines.push(`Result: ${r.result}`);
  if (r.detail) lines.push(r.detail);
  const age = now - Date.parse(r.capturedAt);
  return {
    id: r.id,
    time: shortTime(r.capturedAt),
    title: r.phase === "rejected"
      ? "REJECTED FRAME (not sent)"
      : r.intent === "verify" ? "VERIFICATION FRAME (exact upload)" : "INSPECTION FRAME (exact upload)",
    status: label.status,
    tone: label.tone,
    lines,
    sent: r.sent,
    isNew: Number.isFinite(age) && age >= 0 && age < 3000,
  };
}

/** Small always-visible pipeline indicator (real events only). */
export function indicatorFor(r: CaptureRecord | null, watching: boolean): { label: string; tone: IndicatorTone } {
  if (r && r.phase === "validating") return { label: "◉ CAPTURED", tone: "info" };
  if (r && r.phase === "uploading") return { label: "◉ INSPECTING", tone: "info" };
  if (r && r.phase === "failed") return { label: "✗ ERROR", tone: "error" };
  if (r && r.phase === "rejected") return { label: "✗ FRAME REJECTED", tone: "warn" };
  if (r && r.phase === "complete" && Date.now() - Date.parse(r.capturedAt) < 60_000)
    return { label: "✓ RESULT RECEIVED", tone: "ok" };
  if (watching) return { label: "○ WATCHING", tone: "idle" };
  return { label: "", tone: "idle" };
}
