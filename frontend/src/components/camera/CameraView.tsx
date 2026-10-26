/* Native img preserves browser-local captures without sending them to image optimization. */
/* eslint-disable @next/next/no-img-element */
import { Aperture, Focus, ImageIcon, ScanLine, ShieldCheck } from "lucide-react";
import { CameraControls } from "./CameraControls";
import type { useCamera } from "@/hooks/useCamera";

type Camera = ReturnType<typeof useCamera>;

export function CameraView({ camera }: { camera: Camera }) {
  const { videoRef, status, error, devices, deviceId, snapshot, start, stop, capture, selectDevice } = camera;
  return (
    <section className="panel camera-panel" aria-labelledby="workspace-heading">
      <div className="panel-heading">
        <div className="heading-with-icon"><ScanLine size={19} /><h2 id="workspace-heading">Observation workspace</h2></div>
        <span className={`live-badge ${status === "connected" ? "is-live" : ""}`}>
          <span className="status-dot" /> {status === "connected" ? "LIVE" : "STANDBY"}
        </span>
      </div>
      <div className="camera-grid">
        <div className="feed-block">
          <div className="frame-label"><span>01 / LIVE FEED</span><Focus size={14} /></div>
          <div className="video-frame">
            <video ref={videoRef} autoPlay muted playsInline aria-label="Live camera preview" />
            {status !== "connected" && (
              <div className="frame-placeholder">
                <div className="placeholder-icon"><Aperture size={32} strokeWidth={1.3} /></div>
                <h3>{status === "starting" ? "Connecting camera…" : "Your build starts here"}</h3>
                <p>{status === "starting" ? "Allow camera access when your browser asks." : "Start your camera and place your LEGO build in view."}</p>
              </div>
            )}
            <div className="frame-corners" aria-hidden="true" />
          </div>
          <p className="frame-caption">Keep your workspace well lit and the model in focus.</p>
        </div>
        <div className="feed-block">
          <div className="frame-label"><span>02 / LATEST CAPTURE</span><ImageIcon size={14} /></div>
          <div className="snapshot-frame">
            {snapshot ? (
              <img src={snapshot.dataUrl} alt="Latest captured LEGO assembly" width={snapshot.width} height={snapshot.height} />
            ) : (
              <div className="frame-placeholder">
                <ImageIcon size={27} strokeWidth={1.3} />
                <h3>No capture yet</h3>
                <p>Capture a frame to take a closer look at your assembly.</p>
              </div>
            )}
          </div>
          <p className="frame-caption" aria-live="polite">
            {snapshot ? `${snapshot.width} × ${snapshot.height} px · JPEG · ${new Date(snapshot.capturedAt).toLocaleTimeString()}` : "Your latest snapshot will appear here."}
          </p>
        </div>
      </div>
      {error && <p className="error-banner" role="alert">{error}</p>}
      <CameraControls
        status={status} devices={devices} deviceId={deviceId}
        onStart={() => void start(deviceId)} onStop={stop}
        onCapture={capture} onDeviceChange={selectDevice}
      />
      <div className="privacy-note"><ShieldCheck size={14} /> Camera frames stay in this browser. Nothing is uploaded automatically.</div>
    </section>
  );
}
