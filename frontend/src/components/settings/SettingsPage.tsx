"use client";

import { CalibrationPanel } from "@/components/calibration/CalibrationPanel";
import { CameraView } from "@/components/camera/CameraView";
import { EdgeDebugPanel } from "@/components/inspection/EdgeDebugPanel";
import { ManagementLayout } from "@/components/ui/ManagementLayout";
import { StatusIndicator } from "@/components/ui/StatusIndicator";
import { useWorkspaceSession } from "./WorkspaceSession";

export function SettingsPage() {
  const { camera, geometrySetup } = useWorkspaceSession();
  return <ManagementLayout active="settings" title="Settings" description="Configure camera calibration and technical debugging for your workspace.">
    <section aria-labelledby="camera-settings-heading">
      <h2 id="camera-settings-heading">Camera</h2>
      <p className="muted">Use the same camera as your workspace. Start it to collect calibration samples or assess a precision capture. Saved profiles are loaded from the backend.</p>
      <StatusIndicator label="Camera" status={camera.status} />
      <p role="status">Calibrated geometry: {geometrySetup ? "Enabled — confirmed profile selected" : "Disabled — select and confirm a profile in Precision Capture"}</p>
      <CameraView camera={camera} />
      <CalibrationPanel key={`${camera.deviceId}:${camera.status}`} camera={camera} />
    </section>
    <section aria-labelledby="debugging-settings-heading">
      <h2 id="debugging-settings-heading">Debugging</h2>
      <p className="muted">Analyze a captured frame with OpenCV. Edge debugging is optional and does not change AI verdicts or project progress.</p>
      <EdgeDebugPanel key={`${camera.deviceId}:${camera.snapshot?.capturedAt ?? "none"}`} snapshot={camera.snapshot} />
    </section>
  </ManagementLayout>;
}
