"use client";
/* eslint-disable @next/next/no-img-element -- Exact backend-returned metrology snapshot. */

import { useState } from "react";
import type { GeometricVerification } from "@/types/geometry";

function measurement(value: number | null, digits = 2) {
  return value === null ? "Not measured" : value.toFixed(digits);
}

export function GeometricVerificationPanel({ result }: { result: GeometricVerification }) {
  const snapshot = result.analyzed_snapshot;
  const [loaded, setLoaded] = useState(false);
  const axis = result.evidence.reference_axis_image;
  return <section className={`geometry-result geometry-${result.geometry_status}`} aria-labelledby="geometry-result-heading">
    <div className="geometry-heading"><h3 id="geometry-result-heading">Geometric Verification</h3><span>{result.geometry_status.replaceAll("_", " ")}</span></div>
    <dl className="geometry-measurements">
      <div><dt>Expected offset</dt><dd>{measurement(result.expected_studs)} studs</dd></div>
      <div><dt>Observed offset</dt><dd>{measurement(result.observed_studs)}{result.observed_studs === null ? "" : " studs"}</dd></div>
      <div><dt>Deviation</dt><dd>{measurement(result.deviation_studs)}{result.deviation_studs === null ? "" : ` studs · ${measurement(result.deviation_mm)} mm`}</dd></div>
      <div><dt>Uncertainty</dt><dd>{measurement(result.uncertainty_studs)}{result.uncertainty_studs === null ? "" : " studs"}</dd></div>
      <div><dt>Calibration</dt><dd>{result.evidence.calibration_valid ? "Valid profile" : "Not established"}</dd></div>
      <div><dt>Perspective</dt><dd>{result.evidence.board_pose_valid ? "Height-aware board pose" : "Not established"}</dd></div>
    </dl>
    <p>{result.guidance}</p>
    {snapshot && result.measurement_status === "measured" && <figure className="geometry-overlay">
      <div className="geometry-image-stage">
        <img src={snapshot.data_url} width={snapshot.width} height={snapshot.height} alt="Exact snapshot used for geometric verification"
          onLoad={(event) => setLoaded(event.currentTarget.naturalWidth === snapshot.width && event.currentTarget.naturalHeight === snapshot.height)}
          onError={() => setLoaded(false)} />
        {loaded && <svg viewBox={`0 0 ${snapshot.width} ${snapshot.height}`} role="img" aria-label="Measured stud centers and signed reference axis">
          {axis && <><defs><marker id="geometry-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" /></marker></defs>
            <line className="geometry-axis" x1={axis.start.x_px} y1={axis.start.y_px} x2={axis.end.x_px} y2={axis.end.y_px} markerEnd="url(#geometry-arrow)" /></>}
          {result.evidence.features.map((feature, index) => <circle key={`${feature.role}-${index}`} className={`geometry-stud geometry-stud-${feature.role}`}
            cx={feature.image.x_px} cy={feature.image.y_px} r={Math.max(3, snapshot.width / 250)}><title>{`${feature.role} stud at board (${feature.board.x_mm.toFixed(1)}, ${feature.board.y_mm.toFixed(1)}, ${feature.board.z_mm.toFixed(1)}) mm`}</title></circle>)}
        </svg>}
      </div>
      <figcaption>Exact analyzed snapshot · green reference studs · blue target studs · arrow shows the configured positive longitudinal direction.</figcaption>
    </figure>}
    {result.limitations.length > 0 && <details><summary>Measurement limits</summary><ul>{result.limitations.map((item) => <li key={item}>{item}</li>)}</ul></details>}
    <p className="muted">This controlled single-view check is not an industrial metrology certificate.</p>
  </section>;
}
