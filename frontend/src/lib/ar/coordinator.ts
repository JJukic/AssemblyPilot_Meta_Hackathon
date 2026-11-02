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
