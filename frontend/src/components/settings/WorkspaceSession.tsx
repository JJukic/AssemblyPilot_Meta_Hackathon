"use client";

import { createContext, useCallback, useContext, useState, type Dispatch, type SetStateAction } from "react";
import { useCamera } from "@/hooks/useCamera";
import type { Snapshot } from "@/types/assembly";
import type { CalibrationProfile, CalibrationStatus, CameraConfiguration, CaptureAssessment, GeometrySetup } from "@/types/calibration";
import type { EdgeDebugResult, EdgeROI } from "@/lib/edge-debug";
import type { InspectionResponse } from "@/types/inspection";
import type { WorkflowState } from "@/types/workflow";

interface CalibrationSettings {
  status: CalibrationStatus | null;
  mode: "calibrate" | "precision";
  profileId: string;
  lens: string;
  notes: string;
  confirmed: boolean;
  measuredWidth: string;
  measuredHeight: string;
  samples: { snapshot: Snapshot; hash: string }[];
  sampleCamera: CameraConfiguration | null;
  assessment: CaptureAssessment | null;
  assessedCamera: CameraConfiguration | null;
  assessedSnapshot: Snapshot | null;
  result: CalibrationProfile | null;
}
interface EdgeSettings {
  enabled: boolean;
  blur: number;
  low: number;
  high: number;
  roi: EdgeROI | null;
  result: EdgeDebugResult | null;
  showEdges: boolean;
}
const calibrationDefaults = (): CalibrationSettings => ({
  status: null, mode: "calibrate", profileId: "", lens: "", notes: "", confirmed: false,
  measuredWidth: "", measuredHeight: "", samples: [], sampleCamera: null,
  assessment: null, assessedCamera: null, assessedSnapshot: null, result: null,
});
const edgeDefaults = (): EdgeSettings => ({ enabled: false, blur: 3, low: 50, high: 150, roi: null, result: null, showEdges: false });
type SettingsState<T> = [T, Dispatch<SetStateAction<T>>];

// Match the original panels' camera/snapshot reset boundaries. Old requests
// cannot update a newer scope, including after a camera stop or source change.
function useScopedSettings<T>(scope: string, defaults: () => T): SettingsState<T> {
  const [stored, setStored] = useState(() => ({ scope, values: defaults() }));
  if (stored.scope !== scope) setStored({ scope, values: defaults() });
  const update = useCallback<Dispatch<SetStateAction<T>>>((value) => {
    setStored((previous) => previous.scope !== scope ? previous : {
      scope,
      values: typeof value === "function" ? (value as (previous: T) => T)(previous.values) : value,
    });
  }, [scope]);
  return [stored.scope === scope ? stored.values : defaults(), update];
}

export interface InspectionDraft {
  boundary: string;
  phase: WorkflowState;
  result: InspectionResponse | null;
  fresh: Snapshot | null;
  error: string | null;
}
interface WorkspaceSession {
  camera: ReturnType<typeof useCamera>;
  calibration: SettingsState<CalibrationSettings>;
  edge: SettingsState<EdgeSettings>;
  geometrySetup: GeometrySetup | null;
  selectedProject: string | null;
  setSelectedProject: Dispatch<SetStateAction<string | null>>;
  viewedStep: { projectId: string; index: number } | null;
  setViewedStep: Dispatch<SetStateAction<{ projectId: string; index: number } | null>>;
  inspectionDraft: InspectionDraft | null;
  setInspectionDraft: Dispatch<SetStateAction<InspectionDraft | null>>;
}
const Context = createContext<WorkspaceSession | null>(null);

// Shared only by / and /settings. Navigation preserves the live stream and
// in-memory settings; leaving for AR releases the camera as before. Photos and
// confirmation are never written to browser storage. Profiles remain backend-owned.
export function WorkspaceSessionProvider({ children }: { children: React.ReactNode }) {
  const camera = useCamera();
  const calibration = useScopedSettings(`${camera.deviceId}:${camera.status}`, calibrationDefaults);
  const edge = useScopedSettings(`${camera.deviceId}:${camera.snapshot?.capturedAt ?? "none"}`, edgeDefaults);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [viewedStep, setViewedStep] = useState<{ projectId: string; index: number } | null>(null);
  const [inspectionDraft, setInspectionDraft] = useState<InspectionDraft | null>(null);
  const { status, profileId, confirmed } = calibration[0];
  const profile = status?.profiles.find((item) => item.id === profileId);
  const geometrySetup: GeometrySetup | null = profile && confirmed ? {
    profile_id: profile.id, camera: profile.camera, configuration_confirmed: true,
  } : null;
  return <Context.Provider value={{ camera, calibration, edge, geometrySetup, selectedProject, setSelectedProject, viewedStep, setViewedStep, inspectionDraft, setInspectionDraft }}>{children}</Context.Provider>;
}

export function useWorkspaceSession() {
  const session = useContext(Context);
  if (!session) throw new Error("Workspace session provider is required");
  return session;
}
function useField<T, K extends keyof T>(state: SettingsState<T>, field: K): [T[K], Dispatch<SetStateAction<T[K]>>] {
  const [values, update] = state;
  const setValue = useCallback<Dispatch<SetStateAction<T[K]>>>((value) => {
    update((previous) => ({ ...previous, [field]: typeof value === "function" ? (value as (previous: T[K]) => T[K])(previous[field]) : value }));
  }, [field, update]);
  return [values[field], setValue];
}
export function useCalibrationSetting<K extends keyof CalibrationSettings>(field: K) {
  return useField(useWorkspaceSession().calibration, field);
}
export function useEdgeSetting<K extends keyof EdgeSettings>(field: K) {
  return useField(useWorkspaceSession().edge, field);
}
