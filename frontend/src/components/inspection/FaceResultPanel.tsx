"use client";
/* eslint-disable @next/next/no-img-element -- exact analyzed snapshot */
import { useState } from "react";
import type { FaceResult } from "@/lib/faces";
import { mediaUrl } from "@/lib/api";
export function FaceResultPanel({ result }: { result: FaceResult }) {
  const [loaded, setLoaded] = useState(""); const image = result.analyzed_snapshot;
  return <section className="geometry-result" aria-label="Face orientation"><h3>Face orientation: {result.status.replaceAll("_", " ")}</h3>
    <p>Expected face: {result.expected_face_name ?? result.expected_face_id ?? "No rule"}</p><p>Observed face: {result.observed_face_name ?? result.observed_face_id ?? "Unresolved"}</p>
    <p>{result.guidance}</p>
    {result.matching_score !== null && <p>Visual similarity: {result.matching_score.toFixed(2)} (not a probability)</p>}
    {result.matched_reference_image_id && <img width={160} alt="Matched face reference" src={mediaUrl(`/api/media/${result.matched_reference_image_id}`)} />}
    {image && <div className="geometry-image-stage"><img src={image.data_url} width={image.width} height={image.height} alt="Exact face inspection snapshot" onLoad={(e) => setLoaded(e.currentTarget.naturalWidth === image.width && e.currentTarget.naturalHeight === image.height ? image.data_url : "")} onError={() => setLoaded("")} />
      {loaded === image.data_url && <svg viewBox={`0 0 ${image.width} ${image.height}`} aria-label="Matched planar face"><polygon points={result.quadrilateral.map((p) => p.join(",")).join(" ")} fill="none" stroke="#ffd171" strokeWidth={3} /></svg>}
    </div>}
  </section>;
}
