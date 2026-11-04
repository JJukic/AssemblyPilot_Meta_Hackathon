import { AbsoluteFill, Series, interpolate, useCurrentFrame } from "remotion";
import { frames, productShots } from "../manifest";
import { COLUMN, Grid, Headline, RightSectionHeading, useEnter } from "../components/Overlays";
import { Logo } from "../components/Logo";
import { ShotSeries } from "../components/ShotSeries";
import { color, mono, sans } from "../theme";

const CHIPS = ["Guides each step", "Camera sees the real build", "AI checks the image", "Panel shows what to do next"];

function Chip({ text, index }: { text: string; index: number }) {
  const enter = useEnter(10 + index * 26);
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "baseline", padding: "9px 0", opacity: enter, transform: `translateY(${interpolate(enter, [0, 1], [12, 0])}px)` }}>
      <span style={{ fontFamily: mono, fontSize: 24, color: color.cyan }}>0{index + 1}</span>
      <span style={{ fontFamily: sans, fontWeight: 700, fontSize: 32, color: color.text }}>{text}</span>
    </div>
  );
}

function LogoCard() {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, 75], [1.02, 1.08]);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 28, transform: `scale(${scale})` }}>
      <Logo />
      <Headline text="Visual Assembly Intelligence" size={38} delay={12} tone={color.muted} style={{ fontWeight: 500, letterSpacing: 0 }} />
    </AbsoluteFill>
  );
}

export function ProductIntro() {
  return (
    <AbsoluteFill>
      <Grid />
      <Series>
        <Series.Sequence durationInFrames={frames(2.5)}><LogoCard /></Series.Sequence>
        <Series.Sequence durationInFrames={productShots.reduce((t, s) => t + frames(s.dur), 0)}>
          <ShotSeries shots={productShots} split />
          <RightSectionHeading number="03" title="ON HOLOLENS" />
          <div style={{ position: "absolute", left: COLUMN.left, top: 396, width: COLUMN.width }}>
            {CHIPS.map((text, index) => <Chip key={text} text={text} index={index} />)}
          </div>
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
}
