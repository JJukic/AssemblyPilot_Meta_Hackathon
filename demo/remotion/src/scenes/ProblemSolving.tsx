import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { frames, solveShots } from "../manifest";
import { COLUMN, Grid, Headline, plate, SourceBadge, useEnter } from "../components/Overlays";
import { ShotSeries, Sfx } from "../components/ShotSeries";
import { color, mono, sans } from "../theme";

const startOf = (id: string) => {
  let t = 0;
  for (const shot of solveShots) { if (shot.id === id) return t; t += frames(shot.dur); }
  throw new Error(`Unknown shot ${id}`);
};

const RAIL = [
  { id: "solve-incorrect", text: "Incorrect result" },
  { id: "solve-plan", text: "Correction plan" },
  { id: "solve-fix", text: "User fixes the real build" },
  { id: "solve-again", text: "User selects Check Again" },
  { id: "solve-verify", text: "New image is captured" },
  { id: "solve-verified", text: "Step verified" },
];

/** Shows the order of events: a new image exists only after the deliberate Check Again. */
function ProcessRail() {
  const frame = useCurrentFrame();
  const current = RAIL.reduce((found, step, index) => (frame >= startOf(step.id) ? index : found), -1);
  return (
    <div style={{ ...plate, position: "absolute", left: COLUMN.left, top: 492, width: COLUMN.width, padding: "16px 22px", display: "flex", flexDirection: "column", gap: 10 }}>
      {RAIL.map((step, index) => {
        const active = index === current;
        const key = step.id === "solve-again" && active;
        return (
          <div key={step.id} style={{ display: "flex", alignItems: "center", gap: 16, opacity: index <= current ? 1 : 0.5 }}>
            <div style={{ width: 16, height: 16, borderRadius: 8, background: index <= current ? color.cyan : "transparent", border: `2px solid ${index <= current ? color.cyan : color.muted}`, boxShadow: active ? "0 0 16px rgba(63,208,255,0.9)" : undefined }} />
            <span style={{ fontFamily: sans, fontWeight: active ? 800 : 500, fontSize: 26, color: key ? color.cyan : active ? "#fff" : color.muted }}>{step.text}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Links Check Again to the fresh capture: a short shutter on the card, then a clear label. */
function NewImageFlash() {
  const frame = useCurrentFrame() - startOf("solve-verify");
  if (frame < 0 || frame > 90) return null;
  const flash = interpolate(frame, [0, 9], [0.6, 0], { extrapolateRight: "clamp" });
  const pill = interpolate(frame, [4, 12, 75, 90], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <>
      <AbsoluteFill style={{ background: "#fff", opacity: flash * 0.8 }} />
      <div style={{ position: "absolute", top: 806, left: 96, padding: "7px 14px", borderRadius: 8, background: color.cyan, color: "#06101f", fontFamily: mono, fontWeight: 500, fontSize: 22, opacity: pill }}>NEW IMAGE TAKEN</div>
    </>
  );
}

export function ProblemSolving() {
  return (
    <AbsoluteFill>
      <ShotSeries shots={solveShots} />
      <ProcessRail />
      <NewImageFlash />
    </AbsoluteFill>
  );
}

function State({ name, tone, line, footage, delay }: { name: string; tone: string; line: string; footage: string; delay: number }) {
  const enter = useEnter(delay);
  return (
    <div style={{
      flex: 1, padding: "22px 26px", borderRadius: 12, background: color.panel, borderTop: `5px solid ${tone}`,
      opacity: enter, transform: `translateY(${interpolate(enter, [0, 1], [26, 0])}px)`, display: "flex", flexDirection: "column", gap: 12,
    }}>
      <div style={{ fontFamily: mono, fontWeight: 500, fontSize: 42, color: tone }}>{name}</div>
      <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 32, color: color.text, lineHeight: 1.25 }}>{line}</div>
      <div style={{ fontFamily: mono, fontSize: 22, color: color.muted }}>{footage}</div>
    </div>
  );
}

function Node({ text, tone, delay }: { text: string; tone: string; delay: number }) {
  const enter = useEnter(delay);
  return <div style={{ opacity: enter, padding: "16px 24px", border: `3px solid ${tone}`, borderRadius: 10, fontFamily: sans, fontWeight: 700, fontSize: 32, color: color.text, background: color.bg }}>{text}</div>;
}
function Gap({ delay }: { delay: number }) {
  const enter = useEnter(delay);
  return <div style={{ opacity: enter, fontFamily: mono, fontSize: 34, color: color.cyan }}>→</div>;
}

/** `uncertain` does not occur in the recordings, so it is explained as a diagram, never as fake UI. */
export function StatusLegend() {
  return (
    <AbsoluteFill>
      <Grid />
      <Headline text="Three results. Only one verifies a step." size={56} style={{ position: "absolute", left: 90, top: 200, width: 1040, textAlign: "left" }} />
      <div style={{ position: "absolute", left: 90, right: 96, top: 412, display: "flex", flexDirection: "column", gap: 26 }}>
        <div style={{ display: "flex", gap: 24 }}>
          <State name="correct" tone={color.green} line="Confirmed on a fresh image, then the step continues." footage="Seen in this recording" delay={12} />
          <State name="incorrect" tone={color.red} line="Explains the issue and how to fix it." footage="Seen in this recording" delay={24} />
          <State name="uncertain" tone={color.amber} line="Not a pass. The system will not guess." footage="Diagram: not in this recording" delay={36} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <Node text="uncertain" tone={color.amber} delay={165} />
          <Gap delay={245} />
          <Node text="Workflow pauses" tone={color.border} delay={255} />
          <Gap delay={360} />
          <Node text="User selects Check Again" tone={color.cyan} delay={370} />
          <Gap delay={405} />
          <Node text="New image" tone={color.green} delay={415} />
        </div>
      </div>
      <SourceBadge text="Explanatory diagram" />
      <Sfx name="tick" delay={36} />
    </AbsoluteFill>
  );
}
