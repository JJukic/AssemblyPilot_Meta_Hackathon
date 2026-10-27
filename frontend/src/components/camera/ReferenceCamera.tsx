/* eslint-disable @next/next/no-img-element -- Captures stay browser-local until explicitly saved. */
"use client";

import { useState } from "react";
import { CameraControls } from "./CameraControls";
import { useCamera } from "@/hooks/useCamera";
import { snapshotFile } from "@/lib/camera-image";
import { errorMessage } from "@/lib/api";

export function ReferenceCamera({ busy, onSave, onClose }: {
  busy: boolean; onSave: (file: File) => Promise<boolean>; onClose: () => void;
}) {
  const { videoRef, status, devices, deviceId, snapshot, start, stop, capture, selectDevice, error: cameraError } = useCamera();
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!snapshot || busy) return;
    setError(null);
    try {
      const file = snapshotFile(snapshot, `camera-reference-${Date.now()}.jpg`);
      if (await onSave(file)) {
        stop();
        onClose();
      }
    } catch (cause) { setError(errorMessage(cause)); }
  }

  return <section className="reference-camera" aria-label="Reference camera">
    <p className="muted">Place the individual block or the correct assembly step in view. Capture a photo, check it, then save it as a reference.</p>
    <fieldset disabled={busy}>
      <div className="video-frame">
        <video ref={videoRef} autoPlay muted playsInline aria-label="Reference camera preview" />
      </div>
      <CameraControls status={status} devices={devices} deviceId={deviceId}
        onStart={() => void start(deviceId)} onStop={stop}
        onCapture={capture} onDeviceChange={selectDevice} />
      {snapshot && <figure className="reference-capture-preview">
        <img src={snapshot.dataUrl} alt="Reference photo preview" width={snapshot.width} height={snapshot.height} />
        <figcaption>{snapshot.width} × {snapshot.height} px · JPEG · Not saved yet</figcaption>
      </figure>}
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onClose}>Cancel camera</button>
        <button type="button" className="button primary" disabled={!snapshot || busy} onClick={() => void save()}>
          {busy ? "Saving photo…" : "Save as reference"}
        </button>
      </div>
    </fieldset>
    {(cameraError || error) && <p className="form-error" role="alert">{cameraError || error}</p>}
    <p className="muted">The photo is uploaded only when you choose Save as reference.</p>
  </section>;
}
