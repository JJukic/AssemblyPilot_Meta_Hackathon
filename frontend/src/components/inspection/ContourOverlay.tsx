"use client";
import type { ContourKind, ContourLayer } from "@/lib/contours";

export const contourLabels: Record<ContourKind, string> = {
  sam_outline: "SAM Outline", canny_edges: "Canny Edges", reference_match: "Reference Match",
};
export const emptyContours: Record<ContourKind, boolean> = {
  sam_outline: false, canny_edges: false, reference_match: false,
};
const colors: Record<ContourKind, string> = {
  sam_outline: "#69d5ff", canny_edges: "#ffcf70", reference_match: "#64f7a5",
};

export function ContourControls({ layers, enabled, onChange }: {
  layers: ContourLayer[]; enabled: Record<ContourKind, boolean>;
  onChange: (kind: ContourKind, checked: boolean) => void;
}) {
  return <div className="contour-controls">
    {(Object.keys(contourLabels) as ContourKind[]).map((kind) => {
      const available = layers.some((layer) => layer.kind === kind && layer.status === "available");
      const message = layers.find((layer) => layer.kind === kind)?.message ?? "No supported evidence on this snapshot.";
      return <div key={kind}>
        <label><input type="checkbox" checked={available && enabled[kind]} disabled={!available}
          onChange={(event) => onChange(kind, event.target.checked)} /> {contourLabels[kind]}</label>
        {!available && <small>{contourLabels[kind]} unavailable: {message}</small>}
      </div>;
    })}
    <p className="muted">Amber: raw ROI edges. Green: verified reference feature pairs. Blue: SAM mask boundary. None certifies assembly correctness.</p>
  </div>;
}

export function ContourPaths({ layers, enabled, width, height }: {
  layers: ContourLayer[]; enabled: Record<ContourKind, boolean>; width: number; height: number;
}) {
  return <svg className="contour-overlay" viewBox={`0 0 ${width} ${height}`} aria-label="Inspection contours">
    {layers.filter((layer) => layer.status === "available" && enabled[layer.kind]).map((layer, index) =>
      <g key={`${layer.kind}:${index}`} data-contour-kind={layer.kind} fill="none" stroke={colors[layer.kind]} strokeWidth={1.5}>
        <title>{layer.message}</title>
        {layer.paths.map((path, i) => <g key={i}>
          <path d={path.points.map(([x, y], j) => `${j ? "L" : "M"}${x},${y}`).join(" ") + (path.closed ? " Z" : "")}
            vectorEffect="non-scaling-stroke" strokeDasharray={layer.kind === "canny_edges" ? "3 2" : undefined} />
          {layer.kind === "reference_match" && <circle cx={path.points.at(-1)![0]} cy={path.points.at(-1)![1]} r={2} vectorEffect="non-scaling-stroke" />}
        </g>)}
      </g>)}
  </svg>;
}
