/**
 * Shared AR step cursor (one per project, revisioned on the backend).
 *
 * A move is always bound to an ABSOLUTE origin and target step — never to a
 * relative offset that could be re-applied after a revision conflict. With
 * two devices (e.g. two HoloLenses, or HoloLens + MacBook) both verifying
 * step 1 and both advancing, the slower one gets HTTP 409; it reloads the
 * cursor and then:
 *   - cursor already at the target  → only synchronise (no second move)
 *   - cursor still at the origin    → retry the SAME target once
 *   - cursor anywhere else          → synchronise, do not move (never skip)
 */
import type { ViewedStep } from "./data";

export type CursorMove =
  /** This call moved the cursor from `from` to `to`. */
  | { kind: "moved"; view: ViewedStep; retried: boolean }
  /** Another writer already moved the cursor to `to`; we only adopted it. */
  | { kind: "synced"; view: ViewedStep }
  /** The cursor is at a different step than both origin and target: nothing was changed. */
  | { kind: "diverged"; view: ViewedStep };

export interface CursorApi {
  setView(stepId: string, revision: number): Promise<ViewedStep>;
  getView(): Promise<ViewedStep>;
}

export const isRevisionConflict = (cause: unknown): boolean =>
  (typeof cause === "object" && cause !== null && "status" in cause && Number((cause as { status: unknown }).status) === 409) ||
  (cause instanceof Error && /409|changed the viewed step/i.test(cause.message));

export async function moveCursor(
  api: CursorApi,
  move: { from: string; to: string; revision: number },
): Promise<CursorMove> {
  let revision = move.revision;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const view = await api.setView(move.to, revision);
      return { kind: "moved", view, retried: attempt > 0 };
    } catch (cause) {
      if (!isRevisionConflict(cause)) throw cause;
      const fresh = await api.getView();
      if (fresh.step_id === move.to) return { kind: "synced", view: fresh };
      if (fresh.step_id !== move.from || attempt > 0) return { kind: "diverged", view: fresh };
      revision = fresh.revision; // still at the origin: retry the same absolute target once
    }
  }
  /* c8 ignore next */
  throw new Error("unreachable");
}
