/**
 * Voice Verify handoff: the AR page records *why* the camera workspace is
 * being opened, so it can auto-capture one fresh HoloLens camera frame and
 * run the existing Meta inspect/verify pipeline. Short-lived, IDs only —
 * no photos or transcripts are stored.
 */
export interface VoiceVerifyIntent {
  mode: "inspect" | "verify";
  projectId: string;
  stepId: string;
  requestedAt: string;
}
const INTENT_KEY = "assemblypilot.voice-verify";
const LAST_INSPECTION_KEY = "assemblypilot.last-inspection";
const TTL_MS = 120_000;

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
export function saveVoiceVerifyIntent(intent: VoiceVerifyIntent) {
  try {
    storage()?.setItem(INTENT_KEY, JSON.stringify(intent));
  } catch {
    /* storage unavailable: manual camera flow remains */
  }
}
export function readVoiceVerifyIntent(
  projectId?: string,
  stepId?: string,
  now = Date.now(),
): VoiceVerifyIntent | null {
  try {
    const raw = storage()?.getItem(INTENT_KEY);
    if (!raw) return null;
    const intent = JSON.parse(raw) as VoiceVerifyIntent;
    if (
      !intent ||
      (intent.mode !== "inspect" && intent.mode !== "verify") ||
      typeof intent.projectId !== "string" ||
      typeof intent.stepId !== "string" ||
      !Number.isFinite(Date.parse(intent.requestedAt)) ||
      now - Date.parse(intent.requestedAt) > TTL_MS ||
      (projectId !== undefined && intent.projectId !== projectId) ||
      (stepId !== undefined && intent.stepId !== stepId)
    )
      return null;
    return intent;
  } catch {
    return null;
  }
}
export function clearVoiceVerifyIntent() {
  try {
    storage()?.removeItem(INTENT_KEY);
  } catch {
    /* ignore */
  }
}
export interface LastInspection {
  projectId: string;
  stepId: string;
  inspectionId: string;
}
export function saveLastInspection(value: LastInspection) {
  try {
    storage()?.setItem(LAST_INSPECTION_KEY, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}
export function readLastInspection(projectId: string, stepId: string): LastInspection | null {
  try {
    const raw = storage()?.getItem(LAST_INSPECTION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as LastInspection;
    return value.projectId === projectId && value.stepId === stepId && !!value.inspectionId
      ? value
      : null;
  } catch {
    return null;
  }
}
export function isFreshFrame(capturedAt: string, requestedAt: string): boolean {
  const captured = Date.parse(capturedAt);
  const requested = Date.parse(requestedAt);
  return Number.isFinite(captured) && Number.isFinite(requested) && captured >= requested;
}

/** A new assembly run: the previous inspection can never be the base of a verification. */
export function clearLastInspection() {
  try {
    storage()?.removeItem(LAST_INSPECTION_KEY);
  } catch {
    /* ignore */
  }
}
