"use client";
import type { ReactNode } from "react";
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

export function OverlayOption({ label, available, checked, onChange, description, color, children }: {
  label: string; available: boolean; checked: boolean; onChange: (checked: boolean) => void;
  description: string; color?: string; children?: ReactNode;
}) {
  return <div className={`overlay-option ${available ? "is-available" : "is-unavailable"}`}>
    <div className="overlay-option-heading">
      <label><input type="checkbox" checked={available && checked} disabled={!available}
        onChange={(event) => onChange(event.target.checked)} />
        {color && <span className="overlay-swatch" style={{ background: color }} aria-hidden="true" />}{label}</label>
      <span className="overlay-availability">{available ? "Available" : "Unavailable"}</span>
    </div>
    <p className="overlay-description">{description}</p>
    {children}
  </div>;
}

export function ContourControls({ layers, enabled, onChange, cannyAction, unavailableMessages }: {
  layers: ContourLayer[]; enabled: Record<ContourKind, boolean>;
  onChange: (kind: ContourKind, checked: boolean) => void; cannyAction?: ReactNode;
  unavailableMessages?: Partial<Record<ContourKind, string>>;
}) {
  const descriptions: Record<ContourKind, string> = {
    sam_outline: "Object boundaries from SAM segmentation.",
    canny_edges: "Raw detected edges · not a verified match.",
    reference_match: "Geometrically verified reference feature pairs.",
  };
  return <div className="contour-controls">
    {(Object.keys(contourLabels) as ContourKind[]).map((kind) => {
      const available = layers.some((layer) => layer.kind === kind && layer.status === "available");
      const message = layers.find((layer) => layer.kind === kind)?.message ?? unavailableMessages?.[kind] ?? "No supported evidence on this snapshot.";
      return <OverlayOption key={kind} label={contourLabels[kind]} color={colors[kind]}
        available={available} checked={enabled[kind]} onChange={(checked) => onChange(kind, checked)}
        description={available ? descriptions[kind] : `${contourLabels[kind]} unavailable: ${message}`}>
        {kind === "canny_edges" && cannyAction}
      </OverlayOption>;
    })}
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
