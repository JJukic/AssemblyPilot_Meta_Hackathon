"use client";
/* eslint-disable @next/next/no-img-element -- exact, native-resolution capture and edge image */
import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "@/types/assembly";
import { errorMessage } from "@/lib/api";
import { detectEdges, type EdgeDebugResult, type EdgeROI } from "@/lib/edge-debug";
import { ContourPaths, emptyContours } from "./ContourOverlay";

export function EdgeDebugPanel({ snapshot }: { snapshot: Snapshot | null }) {
  const [enabled, setEnabled] = useState(false);
  const [blur, setBlur] = useState(3);
  const [low, setLow] = useState(50);
  const [high, setHigh] = useState(150);
  const [roi, setROI] = useState<EdgeROI | null>(null);
  const [draft, setDraft] = useState<EdgeROI | null>(null);
  const [result, setResult] = useState<EdgeDebugResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showEdges, setShowEdges] = useState(false);
  const [imageReady, setImageReady] = useState(false);
  const [edgeReady, setEdgeReady] = useState("");
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const origin = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => () => { request.current?.abort(); generation.current++; }, []);
  function invalidate() {
    request.current?.abort(); generation.current++; origin.current = null; setDraft(null);
    setResult(null); setEdgeReady(""); setBusy(false); setError("");
  }
  function point(event: React.PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(snapshot!.width, (event.clientX - box.left) / box.width * snapshot!.width)),
      y: Math.max(0, Math.min(snapshot!.height, (event.clientY - box.top) / box.height * snapshot!.height)) };
  }
  function rectangle(a: { x: number; y: number }, b: { x: number; y: number }): EdgeROI {
    const left = Math.floor(Math.min(a.x, b.x)), top = Math.floor(Math.min(a.y, b.y));
    return { left, top, width: Math.ceil(Math.max(a.x, b.x)) - left, height: Math.ceil(Math.max(a.y, b.y)) - top };
  }
  async function run(event: React.FormEvent) {
    event.preventDefault();
    if (!snapshot) return;
    invalidate();
    if (low >= high) { setError("Low threshold must be smaller than high threshold."); return; }
    const controller = new AbortController(); request.current = controller;
    const current = generation.current; setBusy(true);
    try {
      const response = await detectEdges(snapshot, { blur_kernel: blur, low_threshold: low, high_threshold: high, roi }, controller.signal);
      if (!controller.signal.aborted && current === generation.current) setResult(response);
    } catch (cause) {
      if (!controller.signal.aborted && current === generation.current) setError(errorMessage(cause));
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  const selection = draft ?? roi;
  const overlayReady = imageReady && result && edgeReady === result.edge_image;
  return <section className="panel edge-debug-panel" aria-label="Edge Detection Debug Mode">
    <h2>Edge Detection Debug Mode</h2>
    <p>Explore raw OpenCV edges without AI inspection. This never changes assembly verdicts or verified progress.</p>
    <label><input type="checkbox" checked={enabled} onChange={(event) => { invalidate(); setEnabled(event.target.checked); }} /> Enable edge debug mode</label>
    {!snapshot && <p>Capture a camera snapshot first.</p>}
    {enabled && snapshot && <>
      <form className="edge-settings" onSubmit={run}>
        <label className="field">Gaussian blur<select value={blur} onChange={(event) => { invalidate(); setBlur(Number(event.target.value)); }}>
          {Array.from({ length: 11 }, (_, i) => 2 * i + 1).map((kernel) => <option key={kernel} value={kernel}>{kernel === 1 ? "1 (no blur)" : `${kernel} × ${kernel}`}</option>)}
        </select></label>
        <label className="field">Low Canny threshold<input type="number" min={0} max={254} step={1} required value={low}
          onChange={(event) => { invalidate(); setLow(Number(event.target.value)); }} /></label>
        <label className="field">High Canny threshold<input type="number" min={1} max={255} step={1} required value={high}
          onChange={(event) => { invalidate(); setHigh(Number(event.target.value)); }} /></label>
        <button className="button primary" disabled={busy || !imageReady} type="submit">{busy ? "Detecting edges…" : "Detect edges"}</button>
      </form>
      <p>Drag a rectangle on the original snapshot to select an ROI. With no selection, the complete image is analyzed.</p>
      <button type="button" className="button secondary" onClick={() => { invalidate(); setROI(null); setDraft(null); }}>Use full image</button>
      <details><summary>ROI pixel coordinates (keyboard selection)</summary><div className="edge-settings">
        {(["left", "top", "width", "height"] as const).map((key) => <label className="field" key={key}>ROI {key}<input type="number" step={1}
          min={key === "width" || key === "height" ? 2 : 0} max={key === "left" || key === "width" ? snapshot.width : snapshot.height}
          value={(roi ?? { left: 0, top: 0, width: snapshot.width, height: snapshot.height })[key]}
          onChange={(event) => { invalidate(); setROI({ ...(roi ?? { left: 0, top: 0, width: snapshot.width, height: snapshot.height }), [key]: Number(event.target.value) }); }} /></label>)}
      </div></details>
      <p role="status">{roi ? `ROI: ${roi.left}, ${roi.top} · ${roi.width} × ${roi.height} px` : `Full image: ${snapshot.width} × ${snapshot.height} px`}</p>
      <label><input type="checkbox" checked={showEdges} disabled={!result || result.contours.status !== "available"}
        onChange={(event) => setShowEdges(event.target.checked)} /> Raw Canny edges overlay</label>
      <p className="muted">Amber dashed lines are raw edges, not verified matches. SAM Outline and Reference Match have separate controls on their evidence snapshots in the inspection panels.</p>
      <div className="edge-comparison">
        <figure><figcaption>Original captured snapshot · drag to select ROI</figcaption>
          <div className="edge-image-stage" aria-label="Edge ROI selection" onPointerDown={(event) => {
            if (event.button !== 0 || !imageReady) return;
            invalidate(); origin.current = point(event); setDraft(null); event.currentTarget.setPointerCapture(event.pointerId);
          }} onPointerMove={(event) => { if (origin.current) setDraft(rectangle(origin.current, point(event))); }}
          onPointerCancel={() => { origin.current = null; setDraft(null); }} onPointerUp={(event) => {
            if (!origin.current) return;
            const area = rectangle(origin.current, point(event)); origin.current = null; setDraft(null);
            if (area.width >= 2 && area.height >= 2) setROI(area);
            else setError("Drag a rectangle at least 2 × 2 pixels, or use full image.");
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}>
            <img src={snapshot.dataUrl} width={snapshot.width} height={snapshot.height} alt="Original edge debug snapshot" draggable={false}
              onLoad={(event) => { const valid = event.currentTarget.naturalWidth === snapshot.width && event.currentTarget.naturalHeight === snapshot.height;
                setImageReady(valid); if (!valid) setError("Snapshot dimensions do not match. Capture again."); }}
              onError={() => { setImageReady(false); setError("The captured snapshot could not be loaded."); }} />
            {overlayReady && <ContourPaths layers={[result.contours]} enabled={{ ...emptyContours, canny_edges: showEdges }} width={snapshot.width} height={snapshot.height} />}
            {imageReady && selection && <svg viewBox={`0 0 ${snapshot.width} ${snapshot.height}`} aria-label="Selected edge ROI">
              <rect x={selection.left} y={selection.top} width={selection.width} height={selection.height} fill="none" stroke="#69d5ff" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            </svg>}
          </div>
        </figure>
        <figure><figcaption>Detected edge image · raw pixels</figcaption>
          {result ? <img className="edge-bitmap" src={result.edge_image} width={snapshot.width} height={snapshot.height} alt="Detected Canny edge image"
            onLoad={(event) => { const valid = event.currentTarget.naturalWidth === snapshot.width && event.currentTarget.naturalHeight === snapshot.height;
              setEdgeReady(valid ? result.edge_image : ""); if (!valid) setError("Edge image dimensions disagree. Overlay hidden."); }}
            onError={() => { setEdgeReady(""); setError("The edge image could not be decoded. Retry extraction."); }} /> : <p className="empty-state">Choose settings and select Detect edges. No AI diagnosis is needed.</p>}
        </figure>
      </div>
      {result && <p>{result.edge_pixel_count} edge pixels · {result.processing_ms.toFixed(0)} ms. Overlay traces are simplified; the edge image retains every detected pixel.</p>}
      {result?.contours.status === "unavailable" && <p>{result.contours.message}</p>}
      {busy && <p role="status">Extracting edges locally on the backend…</p>}
      {error && <p role="alert" className="form-error">{error}</p>}
    </>}
  </section>;
}
