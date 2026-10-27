"use client";
import { useEffect, useRef, useState } from "react";
import { LoaderCircle, ScanLine } from "lucide-react";
import { DiagnosisDetails } from "./DiagnosisDetails";
import { useInspectionSession } from "./InspectionSession";
import { inspectSnapshot } from "@/lib/inspection";
import { errorMessage } from "@/lib/api";
import type { Snapshot } from "@/types/assembly";
import type { InspectionResponse } from "@/types/inspection";

// Parent keys this component by project, step and snapshot, so results can never migrate to new input.
export function InspectionPanel({ projectId, projectName, stepId, stepTitle, snapshot }: {
  projectId: string; projectName: string; stepId: string; stepTitle: string; snapshot: Snapshot | null;
}) {
  const { add } = useInspectionSession();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InspectionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => controllerRef.current?.abort(), []);

  async function inspect() {
    if (!snapshot || controllerRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true); setError(null); setResult(null);
    try {
      const diagnosis = await inspectSnapshot(projectId, stepId, snapshot, controller.signal);
      if (!controller.signal.aborted) {
        setResult(diagnosis);
        add({ project_id: projectId, project_name: projectName, step_title: stepTitle, captured_at: snapshot.capturedAt, result: diagnosis });
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }
  return <section className="panel inspection-panel" aria-labelledby="inspection-heading">
    <div className="panel-heading"><div className="heading-with-icon"><ScanLine size={18} /><h2 id="inspection-heading">Meta AI inspection</h2></div><span className="tag">ON DEMAND</span></div>
    <div className="inspection-content">
      <p className="muted">Inspect the captured frame for this step. Sends this snapshot, the step specifications and relevant reference photographs to Meta.</p>
      <button className="button primary inspect-button" disabled={!snapshot || busy} onClick={() => void inspect()}>
        {busy ? <LoaderCircle size={16} className="spinner" /> : <ScanLine size={16} />}{busy ? "Inspecting with Meta…" : "Inspect with Meta AI"}
      </button>
      {!snapshot && <p className="empty-caption">Capture a camera frame first.</p>}
      {busy && <p role="status" className="muted">Waiting for a diagnosis. You can keep using the camera; a new frame or step clears this request.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {result && <DiagnosisDetails result={result} />}
    </div>
  </section>;
}
