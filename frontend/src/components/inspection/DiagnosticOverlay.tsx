"use client";
/* eslint-disable @next/next/no-img-element -- Render the exact analyzed JPEG without image optimization. */
import { useState } from "react";
import { validContour } from "@/lib/contours";
import { ContourControls, ContourPaths, emptyContours } from "./ContourOverlay";
import { isValidBoundingBox } from "@/lib/diagnosis-validation";
import type { AnalyzedSnapshot, InspectionIssue, IssueSegmentation } from "@/types/inspection";

export function DiagnosticOverlay({ snapshot, issues, segmentations = [], snapshotId }: {
  snapshotId?: string; snapshot: AnalyzedSnapshot; issues: InspectionIssue[]; segmentations?: IssueSegmentation[];
}) {
  const [contours, setContours] = useState(emptyContours);
  const [showBoxes, setShowBoxes] = useState(true);
  const [annotated, setAnnotated] = useState(true);
  const [showSegmentation, setShowSegmentation] = useState(true);
  const [invalidMasks, setInvalidMasks] = useState<string[]>([]);
  const [loaded, setLoaded] = useState<{ url: string; width: number; height: number } | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const ready = loaded?.url === snapshot.data_url && loaded.width === snapshot.width && loaded.height === snapshot.height;
  const matches = segmentations.flatMap((entry) => {
    const instance = entry.status === "matched" && entry.result?.instances.find((item) => item.instance_id === entry.selected_instance_id);
    return instance && issues[entry.issue_index]?.type !== "missing_part" && !invalidMasks.includes(instance.mask.data_url)
      ? [{ instance, index: entry.issue_index }] : [];
  });
  const boxes = issues.flatMap((issue, index) => {
    if (issue.type === "missing_part") return [];
    const match = matches.find((item) => item.index === index);
    const box = match ? { x: match.instance.left / snapshot.width, y: match.instance.top / snapshot.height,
      width: match.instance.mask.width / snapshot.width, height: match.instance.mask.height / snapshot.height } : issue.bounding_box;
    return isValidBoundingBox(box) ? [{ box, index, description: issue.description, sam: !!match }] : [];
  });
  const layers = segmentations.flatMap((entry) => entry.status === "matched" && entry.outline &&
    validContour(entry.outline, { snapshot_id: snapshotId ?? "", width: snapshot.width, height: snapshot.height }) &&
    matches.some((match) => match.index === entry.issue_index) ? [entry.outline] : []);
  return <figure className="diagnostic-overlay">
    <div className="segmentation-controls">
      <button type="button" className="secondary-button" aria-pressed={!annotated} onClick={() => setAnnotated(!annotated)}>{annotated ? "Show original" : "Show annotated"}</button>
      <label><input type="checkbox" checked={showSegmentation} onChange={(event) => setShowSegmentation(event.target.checked)} disabled={!matches.length} /> Show Segmentation</label>
    </div>
    <label><input type="checkbox" checked={showBoxes} disabled={!boxes.length} onChange={(event) => setShowBoxes(event.target.checked)} /> Bounding Box</label>
    <ContourControls layers={layers} enabled={contours} onChange={(kind, checked) => setContours({ ...contours, [kind]: checked })} />
    <div className="diagnostic-image-stage">
      <img src={snapshot.data_url} width={snapshot.width} height={snapshot.height} alt="Analyzed snapshot"
        onLoad={(event) => setLoaded({ url: snapshot.data_url, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
        onError={() => { setLoaded(null); setFailedUrl(snapshot.data_url); }} />
      {ready && annotated && showSegmentation && matches.map(({ instance, index }) => <img key={`${index}:${instance.instance_id}`}
        className="segmentation-mask" alt={`SAM mask for issue ${index + 1}`} src={instance.mask.data_url}
        style={{ left: `${instance.left / snapshot.width * 100}%`, top: `${instance.top / snapshot.height * 100}%`,
          width: `${instance.mask.width / snapshot.width * 100}%`, height: `${instance.mask.height / snapshot.height * 100}%` }}
        onLoad={(event) => { if (event.currentTarget.naturalWidth !== instance.mask.width || event.currentTarget.naturalHeight !== instance.mask.height) setInvalidMasks((previous) => [...previous, instance.mask.data_url]); }}
        onError={() => setInvalidMasks((previous) => [...previous, instance.mask.data_url])} />)}
      {ready && annotated && showBoxes && boxes.length > 0 && <><svg className="diagnostic-boxes" viewBox="0 0 1000 1000" preserveAspectRatio="none" role="img" aria-label="Diagnostic bounding boxes">
        {boxes.map(({ box, index, description, sam }) => <g key={index}>
          <title>{`Issue ${index + 1}: ${description}`}</title>
          <rect data-source={sam ? "sam" : "muse"} data-issue-index={index} x={box.x * 1000} y={box.y * 1000} width={box.width * 1000} height={box.height * 1000} vectorEffect="non-scaling-stroke" />
        </g>)}
      </svg>{boxes.map(({ box, index }) => <span key={index} aria-hidden="true" className="diagnostic-label"
        style={{ left: `min(${box.x * 100}%, calc(100% - 28px))`, top: `min(${box.y * 100}%, calc(100% - 22px))` }}>{index + 1}</span>)}</>}
      {ready && annotated && <ContourPaths layers={layers} enabled={contours} width={snapshot.width} height={snapshot.height} />}
    </div>
    <figcaption>Analyzed snapshot · {snapshot.width} × {snapshot.height} px. Numbers match the issues below.</figcaption>
    {invalidMasks.length > 0 && <p role="alert">A segmentation mask could not be verified. Muse localization is retained.</p>}
    {ready && boxes.length === 0 && <p className="muted">No reliable locations were reported. No boxes are drawn.</p>}
    {(failedUrl === snapshot.data_url || (loaded?.url === snapshot.data_url && !ready)) && <p role="alert" className="form-error">The analyzed image could not be verified for display. Boxes are hidden.</p>}
  </figure>;
}
