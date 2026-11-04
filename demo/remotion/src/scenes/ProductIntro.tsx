import { AbsoluteFill, Series, interpolate, useCurrentFrame } from "remotion";
import { frames, productShots } from "../manifest";
import { Grid, Headline, useEnter } from "../components/Overlays";
import { Logo } from "../components/Logo";
import { ShotSeries } from "../components/ShotSeries";
import { color, mono, sans } from "../theme";

const CHIPS = ["Guides each step", "Camera sees the real build", "AI checks the image", "Panel shows what to do next"];

function Chip({ text, index }: { text: string; index: number }) {
  const enter = useEnter(8 + index * 26);
  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column", gap: 8, padding: "20px 24px", borderRadius: 10,
      background: "rgba(7,12,22,0.9)", borderTop: `4px solid ${color.cyan}`, opacity: enter,
      transform: `translateY(${interpolate(enter, [0, 1], [24, 0])}px)`,
    }}>
      <span style={{ fontFamily: mono, fontSize: 24, color: color.cyan }}>0{index + 1}</span>
      <span style={{ fontFamily: sans, fontWeight: 700, fontSize: 32, color: color.text, lineHeight: 1.2 }}>{text}</span>
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
        <AbsoluteFill style={{ justifyContent: "flex-end", padding: "0 72px 172px" }}>
          <div style={{ display: "flex", gap: 22 }}>{CHIPS.map((text, index) => <Chip key={text} text={text} index={index} />)}</div>
        </AbsoluteFill>
      </Series.Sequence>
    </Series>
  );
}
