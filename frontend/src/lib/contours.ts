export type ContourKind = "sam_outline" | "canny_edges" | "reference_match";
export interface ContourLayer {
  kind: ContourKind;
  status: "available" | "unavailable";
  message: string;
  snapshot_id: string;
  width: number;
  height: number;
  paths: { points: [number, number][]; closed: boolean }[];
}

export function validContour(value: unknown, identity: { snapshot_id: string; width: number; height: number }): value is ContourLayer {
  if (!value || typeof value !== "object") return false;
  const layer = value as ContourLayer;
  if (!["sam_outline", "canny_edges", "reference_match"].includes(layer.kind) ||
      !["available", "unavailable"].includes(layer.status) || typeof layer.message !== "string" ||
      !layer.message.length || layer.message.length > 500 || layer.snapshot_id !== identity.snapshot_id ||
      !/^[a-f0-9]{64}$/.test(layer.snapshot_id) || layer.width !== identity.width || layer.height !== identity.height ||
      !Number.isInteger(layer.width) || !Number.isInteger(layer.height) || layer.width <= 0 || layer.height <= 0 ||
      layer.width > 8192 || layer.height > 8192 || !Array.isArray(layer.paths) || layer.paths.length > 64 ||
      (layer.status === "available") !== (layer.paths.length > 0)) return false;
  let total = 0;
  return layer.paths.every((path) => {
    if (!path || typeof path.closed !== "boolean" || !Array.isArray(path.points) ||
        path.points.length < (path.closed ? 3 : 2) || path.points.length > 128) return false;
    total += path.points.length;
    return total <= 4096 && path.points.every((point) => Array.isArray(point) && point.length === 2 &&
      point.every((v) => typeof v === "number" && Number.isFinite(v)) &&
      point[0] >= 0 && point[1] >= 0 && point[0] < layer.width && point[1] < layer.height);
  });
}
