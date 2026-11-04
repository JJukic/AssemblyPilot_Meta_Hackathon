import { AbsoluteFill, Series, interpolate, useCurrentFrame } from "remotion";
import { frames, productShots } from "../manifest";
import { COLUMN, Grid, Headline, plate, useEnter } from "../components/Overlays";
import { Logo } from "../components/Logo";
import { ShotSeries } from "../components/ShotSeries";
import { color, mono, sans } from "../theme";

const CHIPS = ["Guides each step", "Camera sees the real build", "AI checks the image", "Panel shows what to do next"];

function Chip({ text, index }: { text: string; index: number }) {
  const enter = useEnter(10 + index * 26);
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "baseline", padding: "5px 0", opacity: enter }}>
      <span style={{ fontFamily: mono, fontSize: 22, color: color.cyan }}>0{index + 1}</span>
      <span style={{ fontFamily: sans, fontWeight: 700, fontSize: 27, color: color.text }}>{text}</span>
    </div>
  );
}

function LogoCard() {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, 75], [1.02, 1.08]);
  return (
    <AbsoluteFill>
      <Grid />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 28, transform: `scale(${scale})` }}>
        <Logo />
        <Headline text="Visual Assembly Intelligence" size={38} delay={12} tone={color.muted} style={{ fontWeight: 500, letterSpacing: 0 }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

export function ProductIntro() {
  return (
    <Series>
      <Series.Sequence durationInFrames={frames(2.5)}><LogoCard /></Series.Sequence>
      <Series.Sequence durationInFrames={productShots.reduce((t, s) => t + frames(s.dur), 0)}>
        <ShotSeries shots={productShots} />
        <div style={{ ...plate, position: "absolute", left: COLUMN.left, top: 396, width: COLUMN.width, padding: "10px 22px" }}>
          {CHIPS.map((text, index) => <Chip key={text} text={text} index={index} />)}
        </div>
      </Series.Sequence>
    </Series>
  );
}
