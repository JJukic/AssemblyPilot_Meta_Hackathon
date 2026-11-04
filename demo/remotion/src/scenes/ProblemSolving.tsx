import { AbsoluteFill, interpolate } from "remotion";
import { solveShots } from "../manifest";
import { Grid, Headline, Label, useEnter } from "../components/Overlays";
import { ShotSeries, Sfx } from "../components/ShotSeries";
import { color, mono, sans } from "../theme";

export function ProblemSolving() {
  return <ShotSeries shots={solveShots} />;
}

function State({ name, tone, line, footage, delay }: { name: string; tone: string; line: string; footage: string; delay: number }) {
  const enter = useEnter(delay);
  return (
    <div style={{
      flex: 1, padding: "30px 32px", borderRadius: 12, background: color.panel, borderTop: `6px solid ${tone}`,
      opacity: enter, transform: `translateY(${interpolate(enter, [0, 1], [26, 0])}px)`, display: "flex", flexDirection: "column", gap: 16,
    }}>
      <div style={{ fontFamily: mono, fontWeight: 500, fontSize: 50, color: tone }}>{name}</div>
      <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 38, color: color.text, lineHeight: 1.25 }}>{line}</div>
      <div style={{ fontFamily: mono, fontSize: 25, color: color.muted }}>{footage}</div>
    </div>
  );
}

function Node({ text, tone, delay }: { text: string; tone: string; delay: number }) {
  const enter = useEnter(delay);
  return <div style={{ opacity: enter, padding: "20px 28px", border: `3px solid ${tone}`, borderRadius: 10, fontFamily: sans, fontWeight: 700, fontSize: 36, color: color.text, background: color.bg }}>{text}</div>;
}
function Gap({ delay }: { delay: number }) {
  const enter = useEnter(delay);
  return <div style={{ opacity: enter, fontFamily: mono, fontSize: 36, color: color.cyan }}>→</div>;
}

/** `uncertain` does not occur in the recordings, so it is explained as a diagram, never as fake UI. */
export function StatusLegend() {
  return (
    <AbsoluteFill>
      <Grid />
      <AbsoluteFill style={{ padding: "0 90px", gap: 46, justifyContent: "center" }}>
        <Headline text="Three results. Only one verifies a step." size={68} style={{ textAlign: "left" }} />
        <div style={{ display: "flex", gap: 26 }}>
          <State name="correct" tone={color.green} line="Confirmed on a fresh image, then the step continues." footage="Seen in this recording" delay={12} />
          <State name="incorrect" tone={color.red} line="Explains the issue and how to fix it." footage="Seen in this recording" delay={24} />
          <State name="uncertain" tone={color.amber} line="Not a pass. The system will not guess." footage="Diagram: not in this recording" delay={36} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 8 }}>
          <Node text="uncertain" tone={color.amber} delay={165} />
          <Gap delay={245} />
          <Node text="Workflow pauses" tone={color.border} delay={255} />
          <Gap delay={360} />
          <Node text="User selects Check Again" tone={color.cyan} delay={370} />
          <Gap delay={405} />
          <Node text="New image" tone={color.green} delay={415} />
        </div>
      </AbsoluteFill>
      <Label text="Explanatory diagram" style={{ top: 40, right: 48 }} />
      <Sfx name="tick" delay={36} />
    </AbsoluteFill>
  );
}
