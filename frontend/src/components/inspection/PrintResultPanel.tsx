"use client";
/* eslint-disable @next/next/no-img-element -- exact analyzed image, no optimization */
import { useState } from "react";
import { mediaUrl } from "@/lib/api";
import type { PrintRecognition } from "@/lib/prints";
import type { AnalyzedSnapshot } from "@/types/inspection";

export function PrintResultPanel({ result, snapshot }: { result: PrintRecognition; snapshot: AnalyzedSnapshot }) {
  const [loaded, setLoaded] = useState(false);
  const box = result.bounding_box;
  return <section className="geometry-result" aria-label="Printed Text & Logo Inspection">
    <h3>Printed Text &amp; Logo Inspection</h3>
    <p><b>Expected:</b> {result.expected_print ?? "No print rule"}</p>
    <p><b>Observed text:</b> {result.observed_print ?? "Not read"}</p>
    {result.observed_logo && <p><b>Logo interpretation:</b> {result.observed_logo}</p>}
    <p><b>Registered printed side:</b> {result.observed_registered_side_name ?? "Unidentified"}</p>
    <p><b>Print Recognition:</b> {result.recognition_status}</p>
    <p><b>Method:</b> {result.recognition_method.replaceAll("_", " ")} · <b>Evidence quality:</b> {result.evidence_quality}</p>
    <p><b>Physical direction:</b> {!result.direction_required ? "Not required" : result.direction_supported ? "Supported surface; see orientation result" : "Uncertain"}</p>
    <p>{result.description}</p><p>{result.suggested_action}</p>
    {result.known_alternative && <p>This text matches a configured alternative label.</p>}
    {result.reference_image_id && <img width={160} src={mediaUrl(`/api/media/${result.reference_image_id}`)} alt="Print reference supplied for inspection" />}
    <div className="geometry-image-stage"><img src={snapshot.data_url} width={snapshot.width} height={snapshot.height} alt="Exact print inspection snapshot"
      onLoad={(event) => setLoaded(event.currentTarget.naturalWidth === snapshot.width && event.currentTarget.naturalHeight === snapshot.height)} onError={() => setLoaded(false)} />
      {loaded && box && <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="Observed printed region">
        <rect x={box.x * 1000} y={box.y * 1000} width={box.width * 1000} height={box.height * 1000} fill="none" stroke="#69d5ff" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>}
    </div>
    {!box && <p className="muted">No reliable printed region was localized; the original analyzed image is shown.</p>}
    <p className="muted">AI recognition and deterministic reference matching are separate evidence. Recognized print alone does not verify placement or physical direction.</p>
  </section>;
}
