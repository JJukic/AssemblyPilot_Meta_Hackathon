import { AlertCircle, CircleCheck, HelpCircle } from "lucide-react";
import { DiagnosticOverlay } from "./DiagnosticOverlay";
import type { InspectionResponse } from "@/types/inspection";

export function DiagnosisDetails({ result }: { result: InspectionResponse }) {
  return <div className="diagnosis">
    <div className={`diagnosis-status diagnosis-${result.status}`}>
      {result.status === "correct" ? <CircleCheck size={20} /> : result.status === "incorrect" ? <AlertCircle size={20} /> : <HelpCircle size={20} />}
      <h3>{result.status.charAt(0).toUpperCase() + result.status.slice(1)}</h3>
    </div>
    <p className="confidence-note">{result.confidence === null ? "Confidence not provided." : `Model confidence estimate: ${Math.round(result.confidence * 100)}% — not a calibrated probability.`}</p>
    <p className="confidence-note">{result.model} · Meta request: {(result.model_latency_ms / 1000).toFixed(2)} s (includes retries)</p>
    <p className="diagnosis-explanation">{result.explanation}</p>
    {result.active_vision && <aside className="active-vision" aria-label="Additional camera view needed">
      <h4>ANOTHER VIEW NEEDED · {result.active_vision.requested_view.replaceAll("_", " ")}</h4>
      <p>{result.active_vision.reason}</p><strong>{result.active_vision.instruction}</strong>
      <p>Keep the assembly unchanged, capture the requested view, then inspect again.</p>
    </aside>}
    <DiagnosticOverlay key={result.analyzed_snapshot.data_url} snapshot={result.analyzed_snapshot} issues={result.issues} segmentations={result.segmentations} />
    {result.segmentations && <p className="confidence-note">SAM localization: {(result.segmentations.reduce((sum, entry) => sum + entry.latency_ms, 0) / 1000).toFixed(2)} s. {result.segmentations.length === 0 ? "Not requested for this diagnosis." : "Masks locate visible parts; they do not verify correctness."}</p>}
    <h4>VISIBLE COMPONENTS</h4>
    {result.visible_blocks.length ? <ul className="diagnosis-list">{result.visible_blocks.map((block, index) => <li key={index}>{block.description}<span>{block.estimated_count === null ? "Count uncertain" : `Estimated count: ${block.estimated_count}`}</span></li>)}</ul> : <p className="muted">No components confidently identified.</p>}
    <h4>IDENTIFIED ISSUES</h4>
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
    <div className="next-action"><h4>NEXT ACTION</h4><p>{result.next_action}</p></div>
    <p className="confidence-note">A visual diagnosis is not a guarantee of physical correctness. Block offsets and dimensions have not been measured. Step navigation remains manual.</p>
  </div>;
}
