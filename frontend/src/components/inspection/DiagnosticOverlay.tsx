"use client";
/* eslint-disable @next/next/no-img-element -- Render the exact analyzed JPEG without image optimization. */
import { useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/api";
import { detectEdges, type EdgeDebugResult } from "@/lib/edge-debug";
import { ObjectLocalizationControls } from "./ObjectLocalizationControls";
import type { ObjectLocalization } from "@/lib/object-localization";
import { validContour, type ContourLayer } from "@/lib/contours";
import { ContourControls, ContourPaths, emptyContours, OverlayOption } from "./ContourOverlay";
import { isValidBoundingBox } from "@/lib/diagnosis-validation";
import type { AnalyzedSnapshot, InspectionIssue, IssueSegmentation } from "@/types/inspection";

export function DiagnosticOverlay({ snapshot, issues, segmentations = [], snapshotId, referenceLayers = [] }: {
  referenceLayers?: ContourLayer[]; snapshotId?: string; snapshot: AnalyzedSnapshot; issues: InspectionIssue[]; segmentations?: IssueSegmentation[];
}) {
  const [contours, setContours] = useState(emptyContours);
  const [objects, setObjects] = useState<ObjectLocalization | null>(null);
  const [edges, setEdges] = useState<EdgeDebugResult | null>(null);
  const [edgeBusy, setEdgeBusy] = useState(false);
  const [edgeError, setEdgeError] = useState("");
  const edgeRequest = useRef<AbortController | null>(null);
  // DiagnosisDetails remounts this overlay for each exact analyzed JPEG.
  useEffect(() => () => edgeRequest.current?.abort(), []);
  async function showEdges() {
    if (edgeRequest.current) return;
    const controller = new AbortController(); edgeRequest.current = controller;
    setEdgeBusy(true); setEdgeError(""); setEdges(null);
    try {
      const result = await detectEdges({ dataUrl: snapshot.data_url, width: snapshot.width, height: snapshot.height },
        { blur_kernel: 3, low_threshold: 50, high_threshold: 150, roi: null }, controller.signal);
      if (!controller.signal.aborted) {
        if (snapshotId && result.snapshot_id !== snapshotId) throw new Error("Edge evidence belongs to another inspection.");
        setEdges(result); setAnnotated(true);
        setContours((previous) => ({ ...previous, canny_edges: true }));
      }
    } catch (cause) {
      if (!controller.signal.aborted) setEdgeError(errorMessage(cause));
    } finally {
      if (!controller.signal.aborted) { setEdgeBusy(false); edgeRequest.current = null; }
    }
  }
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
  const objectInstances = (objects?.result.instances ?? []).filter((item) => !invalidMasks.includes(item.mask.data_url));
  const samMessage = segmentations.length ? [...new Set(segmentations.map((item) => item.message))].join(" ") :
    "Automatic SAM only runs for reported issues. You can request object masks below even when Muse reports no defect.";
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
  layers.push(...referenceLayers.filter((layer) => layer.kind === "reference_match" && validContour(layer,
    { snapshot_id: snapshotId ?? "", width: snapshot.width, height: snapshot.height })));
  for (const item of objects?.outlines ?? []) {
    if (objectInstances.some((instance) => instance.instance_id === item.instance_id)) layers.push(item.outline);
  }
  if (edges?.analyzed_snapshot.data_url === snapshot.data_url) layers.push(edges.contours);
  return <figure className="diagnostic-overlay">
    <div className="detection-toolbar">
      <div><h4>Analyzed image</h4><span>{snapshot.width} × {snapshot.height} px · {annotated ? "Overlay view" : "Original view"}</span></div>
      <button type="button" className="button secondary" aria-pressed={!annotated} onClick={() => setAnnotated(!annotated)}>{annotated ? "Show original" : "Show annotated"}</button>
    </div>
    <div className="detection-workspace">
    <div className="detection-preview">
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
      {ready && annotated && showSegmentation && objectInstances.map((instance, index) => <img key={`object:${instance.instance_id}`}
        className="segmentation-mask" alt={`SAM object candidate ${index + 1}`} src={instance.mask.data_url}
        style={{ left: `${instance.left / snapshot.width * 100}%`, top: `${instance.top / snapshot.height * 100}%`, width: `${instance.mask.width / snapshot.width * 100}%`, height: `${instance.mask.height / snapshot.height * 100}%` }}
        onLoad={(event) => { if (event.currentTarget.naturalWidth !== instance.mask.width || event.currentTarget.naturalHeight !== instance.mask.height) setInvalidMasks((previous) => [...previous, instance.mask.data_url]); }}
        onError={() => setInvalidMasks((previous) => [...previous, instance.mask.data_url])} />)}
      {ready && annotated && showBoxes && objectInstances.length > 0 && <svg className="diagnostic-boxes" viewBox={`0 0 ${snapshot.width} ${snapshot.height}`} aria-label="Localized object boxes">
        {objectInstances.map((instance, index) => <g key={instance.instance_id}><title>{`Object ${index + 1}: ${objects?.concept} (not a diagnosed defect)`}</title>
          <rect data-source="sam-object" x={instance.left} y={instance.top} width={instance.mask.width} height={instance.mask.height} />
          <text x={instance.left + 3} y={instance.top + 14} fill="#69d5ff" fontSize={12}>{`O${index + 1}`}</text>
        </g>)}
      </svg>}
      {ready && annotated && showBoxes && boxes.length > 0 && <><svg className="diagnostic-boxes" viewBox="0 0 1000 1000" preserveAspectRatio="none" role="img" aria-label="Diagnostic bounding boxes">
        {boxes.map(({ box, index, description, sam }) => <g key={index}>
          <title>{`Issue ${index + 1}: ${description}`}</title>
          <rect data-source={sam ? "sam" : "muse"} data-issue-index={index} x={box.x * 1000} y={box.y * 1000} width={box.width * 1000} height={box.height * 1000} vectorEffect="non-scaling-stroke" />
        </g>)}
      </svg>{boxes.map(({ box, index }) => <span key={index} aria-hidden="true" className="diagnostic-label"
        style={{ left: `min(${box.x * 100}%, calc(100% - 28px))`, top: `min(${box.y * 100}%, calc(100% - 22px))` }}>{index + 1}</span>)}</>}
      {ready && annotated && <ContourPaths layers={layers} enabled={contours} width={snapshot.width} height={snapshot.height} />}
    </div>
    {invalidMasks.length > 0 && <p role="alert">A segmentation mask could not be verified. Muse localization is retained.</p>}
    {ready && boxes.length === 0 && objectInstances.length === 0 && <p className="muted">No reliable locations were reported. No boxes are drawn.</p>}
    </div>
    <section className="detection-settings" aria-label="Detections and overlays">
      <div className="detection-settings-heading"><h4>Detections &amp; overlays</h4><p>Choose what to show on this image.</p></div>
      {!annotated && <p className="overlay-view-note">Original view: overlays are hidden. Select Show annotated to display your selections.</p>}
      <OverlayOption label="Bounding Box" available={boxes.length + objectInstances.length > 0} checked={showBoxes} onChange={setShowBoxes}
        description={objectInstances.length ? `${objectInstances.length} SAM object regions (O labels), separate from diagnosed issues.` : boxes.length ? `${boxes.length} localized issue${boxes.length === 1 ? "" : "s"} · numbers match the findings below.` : "No reliably localized issues in this result."} />
      <OverlayOption label="Show Segmentation" available={matches.length + objectInstances.length > 0} checked={showSegmentation} onChange={setShowSegmentation}
        description={objects ? `${objectInstances.length} independently requested object masks.` : matches.length ? `${matches.length} selected SAM issue masks.` : samMessage}>
        <ObjectLocalizationControls snapshot={snapshot} ready={!!ready} onResult={(result) => {
          setObjects(result);
          if (result) { setAnnotated(true); setShowSegmentation(true); setShowBoxes(true); setContours((previous) => ({ ...previous, sam_outline: true })); }
        }} />
      </OverlayOption>
      <ContourControls unavailableMessages={{ sam_outline: objects && !objectInstances.length ? "No matching object mask was returned." : samMessage,
        reference_match: "Requires an accepted planar-face reference match. A whole-assembly step photo is compared by Muse, not by this overlay. See Face orientation for native-resolution reference evidence." }} layers={layers} enabled={contours} onChange={(kind, checked) => setContours({ ...contours, [kind]: checked })}
        cannyAction={<div className="canny-action">
          <button type="button" className="button secondary" disabled={!ready || edgeBusy} onClick={() => void showEdges()}>
            {edgeBusy ? "Detecting Canny edges…" : "Detect Canny edges"}
          </button>
          <small>Full image · local edge detection · no AI request</small>
          {edges && <small>{edges.edge_pixel_count.toLocaleString()} edge pixels · {edges.processing_ms.toFixed(0)} ms</small>}
          {edgeBusy && <p role="status">Extracting edges from the analyzed snapshot…</p>}
          {edgeError && <p role="alert" className="form-error">{edgeError}</p>}
        </div>} />
      <p className="overlay-note">Overlays visualize evidence. Raw edges do not change the inspection verdict.</p>
    </section>
    </div>
    <figcaption>Analyzed snapshot · {snapshot.width} × {snapshot.height} px. Numbers match the issues below.</figcaption>
    {(failedUrl === snapshot.data_url || (loaded?.url === snapshot.data_url && !ready)) && <p role="alert" className="form-error">The analyzed image could not be verified for display. Boxes are hidden.</p>}
  </figure>;
}
