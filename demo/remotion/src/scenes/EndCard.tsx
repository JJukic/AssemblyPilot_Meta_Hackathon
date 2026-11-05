import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Grid, Headline } from "../components/Overlays";
import { Logo } from "../components/Logo";
import { color } from "../theme";

const LOOP = [["Guidance", 125], ["Action", 165], ["Visual verification", 205]] as const;

export function EndCard() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Grid />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 36, paddingBottom: 120, transform: `scale(${interpolate(frame, [0, 375], [1, 1.04])})` }}>
        <Logo scale={1.2} />
        <div style={{ display: "flex", gap: 30, alignItems: "center", height: 60 }}>
          {LOOP.map(([text, delay], index) => <Headline key={text} text={index ? `→ ${text}` : text} size={40} delay={delay} tone={color.cyan} style={{ fontWeight: 700, letterSpacing: 0 }} />)}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
