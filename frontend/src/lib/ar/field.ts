/**
 * Anchored tabletop assembly field (pure, testable).
 *
 * Coordinate systems (all lengths in metres unless suffixed):
 *  - Field space: origin at the confirmed field centre on the tabletop,
 *    +X right, +Z toward the user, +Y up. The field is a width (X) by
 *    depth (Z) rectangle. LEGO placements (`Placement.position_m`,
 *    dimensions in mm) are expressed relative to this origin.
 *  - WebXR local space: the session reference space. Runtime composes
 *    origin.matrix = fieldPose (in XR local space) each frame ONLY from
 *    the confirmed anchor pose; step geometry stays field-relative.
 *  - Camera image space: pixel coordinates; monitoring uses a centre ROI.
 *    No camera-to-field homography is claimed without calibration.
 *
 * Once confirmed, the field pose changes only through an explicit
 * re-anchor or a live anchor pose update — never from React renders,
 * inspection results, voice, panel moves or step changes.
 */

export type AnchorState =
  | "unplaced"
  | "preview"
  | "awaiting_confirmation"
  | "anchored"
  | "tracking_degraded"
  | "tracking_lost"
  | "reanchoring";

export interface AssemblyFieldConfig {
  widthM: number;
  depthM: number;
}

export const DEFAULT_FIELD: AssemblyFieldConfig = { widthM: 0.48, depthM: 0.32 };

export function validFieldConfig(c: AssemblyFieldConfig): boolean {
  return (
    Number.isFinite(c.widthM) && c.widthM >= 0.1 && c.widthM <= 2 &&
    Number.isFinite(c.depthM) && c.depthM >= 0.1 && c.depthM <= 2
  );
}

/** Field corners in field space (Y=0 tabletop plane), clockwise from front-left. */
export function fieldCorners(c: AssemblyFieldConfig): [number, number, number][] {
  const x = c.widthM / 2, z = c.depthM / 2;
  return [
    [-x, 0, -z],
    [x, 0, -z],
    [x, 0, z],
    [-x, 0, z],
  ];
}

/** True when a placement centre (metres, field space) lies inside the field. */
export function placementInsideField(
  positionM: number[],
  c: AssemblyFieldConfig,
  marginM = 0,
): boolean {
  if (!Array.isArray(positionM) || positionM.length !== 3) return false;
  const [x, , z] = positionM;
  return (
    Math.abs(x) <= c.widthM / 2 - marginM &&
    Math.abs(z) <= c.depthM / 2 - marginM
  );
}

/** Element-wise pose equality (column-major 4x4, 16 elements). */
export function samePose(a: ArrayLike<number> | null, b: ArrayLike<number> | null): boolean {
  if (!a || !b || a.length !== 16 || b.length !== 16) return false;
  for (let i = 0; i < 16; i++) if (Math.abs(a[i] - b[i]) > 1e-9) return false;
  return true;
}

export const ANCHOR_HOLD_FRAMES = 45;

/** Finite, non-degenerate rigid-ish 4x4 (column-major). Guards NaN/zero-scale poses. */
export function validPose(m: ArrayLike<number> | null | undefined): boolean {
  if (!m || m.length !== 16) return false;
  for (let i = 0; i < 16; i++) if (!Number.isFinite(m[i])) return false;
  if (Math.abs(m[3]) > 1e-6 || Math.abs(m[7]) > 1e-6 || Math.abs(m[11]) > 1e-6 || Math.abs(m[15] - 1) > 1e-6)
    return false;
  const col = (c: number) => Math.hypot(m[c * 4], m[c * 4 + 1], m[c * 4 + 2]);
  return col(0) > 1e-3 && col(1) > 1e-3 && col(2) > 1e-3;
}

/**
 * Head-to-field relation from two XR poses in the SAME reference space.
 * `angleDeg` is between the head's forward (-Z) axis and the direction to
 * the field centre. This is a head-gaze relation only: HoloLens Edge
 * exposes no photo/video-camera intrinsics or extrinsics for getUserMedia
 * frames, so no camera-pixel projection is claimed from it.
 */
export function fieldViewGeometry(
  head: ArrayLike<number>,
  field: ArrayLike<number>,
): { distanceM: number; angleDeg: number } | null {
  if (!validPose(head) || !validPose(field)) return null;
  const dx = field[12] - head[12], dy = field[13] - head[13], dz = field[14] - head[14];
  const distanceM = Math.hypot(dx, dy, dz);
  if (distanceM < 1e-4) return { distanceM, angleDeg: 0 };
  const fx = -head[8], fy = -head[9], fz = -head[10];
  const fl = Math.hypot(fx, fy, fz) || 1;
  const cos = (fx * dx + fy * dy + fz * dz) / (fl * distanceM);
  return { distanceM, angleDeg: (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI };
}

/** Approximate "the wearer is looking at the field" gate (head cone + reach). */
export const FIELD_VIEW_MAX_ANGLE_DEG = 32;
export const FIELD_VIEW_MAX_DISTANCE_M = 1.6;
export function fieldInView(g: { distanceM: number; angleDeg: number } | null): boolean | null {
  if (!g) return null;
  return g.angleDeg <= FIELD_VIEW_MAX_ANGLE_DEG && g.distanceM <= FIELD_VIEW_MAX_DISTANCE_M;
}

/** Everything needed to tell a React state update apart from an actual render. */
export interface FieldDiagnostics {
  lifecycle: AnchorState;
  nativeAnchor: boolean;
  anchorConfirmed: boolean;
  fieldMeshExists: boolean;
  /** origin AND field group were visible in the most recent rendered XR frame. */
  fieldRendered: boolean;
  transformValid: boolean;
  xrSessionActive: boolean;
  visibilityState: string;
  viewerTracked: boolean;
  reanchorPending: boolean;
  stepContentAvailable: boolean;
  placementMode: "surface" | "gaze" | "none";
  distanceM: number | null;
  angleDeg: number | null;
  inView: boolean | null;
  framesRendered: number;
  lastEvent: string;
}

export const EMPTY_FIELD_DIAGNOSTICS: FieldDiagnostics = {
  lifecycle: "unplaced", nativeAnchor: false, anchorConfirmed: false, fieldMeshExists: false,
  fieldRendered: false, transformValid: false, xrSessionActive: false, visibilityState: "none",
  viewerTracked: false, reanchorPending: false, stepContentAvailable: false, placementMode: "none",
  distanceM: null, angleDeg: null, inView: null, framesRendered: 0, lastEvent: "none",
};

/** Truthful one-line field status for the AR panel and the 2D page. */
export function describeField(d: FieldDiagnostics): string {
  if (!d.xrSessionActive) return "AR FIELD: no immersive session";
  const render = d.fieldRendered ? "rendered" : "NOT rendered";
  const focus = d.visibilityState === "visible" ? "" : ` · XR ${d.visibilityState} (input paused, field kept)`;
  const view = d.inView === null ? "" : d.inView ? " · in view" : " · look at the field";
  switch (d.lifecycle) {
    case "unplaced":
    case "preview":
      return `AR FIELD NOT PLACED — look at your tabletop until the preview appears${focus}`;
    case "awaiting_confirmation":
    case "reanchoring":
      return `AR FIELD PREVIEW (${d.placementMode}) ${render} — tap the panel above the buttons to confirm${focus}`;
    case "anchored":
      return `AR FIELD ANCHORED${d.nativeAnchor ? "" : " (session-local)"} · ${render}${view}${focus}`;
    case "tracking_degraded":
      return `AR FIELD HELD at last pose (tracking degraded) · ${render}${focus}`;
    case "tracking_lost":
      return `TRACKING LOST — field shown at its last pose (red) and is not trustworthy; Re-anchor if it does not recover${focus}`;
  }
}

/**
 * Anchor lifecycle. The runtime feeds it poses; it never invents a pose.
 * A transient pose dropout holds the last confirmed pose (degraded);
 * only a sustained dropout is tracking_lost, and recovery returns to the
 * SAME anchor — re-anchoring always needs an explicit user action. Losing
 * tracking never deletes the anchor or the field.
 */
export class AnchorTracker {
  state: AnchorState = "unplaced";
  lastGoodPose: number[] | null = null;
  frozenFallback = false;
  lastEvent = "created";
  private nullFrames = 0;
  constructor(private holdFrames = ANCHOR_HOLD_FRAMES) {}

  get isAnchored() {
    return this.state === "anchored" || this.state === "tracking_degraded";
  }
  /** A confirmed placement exists (possibly not currently trustworthy). */
  get hasPlacement() {
    return this.lastGoodPose !== null && ["anchored", "tracking_degraded", "tracking_lost"].includes(this.state);
  }

  preview(candidateValid: boolean) {
    if (this.state === "unplaced" || this.state === "reanchoring" || this.state === "preview")
      this.state = candidateValid ? "awaiting_confirmation" : this.state === "reanchoring" ? "reanchoring" : "preview";
    else if (this.state === "awaiting_confirmation" && !candidateValid) this.state = "preview";
  }

  confirm(pose: ArrayLike<number>, frozenFallback = false) {
    this.lastGoodPose = Array.from(pose);
    this.frozenFallback = frozenFallback;
    this.nullFrames = 0;
    this.state = "anchored";
    this.lastEvent = frozenFallback ? "confirmed (session-local pose)" : "confirmed";
  }

  /** Returns the pose to render this frame (held pose during dropout). */
  onPose(pose: ArrayLike<number> | null): { state: AnchorState; pose: number[] | null } {
    if (!this.lastGoodPose) return { state: this.state, pose: null };
    if (pose && validPose(pose)) {
      this.lastGoodPose = Array.from(pose);
      this.nullFrames = 0;
      if (this.state === "tracking_degraded" || this.state === "tracking_lost") {
        this.state = "anchored";
        this.lastEvent = "anchor tracking recovered";
      }
      return { state: this.state, pose: this.lastGoodPose };
    }
    this.nullFrames++;
    if (this.nullFrames > this.holdFrames) {
      if (this.state !== "tracking_lost") this.lastEvent = "anchor pose lost (sustained)";
      this.state = "tracking_lost";
    } else if (this.state === "anchored") {
      this.state = "tracking_degraded";
      this.lastEvent = "anchor pose dropout (holding)";
    }
    return { state: this.state, pose: this.lastGoodPose };
  }

  /**
   * Reference-space reset. A native XRAnchor is re-queried in the new space
   * and can recover by itself (degraded); a session-local frozen pose is in
   * the old coordinates and is no longer trustworthy (lost). Neither path
   * silently adopts a new tabletop location.
   */
  onReferenceReset(nativeAnchor = false) {
    if (!this.lastGoodPose) return;
    this.state = nativeAnchor && !this.frozenFallback ? "tracking_degraded" : "tracking_lost";
    this.nullFrames = 0;
    this.lastEvent = "reference space reset";
  }

  beginReanchor() {
    this.state = "reanchoring";
    this.lastGoodPose = null;
    this.frozenFallback = false;
    this.nullFrames = 0;
    this.lastEvent = "re-anchor requested";
  }

  release() {
    this.state = "unplaced";
    this.lastGoodPose = null;
    this.frozenFallback = false;
    this.nullFrames = 0;
    this.lastEvent = "released";
  }
}
