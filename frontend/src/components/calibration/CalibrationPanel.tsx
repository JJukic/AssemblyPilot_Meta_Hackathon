"use client";

import { useEffect, useRef, useState } from "react";
import type { useCamera } from "@/hooks/useCamera";
import { apiRequest, errorMessage } from "@/lib/api";
import { snapshotFile } from "@/lib/camera-image";
import { assessCapture, downloadBoard } from "@/lib/calibration";
import type { CalibrationProfile, CalibrationStatus, CameraConfiguration, CaptureAssessment } from "@/types/calibration";
import type { Snapshot } from "@/types/assembly";

type Sample = { snapshot: Snapshot; hash: string };
export function CalibrationPanel({ camera }: { camera: ReturnType<typeof useCamera> }) {
  const [status, setStatus] = useState<CalibrationStatus | null>(null);
  const [mode, setMode] = useState<"calibrate" | "precision">("calibrate");
  const [profileId, setProfileId] = useState("");
  const [lens, setLens] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [measuredWidth, setMeasuredWidth] = useState("");
  const [measuredHeight, setMeasuredHeight] = useState("");
  const [samples, setSamples] = useState<Sample[]>([]);
  const [sampleCamera, setSampleCamera] = useState<CameraConfiguration | null>(null);
  const [assessment, setAssessment] = useState<CaptureAssessment | null>(null);
  const [assessedCamera, setAssessedCamera] = useState<CameraConfiguration | null>(null);
  const [assessedSnapshot, setAssessedSnapshot] = useState<Snapshot | null>(null);
  const [result, setResult] = useState<CalibrationProfile | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const abort = new AbortController(); controller.current = abort;
    apiRequest<CalibrationStatus>("/api/calibration/status", { signal: abort.signal })
      .then(setStatus).catch((e) => { if (!abort.signal.aborted) setError(errorMessage(e)); });
    return () => abort.abort();
  }, []);
  const signal = () => AbortSignal.any([controller.current!.signal, AbortSignal.timeout(120000)]);
  function resetEvidence() {
    setSamples([]); setSampleCamera(null); setAssessment(null); setAssessedSnapshot(null);
    setResult(null); setConfirmed(false); setMessage("");
  }
  function configuration(snapshot: Snapshot): CameraConfiguration {
    const current = camera.getConfiguration();
    if (!current || !lens.trim() || !notes.trim()) throw new Error("Enter a lens label and focus/zoom/crop configuration.");
    return { device_label: current.label, lens: lens.trim(),
      configuration: JSON.stringify({ notes: notes.trim(), settings: current.settings }),
      width: snapshot.width, height: snapshot.height };
  }
  async function capture() {
    setError(""); setMessage(""); setBusy(true); setAssessment(null); setAssessedSnapshot(null);
    try {
      const snapshot = camera.capture(false);
      if (!snapshot) throw new Error("Start the camera and wait for a live frame.");
      const config = configuration(snapshot);
      if (mode === "calibrate" && sampleCamera && JSON.stringify(config) !== JSON.stringify(sampleCamera)) throw new Error("Camera configuration changed. Clear samples and recalibrate.");
      const body = new FormData();
      body.append("image", snapshotFile(snapshot, "charuco.jpg"));
      body.append("camera", JSON.stringify(config));
      if (mode === "precision" && profileId) body.append("profile_id", profileId);
      body.append("configuration_confirmed", String(confirmed));
      const response = await assessCapture(body, signal());
      if (controller.current?.signal.aborted) return;
      if (response.width !== snapshot.width || response.height !== snapshot.height) throw new Error("Geometry analysis changed image dimensions.");
      setAssessment(response); setAssessedSnapshot(snapshot); setAssessedCamera(config);
      if (mode === "calibrate") {
        if (!response.sample_acceptable) { setMessage("Sample rejected. Follow the guidance and capture again."); return; }
        if (samples.some((sample) => sample.hash === response.snapshot_sha256)) { setMessage("Sample rejected: duplicate image. Move or tilt the board."); return; }
        const total = samples.reduce((n, s) => n + s.snapshot.dataUrl.length * .75, snapshot.dataUrl.length * .75);
        if (total > 64 * 1024 * 1024) throw new Error("Samples exceed 64 MiB. Use a lower camera resolution and start again.");
        setSamples((old) => [...old, { snapshot, hash: response.snapshot_sha256 }]); setSampleCamera(config);
        setMessage("Sample accepted provisionally. Batch calibration also checks view diversity.");
      }
    } catch (e) { if (!controller.current?.signal.aborted) setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  async function runCalibration() {
    if (!sampleCamera) return;
    setBusy(true); setError(""); setResult(null);
    try {
      const body = new FormData();
      for (const sample of samples) body.append("images", snapshotFile(sample.snapshot, "calibration.jpg"));
      body.append("camera", JSON.stringify(sampleCamera)); body.append("configuration_confirmed", String(confirmed));
      body.append("measured_width_mm", measuredWidth); body.append("measured_height_mm", measuredHeight);
      const profile = await apiRequest<CalibrationProfile>("/api/calibration/calibrate", { method: "POST", body, signal: signal() });
      if (controller.current?.signal.aborted) return;
      setResult(profile); setProfileId(profile.id);
      setStatus((old) => old ? { ...old, profiles: [...old.profiles, profile] } : old);
      setMessage("Calibration profile saved. Photographs were not stored on the backend.");
    } catch (e) { if (!controller.current?.signal.aborted) setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  function selectProfile(id: string) {
    resetEvidence(); setProfileId(id);
    const profile = status?.profiles.find((p) => p.id === id);
    if (profile) {
      setLens(profile.camera.lens);
      try { setNotes(JSON.parse(profile.camera.configuration).notes ?? ""); } catch { setNotes(""); }
    }
  }
  return <details className="panel calibration-panel">
    <summary>Camera Calibration &amp; Precision Capture</summary>
    <p>Deterministic board detection and camera guidance. LEGO dimensions and placement are <strong>not measured</strong>. AI results, including “Step Verified”, remain semantic assessments.</p>
    <div className="calibration-toolbar">
      <button className="button secondary" disabled={busy} onClick={() => { resetEvidence(); setMode("calibrate"); }}>Camera Calibration</button>
      <button className="button secondary" disabled={busy} onClick={() => { resetEvidence(); setMode("precision"); }}>Precision Capture</button>
    </div>
    <h2>{mode === "calibrate" ? "Camera Calibration" : "Precision Capture"}</h2>
    <p>Select a camera using the workspace controls. Keep its lens, resolution, focus, zoom, crop and stabilization unchanged. Continuity Camera may change these without exposing them to the browser. Recalibrate after any change; device labels alone cannot establish compatibility.</p>
    {mode === "calibrate" ? <>
      <p>Print the 7 × 5 board at <strong>100% / actual size</strong>, disable fit-to-page, keep a white margin and mount flat. The pattern must measure 140 × 100 mm (20 mm squares, 15 mm markers, DICT_4X4_50). Measure both outer pattern edges before use.</p>
      <button className="button secondary" onClick={() => void downloadBoard().catch((e) => setError(errorMessage(e)))}>Download printable board PDF</button>
      <p>Capture 12–20 sharp images: move the board around the image, include edges, change distance, rotate and tilt moderately in different directions.</p>
    </> : <label className="field"><span>Calibration profile</span><select value={profileId} disabled={busy} onChange={(e) => selectProfile(e.target.value)}>
      <option value="">No calibration — detection only</option>
      {status?.profiles.map((p) => <option key={p.id} value={p.id}>{p.camera.device_label} · {p.camera.width} × {p.camera.height} · {new Date(p.created_at).toLocaleString()}</option>)}
    </select></label>}
    <div className="calibration-fields">
      <label className="field"><span>Lens identification</span><input disabled={busy || samples.length > 0} value={lens} onChange={(e) => { resetEvidence(); setLens(e.target.value); }} placeholder="e.g. iPhone rear main; browser identity unknown" maxLength={200} /></label>
      <label className="field"><span>Focus / zoom / crop / stabilization configuration</span><input disabled={busy || samples.length > 0} value={notes} onChange={(e) => { resetEvidence(); setNotes(e.target.value); }} placeholder="Record your fixed setup; do not assume defaults" maxLength={200} /></label>
      {mode === "calibrate" && <>
        <label className="field"><span>Measured pattern width (mm)</span><input type="number" step=".1" disabled={busy} value={measuredWidth} onChange={(e) => setMeasuredWidth(e.target.value)} /></label>
        <label className="field"><span>Measured pattern height (mm)</span><input type="number" step=".1" disabled={busy} value={measuredHeight} onChange={(e) => setMeasuredHeight(e.target.value)} /></label>
      </>}
    </div>
    <label className="calibration-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(e) => { setConfirmed(e.target.checked); setAssessment(null); setAssessedSnapshot(null); }} /> I confirm the camera configuration is unchanged across these samples / matches the selected profile. Hidden camera changes still require recalibration.</label>
    <div className="calibration-toolbar">
      <button className="button primary" disabled={busy || camera.status !== "connected" || !lens.trim() || !notes.trim() || (mode === "calibrate" && samples.length >= 20)} onClick={() => void capture()}>{busy ? "Processing camera evidence…" : mode === "calibrate" ? "Capture calibration sample" : "Capture & assess perspective"}</button>
      {mode === "calibrate" && <>
        <button className="button primary" disabled={busy || samples.length < 12 || !confirmed || !measuredWidth || !measuredHeight} onClick={() => void runCalibration()}>Calibrate &amp; save profile</button>
        <button className="button secondary" disabled={busy || !samples.length} onClick={resetEvidence}>Clear samples</button>
      </>}
    </div>
    {mode === "calibrate" && <><p>{samples.length} / 20 samples accepted provisionally (minimum 12).</p><ol className="calibration-samples">{samples.map((sample, i) => <li key={sample.hash}>Sample {i + 1} <button className="text-button" disabled={busy} onClick={() => setSamples((old) => old.filter((_, index) => index !== i))}>Remove sample {i + 1}</button></li>)}</ol></>}
    {error && <p className="error-banner" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {result && <div role="status"><h3>Calibration saved</h3><p>{result.accepted_views} views · {result.camera.width} × {result.camera.height} px · RMS {result.reprojection_rms_px.toFixed(2)} px (reprojection error, not physical accuracy).</p><p>Profile: {result.id}</p></div>}
    {assessment && <div className="capture-assessment">
      <p>Calibration: {assessment.calibration_status} · Board: {assessment.board_status} · {assessment.marker_count} markers · {assessment.corner_count} corners · {Math.round(assessment.board_visibility * 100)}% corner visibility</p>
      <p>Sharpness score: {assessment.sharpness.toFixed(0)} (image-dependent heuristic){assessment.pose && ` · Approximate viewing angle: ${assessment.pose.viewing_angle_degrees.toFixed(0)}° · Residual: ${assessment.pose.reprojection_rms_px.toFixed(2)} px`}</p>
      <ul>{assessment.guidance.map((text, i) => <li key={i}>{text}</li>)}</ul>
      <div className="calibration-snapshot">
        {/* eslint-disable-next-line @next/next/no-img-element -- exact in-memory analyzed snapshot */}
        <img src={assessment.analyzed_snapshot} width={assessment.width} height={assessment.height} alt="Exact snapshot analyzed for ChArUco corners" />
        <svg viewBox={`0 0 ${assessment.width} ${assessment.height}`} role="img" aria-label="Detected ChArUco corners on analyzed snapshot">
          {assessment.corners.map((p) => <circle key={p.id} cx={p.x_px} cy={p.y_px} r={Math.max(3, assessment.width / 200)} fill="#37e3a6" stroke="black" strokeWidth={Math.max(1, assessment.width / 1000)} />)}
        </svg>
      </div>
      {mode === "precision" && assessedSnapshot && <><p>{assessment.suitable_for_top_down_capture ? "Capture guidance passed." : "Precision guidance did not pass. You may still request a semantic AI inspection."} No geometric pass/fail is available.</p>
        <button className="button primary" onClick={() => { try {
          if (JSON.stringify(configuration(assessedSnapshot)) !== JSON.stringify(assessedCamera)) throw new Error("Camera configuration changed. Assess a fresh capture.");
          camera.publishSnapshot(assessedSnapshot); setMessage("Capture selected. Choose Inspect with Meta AI for your project and step; no AI request was sent yet."); } catch (e) { setError(errorMessage(e)); } }}>Use this capture for AI inspection</button></>}
    </div>}
    {status && <p className="muted">OpenCV {status.opencv_version} · Board {status.board_id} · {status.profiles.length} saved profiles{status.invalid_profile_count > 0 && ` · ${status.invalid_profile_count} invalid profiles ignored; recalibrate`}</p>}
  </details>;
}
