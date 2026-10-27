"use client";
/* eslint-disable @next/next/no-img-element -- Render the exact analyzed JPEG without image optimization. */
import { useState } from "react";
import { isValidBoundingBox } from "@/lib/diagnosis-validation";
import type { AnalyzedSnapshot, InspectionIssue } from "@/types/inspection";

export function DiagnosticOverlay({ snapshot, issues }: {
  snapshot: AnalyzedSnapshot; issues: InspectionIssue[];
}) {
  const [loaded, setLoaded] = useState<{ url: string; width: number; height: number } | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const ready = loaded?.url === snapshot.data_url && loaded.width === snapshot.width && loaded.height === snapshot.height;
  const boxes = issues.flatMap((issue, index) => issue.type !== "missing_part" && isValidBoundingBox(issue.bounding_box)
    ? [{ box: issue.bounding_box, index, description: issue.description }] : []);
  return <figure className="diagnostic-overlay">
    <div className="diagnostic-image-stage">
      <img src={snapshot.data_url} width={snapshot.width} height={snapshot.height} alt="Analyzed snapshot"
        onLoad={(event) => setLoaded({ url: snapshot.data_url, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
        onError={() => { setLoaded(null); setFailedUrl(snapshot.data_url); }} />
      {ready && boxes.length > 0 && <><svg className="diagnostic-boxes" viewBox="0 0 1000 1000" preserveAspectRatio="none" role="img" aria-label="Diagnostic bounding boxes">
        {boxes.map(({ box, index, description }) => <g key={index}>
          <title>{`Issue ${index + 1}: ${description}`}</title>
          <rect data-issue-index={index} x={box.x * 1000} y={box.y * 1000} width={box.width * 1000} height={box.height * 1000} vectorEffect="non-scaling-stroke" />
        </g>)}
      </svg>{boxes.map(({ box, index }) => <span key={index} aria-hidden="true" className="diagnostic-label"
        style={{ left: `min(${box.x * 100}%, calc(100% - 28px))`, top: `min(${box.y * 100}%, calc(100% - 22px))` }}>{index + 1}</span>)}</>}
    </div>
    <figcaption>Analyzed snapshot · {snapshot.width} × {snapshot.height} px. Numbers match the issues below.</figcaption>
    {ready && boxes.length === 0 && <p className="muted">No reliable locations were reported. No boxes are drawn.</p>}
    {(failedUrl === snapshot.data_url || (loaded?.url === snapshot.data_url && !ready)) && <p role="alert" className="form-error">The analyzed image could not be verified for display. Boxes are hidden.</p>}
  </figure>;
}
