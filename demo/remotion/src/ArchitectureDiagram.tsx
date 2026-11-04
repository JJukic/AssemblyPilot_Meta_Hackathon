import { Boxes } from "lucide-react";
import { AbsoluteFill } from "remotion";
import { color, mono, sans } from "./theme";

/**
 * Source of public/architecture/assemblypilot-architecture.png (`npm run diagram`).
 * The top right and the bottom stay empty for the video's heading and subtitles.
 */
export const NODES = {
  camera: { x: 60, y: 135, w: 360, h: 150 },
  frontend: { x: 60, y: 320, w: 360, h: 150 },
  backend: { x: 60, y: 505, w: 360, h: 160 },
  orchestrator: { x: 510, y: 505, w: 360, h: 160 },
  local: { x: 950, y: 392, w: 370, h: 96 },
  muse: { x: 950, y: 505, w: 370, h: 160 },
  sam: { x: 950, y: 682, w: 370, h: 128 },
  result: { x: 1424, y: 392, w: 400, h: 206 },
  display: { x: 1424, y: 634, w: 400, h: 176 },
};
type NodeId = keyof typeof NODES;

const FLOW = [
  "M240 285 V320", "M240 470 V505", "M420 585 H510", "M870 585 H950",
  "M910 585 V440 H950", "M1320 440 H1372 V490 H1424", "M1320 585 H1372 V490", "M1624 598 V634",
];
const OPTIONAL = ["M910 585 V746 H950", "M1320 746 H1398 V550 H1424"];

function Card({ id, title, line, tag, tone = color.border, glow, dashed, children }: {
  id: NodeId; title: string; line?: string; tag?: string; tone?: string; glow?: boolean; dashed?: boolean; children?: React.ReactNode;
}) {
  const n = NODES[id];
  return (
    <div style={{
      position: "absolute", left: n.x, top: n.y, width: n.w, height: n.h, boxSizing: "border-box", padding: "16px 22px", borderRadius: 14,
      background: glow ? "linear-gradient(150deg, rgba(40,84,160,0.62), rgba(16,25,39,0.96))" : "rgba(16,25,39,0.94)",
      border: `${glow ? 3 : 2}px ${dashed ? "dashed" : "solid"} ${tone}`,
      boxShadow: glow ? "0 0 42px rgba(72,140,255,0.5)" : "0 8px 26px rgba(0,0,0,0.3)",
      display: "flex", flexDirection: "column", justifyContent: "center", gap: 6,
    }}>
      {tag && <div style={{ fontFamily: mono, fontWeight: 500, fontSize: 18, color: tone === color.border ? color.cyan : tone }}>{tag}</div>}
      <div style={{ fontFamily: sans, fontWeight: 800, fontSize: 32, lineHeight: 1.1, color: "#fff" }}>{title}</div>
      {line && <div style={{ fontFamily: sans, fontWeight: 500, fontSize: 23, lineHeight: 1.25, color: "#c6d3e6" }}>{line}</div>}
      {children}
    </div>
  );
}

function Chip({ text, tone }: { text: string; tone: string }) {
  return <span style={{ padding: "3px 10px", borderRadius: 6, border: `1.5px solid ${tone}`, fontFamily: mono, fontWeight: 500, fontSize: 18, color: tone }}>{text}</span>;
}

export function ArchitectureDiagram() {
  return (
    <AbsoluteFill style={{ background: `radial-gradient(1300px 760px at 46% 52%, rgba(72,140,255,0.2), transparent 72%), ${color.bg}` }}>
      <AbsoluteFill style={{
        opacity: 0.45, backgroundSize: "72px 72px",
        backgroundImage: "linear-gradient(rgba(63,208,255,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(63,208,255,0.07) 1px, transparent 1px)",
      }} />

      <svg width="1920" height="1080" style={{ position: "absolute", inset: 0 }}>
        <defs>
          <marker id="head" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="4.2" markerHeight="4.2" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill={color.cyan} />
          </marker>
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3.2" /></filter>
        </defs>
        {FLOW.map((d) => <path key={`g${d}`} d={d} fill="none" stroke={color.cyan} strokeWidth="6" opacity="0.4" filter="url(#glow)" />)}
        {FLOW.map((d) => <path key={d} d={d} fill="none" stroke={color.cyan} strokeWidth="4" strokeLinejoin="round" markerEnd={d === "M1320 585 H1372 V490" ? undefined : "url(#head)"} />)}
        {OPTIONAL.map((d) => <path key={d} d={d} fill="none" stroke={color.cyan} strokeWidth="3" strokeDasharray="9 8" opacity="0.8" markerEnd="url(#head)" />)}
      </svg>

      <div style={{ position: "absolute", left: 510, top: 135, width: 620, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 54, height: 54, borderRadius: 12, display: "grid", placeItems: "center", color: "#06101f", background: `linear-gradient(140deg, ${color.blue}, ${color.cyan})` }}><Boxes size={32} strokeWidth={2} /></div>
          <div style={{ fontFamily: sans, fontWeight: 800, fontSize: 44, letterSpacing: -1, color: "#fff" }}>Assembly<span style={{ color: color.blue }}>Pilot</span></div>
        </div>
        <div style={{ fontFamily: mono, fontWeight: 500, fontSize: 22, color: color.cyan }}>System architecture · orchestrated AI workflow</div>
        <div style={{ display: "flex", gap: 34, marginTop: 8, fontFamily: sans, fontWeight: 500, fontSize: 22, color: "#c6d3e6" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 12 }}><svg width="54" height="8"><path d="M0 4 H54" stroke={color.cyan} strokeWidth="4" /></svg>Data flow</span>
          <span style={{ display: "flex", alignItems: "center", gap: 12 }}><svg width="54" height="8"><path d="M0 4 H54" stroke={color.cyan} strokeWidth="3" strokeDasharray="9 8" /></svg>Optional path</span>
        </div>
      </div>

      <Card id="camera" title="Camera" line="HoloLens 2 or browser camera" />
      <Card id="frontend" title="Frontend / WebXR" line="Capture, guided panel and spatial display" />
      <Card id="backend" title="FastAPI Backend" line="Secure API boundary and request validation" />
      <Card id="orchestrator" title="Assembly Orchestrator" line="Workflow state, references and verification" />
      <Card id="local" title="Local visual checks" />
      <Card id="muse" title="Muse Spark" line="Evaluates the assembly state" tag="ASSEMBLY EVALUATION" tone={color.blue} glow />
      <Card id="sam" title="SAM 3.1" line="Optional object localization and segmentation" tone={color.cyan} dashed />
      <Card id="result" title="Validated Result" line="Snapshot-bound status and evidence">
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <Chip text="correct" tone={color.green} /><Chip text="incorrect" tone={color.red} /><Chip text="uncertain" tone={color.amber} />
        </div>
      </Card>
      <Card id="display" title="Browser / HoloLens" line="Guidance, feedback and holographic display" tone={color.cyan} />

      <div style={{ position: "absolute", left: 950, top: 820, width: 600, fontFamily: mono, fontWeight: 500, fontSize: 19, color: color.muted }}>Localization only. Never decides correctness.</div>
      <div style={{ position: "absolute", left: 60, top: 712, width: 780, fontFamily: mono, fontWeight: 500, fontSize: 19, lineHeight: 1.5, color: color.muted }}>
        AssemblyPilot prototype architecture.<br />Not a Meta product architecture.
      </div>
    </AbsoluteFill>
  );
}
