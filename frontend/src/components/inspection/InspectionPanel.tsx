"use client";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, CircleCheck, HelpCircle, LoaderCircle, ScanLine } from "lucide-react";
import { inspectSnapshot } from "@/lib/inspection";
import { errorMessage } from "@/lib/api";
import type { Snapshot } from "@/types/assembly";
import type { InspectionResult } from "@/types/inspection";

// Parent keys this component by project, step and snapshot, so results can never migrate to new input.
export function InspectionPanel({ projectId, stepId, snapshot }: {
  projectId: string; stepId: string; snapshot: Snapshot | null;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InspectionResult | null>(null);
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
      if (!controller.signal.aborted) setResult(diagnosis);
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
      {result && <div className="diagnosis" aria-live="polite">
        <div className={`diagnosis-status diagnosis-${result.status}`}>
          {result.status === "correct" ? <CircleCheck size={20} /> : result.status === "incorrect" ? <AlertCircle size={20} /> : <HelpCircle size={20} />}
          <h3>{result.status.charAt(0).toUpperCase() + result.status.slice(1)}</h3>
        </div>
        <p className="confidence-note">{result.confidence === null ? "Confidence not provided." : `Model confidence estimate: ${Math.round(result.confidence * 100)}% — not a calibrated probability.`}</p>
        <p className="diagnosis-explanation">{result.explanation}</p>
        <h4>VISIBLE COMPONENTS</h4>
        {result.visible_blocks.length ? <ul className="diagnosis-list">{result.visible_blocks.map((block, index) => <li key={index}>{block.description}<span>{block.estimated_count === null ? "Count uncertain" : `Estimated count: ${block.estimated_count}`}</span></li>)}</ul> : <p className="muted">No components confidently identified.</p>}
        <h4>IDENTIFIED ISSUES</h4>
        {result.issues.length ? <ul className="diagnosis-list">{result.issues.map((issue, index) => <li key={index}><strong>{issue.type.replaceAll("_", " ")}</strong><p>{issue.description}</p><span>{issue.suggested_fix}</span></li>)}</ul> : <p className="muted">No issues reported. Hidden connections are not verified.</p>}
        <div className="next-action"><h4>NEXT ACTION</h4><p>{result.next_action}</p></div>
        <p className="confidence-note">A visual diagnosis is not a guarantee of physical correctness. Step navigation remains manual.</p>
      </div>}
    </div>
  </section>;
}
