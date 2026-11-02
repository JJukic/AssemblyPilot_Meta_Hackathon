import { apiRequest } from "../api";
export interface Placement {
  target_block_id: string;
  instance: number;
  origin: "tabletop_session";
  method: "manual_authoring";
  evidence: "measured" | "approximate";
  confirmed: true;
  dimensions: { x_mm: number; y_mm: number; z_mm: number };
  studs: {
    x: number;
    z: number;
    pitch_mm: number;
    diameter_mm: number;
    height_mm: number;
  } | null;
  position_m: number[];
  rotation_deg: number[];
}
export interface ViewedStep {
  step_id: string | null;
  revision: number;
}
export const placementPath = (project: string, step: string) =>
  `/api/projects/${project}/steps/${step}/ar-placement`;
export const getPlacement = (project: string, step: string) =>
  apiRequest<Placement | null>(placementPath(project, step));
/** Version-2 step hologram: every block placed IN this step (Y = bottom face, metres). */
export interface StepPlacements {
  version: 2;
  placements: Placement[];
}
/** Cumulative guidance up to a step (earlier steps = already assembled). Never evidence. */
export interface SceneBlock {
  step_id: string;
  step_position: number;
  placement: Placement;
}
export interface Scene {
  blocks: SceneBlock[];
  excluded: { step_id: string; step_position: number; reason: string }[];
}
export const placementsPath = (project: string, step: string) =>
  `/api/projects/${project}/steps/${step}/ar-placements`;
export const getPlacements = (project: string, step: string) =>
  apiRequest<StepPlacements>(placementsPath(project, step));
export const savePlacements = (project: string, step: string, placements: Placement[]) =>
  apiRequest<StepPlacements>(placementsPath(project, step), {
    method: "PUT",
    body: JSON.stringify({ version: 2, placements }),
  });
export const getScene = (project: string, step: string) =>
  apiRequest<Scene>(`/api/projects/${project}/steps/${step}/ar-scene`);
export const getView = (project: string) =>
  apiRequest<ViewedStep>(`/api/projects/${project}/ar-view`);
export const setView = (project: string, step: string, revision: number) =>
  apiRequest<ViewedStep>(`/api/projects/${project}/ar-view`, {
    method: "PUT",
    body: JSON.stringify({ step_id: step, revision }),
  });
export function validPlacement(p: Placement): boolean {
  if (
    !p ||
    p.origin !== "tabletop_session" ||
    p.method !== "manual_authoring" ||
    p.confirmed !== true ||
    !["measured", "approximate"].includes(p.evidence) ||
    !Number.isInteger(p.instance) ||
    p.instance < 1 ||
    p.instance > 1000
  )
    return false;
  const d = p.dimensions;
  if (
    !d ||
    ![d.x_mm, d.y_mm, d.z_mm].every(
      (n) => Number.isFinite(n) && n > 0 && n <= 1000,
    )
  )
    return false;
  if (
    !Array.isArray(p.position_m) ||
    p.position_m.length !== 3 ||
    !p.position_m.every((n) => Number.isFinite(n) && Math.abs(n) <= 2) ||
    !Array.isArray(p.rotation_deg) ||
    p.rotation_deg.length !== 3 ||
    !p.rotation_deg.every((n) => Number.isFinite(n) && Math.abs(n) <= 180)
  )
    return false;
  const s = p.studs;
  return (
    s === null ||
    (!!s &&
      p.evidence === "measured" &&
      [s.x, s.z].every((n) => Number.isInteger(n) && n >= 1 && n <= 20) &&
      [s.pitch_mm, s.diameter_mm, s.height_mm].every(
        (n) => Number.isFinite(n) && n > 0 && n <= 100,
      ) &&
      s.diameter_mm <= s.pitch_mm &&
      (s.x - 1) * s.pitch_mm + s.diameter_mm <= d.x_mm &&
      (s.z - 1) * s.pitch_mm + s.diameter_mm <= d.z_mm)
  );
}
export async function capabilities(): Promise<{
  available: boolean;
  message: string;
}> {
  if (!window.isSecureContext)
    return {
      available: false,
      message:
        "HTTPS with a trusted certificate is required. This is not a secure context.",
    };
  if (!navigator.xr)
    return {
      available: false,
      message:
        "This browser exposes no WebXR API. Only the labelled 2D preview is available.",
    };
  try {
    const available = await navigator.xr.isSessionSupported("immersive-ar");
    return {
      available,
      message: available
        ? "Browser reports immersive-ar support. Device alignment is not yet validated."
        : "immersive-ar is unavailable. Use 2D preview or a native OpenXR client.",
    };
  } catch {
    return {
      available: false,
      message:
        "XR capability check failed. Check device permissions and HTTPS.",
    };
  }
}
