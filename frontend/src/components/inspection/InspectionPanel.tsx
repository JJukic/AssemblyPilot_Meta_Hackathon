"use client";
/* eslint-disable @next/next/no-img-element -- Browser-local verification capture, never sent to image optimization. */
import { useEffect, useRef, useState } from "react";
import { LoaderCircle, ScanLine } from "lucide-react";
import { DiagnosisDetails } from "./DiagnosisDetails";
import { useInspectionSession } from "./InspectionSession";
import { inspectSnapshot, verifySnapshot } from "@/lib/inspection";
import { isWorkflowInspection, transition } from "@/lib/workflow";
import { ApiError, errorMessage } from "@/lib/api";
import type { Snapshot } from "@/types/assembly";
import type { InspectionResponse } from "@/types/inspection";
import type { WorkflowState } from "@/types/workflow";

// A manual capture/project/step/specification change remounts and aborts this component.
// Capture & Verify obtains a separate fresh frame without changing that input boundary.
export function InspectionPanel({ projectId, projectName, stepId, stepTitle, snapshot, captureFresh, cameraReady, onContinue, onProgressChange }: {
  projectId: string; projectName: string; stepId: string; stepTitle: string; snapshot: Snapshot | null;
  captureFresh: () => Snapshot | null; cameraReady: boolean; onContinue?: () => void; onProgressChange: () => void;
}) {
  const { add } = useInspectionSession();
  const [phase, setPhase] = useState<WorkflowState>("idle");
  const [result, setResult] = useState<InspectionResponse | null>(null);
  const [fresh, setFresh] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const busy = phase === "inspecting" || phase === "verifying";
  const workflow = result && isWorkflowInspection(result, stepId) ? result : null;
  useEffect(() => () => controllerRef.current?.abort(), []);
  const move = (target: WorkflowState) => setPhase((previous) => transition(previous, target));

  function remember(diagnosis: InspectionResponse, frame: Snapshot) {
    setResult(diagnosis);
    add({ project_id: projectId, project_name: projectName, step_title: stepTitle, captured_at: frame.capturedAt, result: diagnosis });
  }
  async function inspect() {
    if (!snapshot || controllerRef.current) return;
    const controller = new AbortController(); controllerRef.current = controller;
    move("inspecting"); setError(null); setResult(null); setFresh(null);
    try {
      const diagnosis = await inspectSnapshot(projectId, stepId, snapshot, controller.signal);
      if (!controller.signal.aborted) {
        remember(diagnosis, snapshot);
        move(diagnosis.status === "correct" ? "correct" : diagnosis.status === "incorrect" ? "correction_required" : "uncertain");
        onProgressChange();
      }
    } catch (cause) {
      if (!controller.signal.aborted) { setError(errorMessage(cause)); move("error"); onProgressChange(); }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }
  async function verify() {
    if (!workflow || controllerRef.current || phase !== "awaiting_rescan") return;
    const controller = new AbortController(); controllerRef.current = controller;
    move("verifying"); setError(null);
    try {
      // This call draws the current video frame NOW. Never reuse snapshot or the old result.
      const frame = captureFresh();
      if (!frame) throw new Error("Start the camera and wait for a live image before verifying.");
      setFresh(frame);
      const verification = await verifySnapshot(projectId, workflow, frame, controller.signal);
      if (!controller.signal.aborted) {
        remember(verification.inspection, frame); setFresh(null);
        move(verification.status); onProgressChange();
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof ApiError && [400, 404, 409, 410, 413, 415, 422].includes(cause.status)
          ? errorMessage(cause) : `AI verification is temporarily unavailable. Please retry. ${errorMessage(cause)}`);
        move("error"); onProgressChange();
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }
  const headings: Partial<Record<WorkflowState, string>> = {
    correction_required: "Correction Required", awaiting_rescan: "Ready to Verify", verifying: "Verifying Assembly…",
    verified: "Step Verified", still_incorrect: "Correction Still Required", uncertain: "Another View Needed",
    correct: "Ready for a verification scan", error: "Verification unavailable",
  };
  return <section className="panel inspection-panel" aria-labelledby="inspection-heading">
    <div className="panel-heading"><div className="heading-with-icon"><ScanLine size={18} /><h2 id="inspection-heading">Meta AI inspection</h2></div><span className="tag">ON DEMAND</span></div>
    <div className="inspection-content">
      <p className="muted">Inspect the captured frame for this step. Sends this snapshot, the step specifications and relevant reference photographs to Meta.</p>
      <button className="button primary inspect-button" disabled={!snapshot || busy} onClick={() => void inspect()}>
        {busy ? <LoaderCircle size={16} className="spinner" /> : <ScanLine size={16} />}{phase === "inspecting" ? "Inspecting with Meta…" : "Inspect with Meta AI"}
      </button>
      {!snapshot && <p className="empty-caption">Capture a camera frame first.</p>}
      {phase === "inspecting" && <p role="status" className="muted">Waiting for a diagnosis. You can keep using the camera; a new frame or step clears this request.</p>}
      {workflow && <section className={`correction-workflow workflow-${phase}`} aria-label="Correction and verification">
        <h3>{headings[phase]}</h3>
        {phase === "verified" && <p>Verified by semantic AI assessment. Geometric placement and millimeter tolerances have not been measured.</p>}
        {phase === "correct" && <p>This initial diagnosis looks correct. A fresh verification scan is required to record this step as verified.</p>}
        {phase === "verifying" && <p role="status">Assessing the fresh image against the step and previous findings. The camera preview remains available.</p>}
        {!busy && phase !== "verified" && workflow.correction_plan.length > 0 && <ol>{workflow.correction_plan.map((action, index) => <li key={action.issue_id ?? index}>{action.instruction}</li>)}</ol>}
        {!["verifying", "awaiting_rescan", "verified"].includes(phase) && <button className="button secondary" onClick={() => { setError(null); move("awaiting_rescan"); }}>
          {phase === "correction_required" || phase === "still_incorrect" ? "I've corrected it" : "Prepare a new scan"}
        </button>}
        {phase === "awaiting_rescan" && <>
          <p>Keep the expected assembly in view. This button takes a new photograph and sends it for verification.</p>
          <button className="button primary" disabled={!cameraReady} onClick={() => void verify()}>Capture &amp; Verify</button>
          {!cameraReady && <p>Start the camera to capture fresh verification evidence.</p>}
        </>}
        {phase === "verified" && <>
          <p>The new image supports the expected step. Visual verification does not certify mechanical stability or hidden connections.</p>
          {onContinue && <button className="button primary" onClick={onContinue}>Continue to Next Step</button>}
        </>}
      </section>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {fresh && <figure className="verification-capture"><img src={fresh.dataUrl} width={fresh.width} height={fresh.height} alt="Fresh verification snapshot" /><figcaption>Fresh verification capture · {new Date(fresh.capturedAt).toLocaleTimeString()}</figcaption></figure>}
      {result && !busy && <>
        {error && <p className="muted">Last completed diagnosis below; this retry did not verify the assembly.</p>}
        <DiagnosisDetails result={result} />
        {workflow && workflow.tracked_issues.length > 0 && <details className="finding-history"><summary>Finding history ({workflow.tracked_issues.length})</summary>
          <ul>{workflow.tracked_issues.map((item) => <li key={item.issue_id}><strong>{item.resolution} · {item.original.type.replaceAll("_", " ")}</strong><p>{item.original.description}</p><p>{item.evidence}</p></li>)}</ul>
          <p className="muted">Finding associations use block/category evidence. They do not establish physical object tracking across camera views.</p>
        </details>}
      </>}
    </div>
  </section>;
}
