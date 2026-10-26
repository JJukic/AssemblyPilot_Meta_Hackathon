export interface AssemblyPart {
  type: string;
  color: string;
  count: number;
}

export interface AssemblyStep {
  id: number;
  title: string;
  instruction: string;
  expected_parts: AssemblyPart[];
  reference_image: string | null;
}

export interface Assembly {
  id: string;
  name: string;
  description: string;
  steps: AssemblyStep[];
}

export type ConnectionStatus = "checking" | "connected" | "disconnected";
export type CameraStatus = "stopped" | "starting" | "connected" | "error";

export interface Snapshot {
  dataUrl: string;
  width: number;
  height: number;
  capturedAt: string;
}
