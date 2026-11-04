import { AbsoluteFill, Sequence } from "remotion";
import { frames, introShots } from "../manifest";
import { Headline } from "../components/Overlays";
import { ShotSeries } from "../components/ShotSeries";

export function Intro() {
  return (
    <AbsoluteFill>
      <ShotSeries shots={introShots} caption={false} />
      <AbsoluteFill style={{ background: "rgba(5,9,17,0.54)" }} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: 150 }}>
        <Sequence from={6} durationInFrames={frames(3.5)} layout="none">
          <Headline text="How do you build something you have never built before?" size={84} />
        </Sequence>
        <Sequence from={frames(3.9)} layout="none">
          <Headline text="What if mixed reality could teach you a physical skill?" size={72} />
        </Sequence>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
