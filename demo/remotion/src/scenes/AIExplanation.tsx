import { AbsoluteFill, interpolate } from "remotion";
import { Grid, Headline, Label, useEnter } from "../components/Overlays";
import { color, mono, sans } from "../theme";

function Box({ title, line, tone, delay, width = 318 }: { title: string; line: string; tone: string; delay: number; width?: number }) {
  const enter = useEnter(delay);
  return (
    <div style={{
      width, padding: "22px 22px", borderRadius: 12, background: color.panel, border: `3px solid ${tone}`, opacity: enter,
      transform: `scale(${interpolate(enter, [0, 1], [0.96, 1])})`, display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ fontFamily: sans, fontWeight: 800, fontSize: 36, color: color.text }}>{title}</div>
      <div style={{ fontFamily: sans, fontWeight: 500, fontSize: 28, color: color.muted, lineHeight: 1.3 }}>{line}</div>
    </div>
  );
}
function Link({ delay }: { delay: number }) {
  const enter = useEnter(delay);
  return <div style={{ opacity: enter, fontFamily: mono, fontSize: 34, color: color.cyan }}>→</div>;
}

export function AIExplanation() {
  return (
    <AbsoluteFill>
      <Grid />
      <AbsoluteFill style={{ padding: "0 64px", gap: 40, justifyContent: "center" }}>
        <Headline text="Each model has one clear job." size={68} style={{ textAlign: "left" }} />
        <div style={{ display: "flex", alignItems: "stretch", gap: 8 }}>
          <Box title="Camera" line="Browser or HoloLens frame" tone={color.border} delay={15} />
          <Link delay={130} />
          <Box title="Orchestrator" line="Validates the request, adds reference photos" tone={color.border} delay={138} />
          <Link delay={285} />
          <Box title="Muse Spark" line="Evaluates the assembly state" tone={color.blue} delay={295} />
          <Link delay={645} />
          <Box title="Backend" line="Validates the result, keeps workflow state" tone={color.border} delay={655} />
          <Link delay={745} />
          <Box title="Display" line="Web and WebXR show the result" tone={color.cyan} delay={755} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
          <Box title="SAM 3.1" line="SAM 3.1 localizes visible objects and regions." tone={color.cyan} delay={405} width={820} />
          <div style={{ fontFamily: mono, fontSize: 28, lineHeight: 1.45, color: color.muted, opacity: useEnter(540) }}>Optional. Runs on incorrect results.<br />Never decides correctness.<br />Masks are not shown in this recording.</div>
        </div>
      </AbsoluteFill>
      <Label text="Explanatory diagram" style={{ top: 40, right: 48 }} />
    </AbsoluteFill>
  );
}
