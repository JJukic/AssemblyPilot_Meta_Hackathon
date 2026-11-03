/**
 * One authoritative inspection coordinator per project/step.
 * Manual Verify, autonomous triggers and companion captures all take
 * the same lease; a stale result (wrong token or step) is rejected.
 */
export class InspectionCoordinator {
  private token = 0;
  private active: { token: number; projectId: string; stepId: string; kind: string } | null = null;

  get busy() { return this.active !== null; }
  get activeStep() { return this.active?.stepId ?? null; }

  /** Returns a lease token, or null when a transaction is running. */
  acquire(projectId: string, stepId: string, kind: string): number | null {
    if (this.active) return null;
    this.token++;
    this.active = { token: this.token, projectId, stepId, kind };
    return this.token;
  }

  /** A result is current only for the exact lease + project/step. */
  accepts(token: number, projectId: string, stepId: string): boolean {
    return !!this.active && this.active.token === token && this.active.projectId === projectId && this.active.stepId === stepId;
  }

  release(token: number) {
    if (this.active?.token === token) this.active = null;
  }

  /** Step navigation invalidates any in-flight work for the old step. */
  invalidateStep() {
    this.active = null;
    this.token++;
  }
}

/**
 * One prepared inspection upload ("run"). Its AbortController exists before
 * the first `await`, so Stop/Pause/Re-anchor can cancel it while the frame is
 * still being fingerprinted or prepared. Callers check `open` after EVERY
 * asynchronous preparation step and once more directly before the upload;
 * a closed run never starts an upload. A request that already reached the
 * backend is not withdrawn — its late result is simply not used.
 */
export class UploadRun {
  readonly controller = new AbortController();
  /** Set when the upload really started (for diagnostics and tests). */
  uploadStarted = false;
  constructor(private stillValid: () => boolean = () => true) {}

  get signal(): AbortSignal {
    return this.controller.signal;
  }
  /** Still allowed to proceed: not aborted, not superseded, not stopped/paused. */
  get open(): boolean {
    return !this.controller.signal.aborted && this.stillValid();
  }
  abort() {
    this.controller.abort();
  }
  /** Start the upload only if the run is still open (the final pre-upload check). */
  upload<T>(send: (signal: AbortSignal) => Promise<T>): Promise<T> | null {
    if (!this.open) return null;
    this.uploadStarted = true;
    return send(this.controller.signal);
  }
}
