import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Grid, Headline } from "../components/Overlays";
import { Logo } from "../components/Logo";
import { color, mono } from "../theme";

const LOOP = [["Guidance", 125], ["Action", 165], ["Visual verification", 205]] as const;

export function EndCard() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Grid />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 36, transform: `scale(${interpolate(frame, [0, 375], [1, 1.04])})` }}>
        <Logo scale={1.2} />
        <div style={{ display: "flex", gap: 30, alignItems: "center", fontFamily: mono, fontSize: 40, height: 60 }}>
          {LOOP.map(([text, delay], index) => <Headline key={text} text={index ? `→ ${text}` : text} size={40} delay={delay} tone={color.cyan} style={{ fontWeight: 600, letterSpacing: 0 }} />)}
        </div>
        <Headline text="AI-guided mixed reality for the real world." size={48} delay={260} tone={color.muted} style={{ fontWeight: 500, letterSpacing: 0 }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
