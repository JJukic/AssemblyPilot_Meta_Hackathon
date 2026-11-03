/* eslint-disable @next/next/no-img-element -- show the actual registered reference */
import { validFace } from "@/lib/faces";
import { mediaUrl } from "@/lib/api";
import { AlertCircle, CircleCheck, HelpCircle } from "lucide-react";
import { DiagnosticOverlay } from "./DiagnosticOverlay";
import type { InspectionResponse } from "@/types/inspection";
import { overallResult } from "@/lib/overall";
import { validPrint } from "@/lib/prints";
import { isWorkflowInspection } from "@/lib/workflow";

export function DiagnosisDetails({ result }: { result: InspectionResponse }) {
  const face = "face" in result && validFace(result.face) ? result.face : null;
  const workflow = "state" in result && isWorkflowInspection(result, result.step_id) ? result : null;
  const print = workflow && "print_recognition" in workflow && validPrint(workflow.print_recognition, workflow.snapshot_id)
    ? workflow.print_recognition : null;
  const overall = workflow ? overallResult({
    state: workflow.state, status: workflow.status,
    printGate: print?.gate_status ?? null,
    faceStatus: face?.status ?? null,
    geometryStatus: workflow.geometry?.geometry_status ?? null,
    geometryConstrained: !!workflow.geometry?.constraint_id,
  }) : null;
  const overallClass = overall?.kind === "verified" || overall?.kind === "correct" ? "correct"
    : overall?.kind === "uncertain" ? "uncertain" : "incorrect";
  const referenceLayers = face?.snapshot_id === result.snapshot_id ? face?.contours ?? [] : [];
  return <div className="diagnosis">
    {overall && <section aria-label="Overall assembly result" className={`diagnosis-status diagnosis-${overallClass}`}>
      {overall.kind === "incorrect" || overall.kind === "error" ? <AlertCircle size={20} /> : overall.kind === "uncertain" ? <HelpCircle size={20} /> : <CircleCheck size={20} />}
      <div>
        <h3>{overall.headline}</h3>
        <p>{overall.detail}</p>
        {print && print.gate_status === "fail" && <>
          <p>Reason: The observed printed side does not match the required side.</p>
          <p><b>Expected:</b> {print.expected_print}</p>
          <p><b>Observed:</b> {print.observed_print ?? "Not read"}</p>
          <p><b>Required action:</b> {print.suggested_action}</p>
        </>}
        {print && print.gate_status === "uncertain" && <>
          <p>Reason: The required printed side or its orientation could not be verified.</p>
          <p><b>Expected:</b> {print.expected_print}</p>
          <p><b>Observed:</b> {print.observed_print ?? "Not read"}</p>
          <p><b>Required action:</b> {print.suggested_action}</p>
        </>}
      </div>
    </section>}
    <p className="detection-eyebrow">Semantic assessment (shape, color and assembly arrangement)</p>
    <div className={`diagnosis-status diagnosis-${result.status}`}>
      {result.status === "correct" ? <CircleCheck size={20} /> : result.status === "incorrect" ? <AlertCircle size={20} /> : <HelpCircle size={20} />}
      <h3>{result.status.charAt(0).toUpperCase() + result.status.slice(1)}</h3>
    </div>
    <div className="diagnosis-meta">
    <p className="confidence-note">{result.confidence === null ? "Confidence not provided." : `Model confidence estimate: ${Math.round(result.confidence * 100)}% — not a calibrated probability.`}</p>
    <p className="confidence-note">{result.model} · Meta request: {(result.model_latency_ms / 1000).toFixed(2)} s (includes retries)</p>
    </div>
    <dl className="detection-summary" aria-label="Detection summary">
      <div><dt>Component groups</dt><dd>{result.visible_blocks.length}</dd></div>
      <div><dt>Reported issues</dt><dd>{result.issues.length}</dd></div>
      <div><dt>SAM issue matches</dt><dd>{result.segmentations?.filter((item) => item.status === "matched").length ?? 0}</dd></div>
    </dl>
    <p className="diagnosis-explanation">{result.explanation}</p>
    {result.active_vision && <aside className="active-vision" aria-label="Additional camera view needed">
      <h4>ANOTHER VIEW NEEDED · {result.active_vision.requested_view.replaceAll("_", " ")}</h4>
      <p>{result.active_vision.reason}</p><strong>{result.active_vision.instruction}</strong>
      <p>Keep the assembly unchanged, capture the requested view, then inspect again.</p>
    </aside>}
    {result.comparison_reference_id !== undefined && <details className="comparison-reference">
      <summary>Step reference used for this inspection</summary>
      {result.comparison_reference_id ? <><p>This registered photo was sent to Muse to compare the assembly. It is separate from geometric feature matching.</p>
        <img src={mediaUrl(`/api/media/${result.comparison_reference_id}`)} alt="Step reference sent to Meta" />
      </> : <p>No assembled-step reference photo was sent. Check the selected step reference and reference-image limit before judging the complete assembly.</p>}
    </details>}
    <DiagnosticOverlay key={result.analyzed_snapshot.data_url} snapshot={result.analyzed_snapshot} snapshotId={result.snapshot_id} referenceLayers={referenceLayers} issues={result.issues} segmentations={result.segmentations} />
    {result.segmentations && <p className="confidence-note">SAM localization: {(result.segmentations.reduce((sum, entry) => sum + entry.latency_ms, 0) / 1000).toFixed(2)} s. {result.segmentations.length === 0 ? "Not requested for this diagnosis." : "Masks locate visible parts; they do not verify correctness."}</p>}
    <div className="detection-findings">
    <section aria-label="Visible components"><h4>VISIBLE COMPONENTS</h4>
    {result.visible_blocks.length ? <ul className="diagnosis-list">{result.visible_blocks.map((block, index) => <li key={index}>{block.description}<span>{block.estimated_count === null ? "Count uncertain" : `Estimated count: ${block.estimated_count}`}</span></li>)}</ul> : <p className="muted">No components confidently identified.</p>}
    </section>
    <section aria-label="Identified issues"><h4>IDENTIFIED ISSUES</h4>
    {result.issues.length ? <ol className="diagnosis-list">{result.issues.map((issue, index) => <li key={index}>
      <strong>{index + 1}. {issue.type.replaceAll("_", " ")}</strong><p>{issue.description}</p>
      <p><b>Expected:</b> {issue.expected}</p><p><b>Observed:</b> {issue.observed}</p>
      <span>{issue.suggested_fix}</span>
      {result.segmentations?.filter((entry) => entry.issue_index === index).map((entry) => <p key={index} className={`segmentation-status segmentation-${entry.status}`}>
        <b>Segmentation · {entry.status.replaceAll("_", " ")}</b>{entry.concept ? ` · ${entry.concept}` : entry.prompt_kind === "box" ? " · spatially indicated component" : ""}<br />{entry.message}
        {entry.status !== "matched" && issue.bounding_box && " The box shown is Muse localization."}
      </p>)}
      {issue.bounding_box === null && !result.segmentations?.some((entry) => entry.issue_index === index && entry.status === "matched") && <small>No location marked for this issue.</small>}
    </li>)}</ol> : <p className="muted">No issues reported. Hidden connections are not verified.</p>}
    </section></div>
    <div className="next-action"><h4>NEXT ACTION</h4><p>{result.next_action}</p></div>
    <p className="confidence-note">A visual diagnosis is not a guarantee of physical correctness. Block offsets and dimensions have not been measured. Step navigation remains manual.</p>
  </div>;
}
