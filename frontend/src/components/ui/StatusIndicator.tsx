import type { CameraStatus, ConnectionStatus } from "@/types/assembly";

export function StatusIndicator({ label, status }: {
  label: string;
  status: ConnectionStatus | CameraStatus;
}) {
  const text = status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span className={`status status-${status}`} role="status" aria-label={`${label}: ${text}`}>
      <span className="status-dot" aria-hidden="true" />
      <span>{label}<span className="status-separator"> / </span><strong>{text}</strong></span>
    </span>
  );
}
