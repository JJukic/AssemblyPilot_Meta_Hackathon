import { Camera, Play, Square } from "lucide-react";
import type { CameraStatus } from "@/types/assembly";

interface Props {
  status: CameraStatus;
  devices: MediaDeviceInfo[];
  deviceId: string;
  onStart: () => void;
  onStop: () => void;
  onCapture: () => void;
  onDeviceChange: (id: string) => void;
}

export function CameraControls(props: Props) {
  const running = props.status === "connected" || props.status === "starting";
  return (
    <div className="camera-controls">
      <label className="source-label">
        <span>Camera source</span>
        <select value={props.deviceId} onChange={(event) => props.onDeviceChange(event.target.value)}>
          <option value="">Default camera</option>
          {props.devices.map((device, index) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `Camera ${index + 1}`}
            </option>
          ))}
        </select>
      </label>
      <div className="control-buttons">
        <button className="button secondary" onClick={running ? props.onStop : props.onStart}>
          {running ? <Square size={15} /> : <Play size={15} />}
          {running ? "Stop camera" : "Start camera"}
        </button>
        <button className="button primary" onClick={props.onCapture} disabled={props.status !== "connected"}>
          <Camera size={16} /> Capture
        </button>
      </div>
    </div>
  );
}
