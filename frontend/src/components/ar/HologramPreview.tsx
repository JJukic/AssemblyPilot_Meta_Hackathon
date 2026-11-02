"use client";
import type { Placement } from "@/lib/ar/data";
import { footprint } from "@/lib/ar/hologram";

/**
 * 2D guidance preview of a cumulative step hologram (not mixed reality).
 * Top view: X right, Z toward the user (down). Front view: X right, Y up,
 * tabletop at Y = 0; each block spans its bottom face (Y) to its body top.
 * Earlier steps are grey; the current step is cyan; the selected block is outlined.
 */
export function HologramPreview({
  assembled,
  current,
  selected = -1,
  onPickTop,
}: {
  assembled: Placement[];
  current: Placement[];
  selected?: number;
  /** Optional author interaction: click in the top view to choose X/Z (metres). */
  onPickTop?: (xM: number, zM: number) => void;
}) {
  const all = [...assembled, ...current];
  const rects = all.map(footprint);
  const extent = Math.max(
    120,
    ...rects.map((r) => Math.max(Math.abs(r.x0), Math.abs(r.x1), Math.abs(r.z0), Math.abs(r.z1)) + 20),
  );
  const maxTop = Math.max(40, ...all.map((p) => p.position_m[1] * 1000 + p.dimensions.y_mm + 10));
  // Front view is zoomed to the blocks' actual X range so heights stay readable.
  const xMin = Math.min(-20, ...rects.map((r) => r.x0)) - 10, xMax = Math.max(20, ...rects.map((r) => r.x1)) + 10;
  const frontW = xMax - xMin, frontH = Math.max(maxTop * 1.3, frontW * 0.45);
  const style = (i: number) =>
    i < assembled.length
      ? { fill: "#8a96a0", fillOpacity: 0.25, stroke: "#9aa7b0", strokeWidth: extent / 150 }
      : {
          fill: "#38d9ff",
          fillOpacity: 0.35,
          stroke: i - assembled.length === selected ? "#ffffff" : "#8af5ff",
          strokeWidth: (i - assembled.length === selected ? 3 : 1.2) * (extent / 150),
        };
  const label = (i: number) => (i < assembled.length ? "" : String(i - assembled.length + 1));
  const font = extent / 9;
  return (
    <div className="hologram-preview">
      <figure>
        <svg
          viewBox={`${-extent} ${-extent} ${extent * 2} ${extent * 2}`}
          role="img"
          aria-label="2D intended placement"
          onClick={
            onPickTop
              ? (e) => {
                  const b = e.currentTarget.getBoundingClientRect();
                  const x = ((e.clientX - b.left) / b.width - 0.5) * 2 * extent;
                  const z = ((e.clientY - b.top) / b.height - 0.5) * 2 * extent;
                  onPickTop(Math.round(x) / 1000, Math.round(z) / 1000);
                }
              : undefined
          }
        >
          <rect x={-extent} y={-extent} width={extent * 2} height={extent * 2} fill="#152536" />
          <path d={`M${-extent} 0H${extent} M0 ${-extent}V${extent}`} stroke="#5d6e7e" strokeWidth={extent / 200} />
          {all.map((p, i) => (
            <g key={i} transform={`translate(${p.position_m[0] * 1000} ${p.position_m[2] * 1000}) rotate(${-p.rotation_deg[1]})`}>
              <rect x={-p.dimensions.x_mm / 2} y={-p.dimensions.z_mm / 2} width={p.dimensions.x_mm} height={p.dimensions.z_mm} {...style(i)} />
              {label(i) && <text x={0} y={font / 3} fontSize={font} textAnchor="middle" fill="#ffffff">{label(i)}</text>}
            </g>
          ))}
        </svg>
        <figcaption>Top view · X right, Z toward you</figcaption>
      </figure>
      <figure>
        <svg
          viewBox={`${xMin} ${-frontH + frontH * 0.12} ${frontW} ${frontH}`}
          role="img"
          aria-label="2D height view (front)"
        >
          <rect x={xMin} y={-frontH + frontH * 0.12} width={frontW} height={frontH} fill="#152536" />
          <path d={`M${xMin} 0H${xMax}`} stroke="#c8d3dc" strokeWidth={Math.max(0.6, frontW / 300)} />
          {all.map((p, i) => {
            const r = rects[i];
            const bottom = p.position_m[1] * 1000;
            return (
              <g key={i}>
                <rect x={r.x0} y={-(bottom + p.dimensions.y_mm)} width={r.x1 - r.x0} height={p.dimensions.y_mm} {...style(i)} strokeWidth={Math.max(0.3, frontW / 250) * (i - assembled.length === selected ? 2.5 : 1)} />
                {label(i) && (
                  <text x={(r.x0 + r.x1) / 2} y={-(bottom + p.dimensions.y_mm / 2) + Math.min(frontW / 14, p.dimensions.y_mm * 0.8) / 3} fontSize={Math.min(frontW / 14, p.dimensions.y_mm * 0.8)} textAnchor="middle" fill="#ffffff">
                    {label(i)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        <figcaption>Front view · Y up from the tabletop (bottom face → body top)</figcaption>
      </figure>
    </div>
  );
}
