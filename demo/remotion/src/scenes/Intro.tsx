import { AbsoluteFill, Sequence } from "remotion";
import { frames, introShots } from "../manifest";
import { Headline } from "../components/Overlays";
import { ShotSeries } from "../components/ShotSeries";

const shadow = { textShadow: "0 3px 26px rgba(0,0,0,0.8)" };

export function Intro() {
  return (
    <AbsoluteFill>
      <ShotSeries shots={introShots} caption={false} />
      {/* A soft local shade behind the hook only. The footage itself stays undimmed. */}
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 62% 30% at 50% 50%, rgba(5,9,17,0.25), transparent 72%)" }} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: 150 }}>
        <Sequence from={6} durationInFrames={frames(3.5)} layout="none">
          <Headline text="Something you have never built." size={84} style={shadow} />
        </Sequence>
        <Sequence from={frames(3.9)} layout="none">
          <Headline text="Guided by mixed reality." size={84} style={shadow} />
        </Sequence>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
