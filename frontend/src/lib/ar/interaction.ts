/**
 * Hand-ray panel interaction helpers (pure, testable).
 *
 * One mapping is used for the visible cursor, hover and Air Tap
 * activation, so what the user sees is exactly what gets clicked:
 * XR ray -> panel UV -> panel pixels (PANEL_W x PANEL_H) -> button.
 */

export function uvToPanel(uv: { x: number; y: number }, width: number, height: number) {
  return { x: uv.x * width, y: (1 - uv.y) * height };
}

/** Endpoint of a visible ray: at the panel hit, or a bounded length. */
export function rayEndpoint(
  origin: [number, number, number],
  direction: [number, number, number],
  hitDistance: number | null,
  maxLength = 1.5,
): [number, number, number] {
  const d = hitDistance !== null && hitDistance > 0 ? Math.min(hitDistance, maxLength) : maxLength;
  return [
    origin[0] + direction[0] * d,
    origin[1] + direction[1] * d,
    origin[2] + direction[2] * d,
  ];
}

/** Lightweight select debounce: one gesture, one action, per input source. */
export class SelectDebouncer {
  private last = new Map<string, number>();
  constructor(private windowMs = 300) {}
  tryAccept(sourceKey: string, now: number): boolean {
    const previous = this.last.get(sourceKey);
    if (previous !== undefined && now - previous < this.windowMs) return false;
    this.last.set(sourceKey, now);
    return true;
  }
  reset() {
    this.last.clear();
  }
}

export interface InputSourceDiagnostic {
  handedness: string;
  targetRayMode: string;
  tracked: boolean;
}

export interface InteractionDiagnostics {
  sources: InputSourceDiagnostic[];
  hoveredButton: string | null;
  rayIntersectsPanel: boolean;
  lastSelect: string | null;
  lastAction: string | null;
  lastFailure: string | null;
  hasTrackedRay: boolean;
  manipulation: string;
}

export const EMPTY_DIAGNOSTICS: InteractionDiagnostics = {
  sources: [],
  hoveredButton: null,
  rayIntersectsPanel: false,
  lastSelect: null,
  lastAction: null,
  lastFailure: null,
  hasTrackedRay: false,
  manipulation: "idle",
};

/** Effective hover across hands: any source currently on a button wins. */
export function effectiveHover(
  perSource: Iterable<string | null>,
): string | null {
  for (const id of perSource) if (id) return id;
  return null;
}
