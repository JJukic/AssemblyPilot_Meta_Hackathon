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

/**
 * Anchor lifecycle. The runtime feeds it poses; it never invents a pose.
 * A transient pose dropout holds the last confirmed pose (degraded);
 * only a sustained dropout is tracking_lost, and recovery returns to the
 * SAME anchor — re-anchoring always needs an explicit user action.
 */
export class AnchorTracker {
  state: AnchorState = "unplaced";
  lastGoodPose: number[] | null = null;
  frozenFallback = false;
  private nullFrames = 0;
  constructor(private holdFrames = ANCHOR_HOLD_FRAMES) {}

  get isAnchored() {
    return this.state === "anchored" || this.state === "tracking_degraded";
  }

  preview(candidateValid: boolean) {
    if (this.state === "unplaced" || this.state === "reanchoring")
      this.state = candidateValid ? "awaiting_confirmation" : "preview";
    else if (this.state === "preview" && candidateValid)
      this.state = "awaiting_confirmation";
  }

  confirm(pose: ArrayLike<number>, frozenFallback = false) {
    this.lastGoodPose = Array.from(pose);
    this.frozenFallback = frozenFallback;
    this.nullFrames = 0;
    this.state = "anchored";
  }

  /** Returns the pose to render this frame (held pose during dropout). */
  onPose(pose: ArrayLike<number> | null): { state: AnchorState; pose: number[] | null } {
    if (!this.lastGoodPose) return { state: this.state, pose: null };
    if (pose) {
      this.lastGoodPose = Array.from(pose);
      this.nullFrames = 0;
      if (this.state === "tracking_degraded" || this.state === "tracking_lost")
        this.state = "anchored";
      return { state: this.state, pose: this.lastGoodPose };
    }
    this.nullFrames++;
    if (this.nullFrames > this.holdFrames) this.state = "tracking_lost";
    else if (this.state === "anchored") this.state = "tracking_degraded";
    return { state: this.state, pose: this.lastGoodPose };
  }

  onReferenceReset() {
    // A reset invalidates pose trust: keep showing the held pose as LOST,
    // never silently adopt a new tabletop location.
    if (this.lastGoodPose) this.state = "tracking_lost";
  }

  beginReanchor() {
    this.state = "reanchoring";
    this.lastGoodPose = null;
    this.frozenFallback = false;
    this.nullFrames = 0;
  }

  release() {
    this.state = "unplaced";
    this.lastGoodPose = null;
    this.frozenFallback = false;
    this.nullFrames = 0;
  }
}
