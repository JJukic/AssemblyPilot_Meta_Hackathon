/**
 * Floating panel manipulation regions + state machine (pure).
 *
 * Panel pixel space is PANEL_W x PANEL_H (1024x640). The title bar is
 * the drag handle; the lower-right corner is the resize handle. Both
 * take precedence over buttons/origin-confirm in their regions, so a
 * pinch there can never activate a command.
 */

export type PanelRegion = "drag" | "resize" | "panel" | null;

export const DRAG_BAR_H = 56;
export const RESIZE_W = 64;
export const RESIZE_H = 64;

export function panelRegionAt(x: number, y: number, width: number, height: number): PanelRegion {
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  if (x >= width - RESIZE_W && y >= height - RESIZE_H) return "resize";
  if (y < DRAG_BAR_H) return "drag";
  return "panel";
}

export type ManipulationState =
  | "idle"
  | "hovering_button"
  | "hovering_drag_handle"
  | "hovering_resize_handle"
  | "dragging"
  | "resizing";

export const PANEL_SCALE_MIN = 0.65;
export const PANEL_SCALE_MAX = 1.4;
export const PANEL_SCALE_DEFAULT = 0.85;

export function clampPanelScale(scale: number): number {
  return Math.min(PANEL_SCALE_MAX, Math.max(PANEL_SCALE_MIN, scale));
}

/**
 * Pinch lifecycle. A grab only becomes a manipulation after the hand
 * moves past the threshold; a still pinch remains a click. Release or
 * tracking loss ends the manipulation at the last applied transform —
 * the panel never teleports.
 */
export class ManipulationMachine {
  state: ManipulationState = "idle";
  moved = false;
  private grabPoint: [number, number, number] | null = null;
  constructor(private thresholdM = 0.012) {}

  hover(region: PanelRegion, onButton: boolean) {
    if (this.state === "dragging" || this.state === "resizing") return;
    this.state =
      region === "drag"
        ? "hovering_drag_handle"
        : region === "resize"
          ? "hovering_resize_handle"
          : onButton
            ? "hovering_button"
            : "idle";
  }

  /** Returns true when this pinch grabs a manipulation handle. */
  grab(region: PanelRegion, point: [number, number, number]): boolean {
    if (region !== "drag" && region !== "resize") return false;
    this.state = region === "drag" ? "dragging" : "resizing";
    this.moved = false;
    this.grabPoint = point;
    return true;
  }

  move(point: [number, number, number]): boolean {
    if (!this.grabPoint) return this.moved;
    const dx = point[0] - this.grabPoint[0];
    const dy = point[1] - this.grabPoint[1];
    const dz = point[2] - this.grabPoint[2];
    if (Math.sqrt(dx * dx + dy * dy + dz * dz) > this.thresholdM) this.moved = true;
    return this.moved;
  }

  /** True when the following click must be suppressed (it was a drag). */
  release(): boolean {
    const suppress = (this.state === "dragging" || this.state === "resizing") && this.moved;
    this.state = "idle";
    this.moved = false;
    this.grabPoint = null;
    return suppress;
  }

  cancel() {
    this.state = "idle";
    this.moved = false;
    this.grabPoint = null;
  }

  get active() {
    return this.state === "dragging" || this.state === "resizing";
  }
}
