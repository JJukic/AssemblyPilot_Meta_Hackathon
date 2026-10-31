"use client";
/* eslint-disable @next/next/no-img-element -- exact analyzed snapshot */
import { useState } from "react";
import type { FaceResult } from "@/lib/faces";
import { validContour } from "@/lib/contours";
import { mediaUrl } from "@/lib/api";
import { ContourControls, ContourPaths, emptyContours } from "./ContourOverlay";

export function FaceResultPanel({ result }: { result: FaceResult }) {
  const [loaded, setLoaded] = useState<{ url: string; width: number; height: number } | null>(null);
  const [contours, setContours] = useState(emptyContours);
  const [showBox, setShowBox] = useState(true);
  const image = result.analyzed_snapshot;
  const ready = image && loaded?.url === image.data_url && loaded.width === image.width && loaded.height === image.height;
  const layers = (result.contours ?? []).filter((layer) => validContour(layer, {
    snapshot_id: result.snapshot_id, width: image?.width ?? layer.width, height: image?.height ?? layer.height,
  }));
  return <section className="geometry-result" aria-label="Face orientation">
    <h3>Face orientation: {result.status.replaceAll("_", " ")}</h3>
    <p>Expected face: {result.expected_face_name ?? result.expected_face_id ?? "No rule"}</p>
    <p>Observed face: {result.observed_face_name ?? result.observed_face_id ?? "Unresolved"}</p>
    <p>{result.guidance}</p>
    {result.matching_score !== null && <p>Visual similarity: {result.matching_score.toFixed(2)} (not a probability)</p>}
    {result.matched_reference_image_id && <img width={160} alt="Matched face reference" src={mediaUrl(`/api/media/${result.matched_reference_image_id}`)} />}
    <label><input type="checkbox" checked={showBox} disabled={!image} onChange={(event) => setShowBox(event.target.checked)} /> Bounding Box (face quadrilateral)</label>
    <ContourControls layers={layers} enabled={contours} onChange={(kind, checked) => setContours({ ...contours, [kind]: checked })} />
    {image && <div className="geometry-image-stage">
      <img src={image.data_url} width={image.width} height={image.height} alt="Exact face inspection snapshot"
        onLoad={(event) => setLoaded({ url: image.data_url, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
        onError={() => setLoaded(null)} />
      {ready && showBox && <svg viewBox={`0 0 ${image.width} ${image.height}`} aria-label="Matched planar face">
        <polygon points={result.quadrilateral.map((p) => p.join(",")).join(" ")} fill="none" stroke="#ffd171" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>}
      {ready && <ContourPaths layers={layers} enabled={contours} width={image.width} height={image.height} />}
    </div>}
  </section>;
}
