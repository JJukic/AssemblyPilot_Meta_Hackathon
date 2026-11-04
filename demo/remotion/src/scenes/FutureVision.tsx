import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion";
import { Grid, Headline } from "../components/Overlays";
import { frames } from "../manifest";
import { color, mono } from "../theme";

/** Abstract guided path: steps connected by a line. Deliberately not a product shot. */
function GuidedPath() {
  const frame = useCurrentFrame();
  const points = [[260, 880], [640, 800], [1020, 860], [1400, 780], [1660, 840]];
  const line = points.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
  const progress = interpolate(frame, [20, 540], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <svg width="1920" height="1080" style={{ position: "absolute", inset: 0 }}>
      <path d={line} fill="none" stroke={color.cyan} strokeWidth="3" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - progress} opacity={0.75} />
      {points.map(([x, y], i) => {
        const on = progress >= i / (points.length - 1);
        return <circle key={x} cx={x} cy={y} r={on ? 12 : 7} fill={on ? color.cyan : color.border} />;
      })}
    </svg>
  );
}

function Line({ from, duration, text, size = 76 }: { from: number; duration: number; text: string; size?: number }) {
  return (
    <Sequence from={frames(from)} durationInFrames={frames(duration)} layout="none">
      <Headline text={text} size={size} />
    </Sequence>
  );
}

export function FutureVision() {
  return (
    <AbsoluteFill>
      <Grid />
      <GuidedPath />
      <div style={{
        position: "absolute", top: 56, left: "50%", transform: "translateX(-50%)", padding: "12px 26px", borderRadius: 8,
        border: `3px solid ${color.amber}`, fontFamily: mono, fontWeight: 500, fontSize: 30, color: color.amber, whiteSpace: "nowrap",
      }}>FUTURE VISION · NOT IMPLEMENTED</div>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: "0 170px 120px" }}>
        <Line from={0.3} duration={3.4} text="Today: a LEGO assembly." />
        <Line from={3.8} duration={6.6} text="Tomorrow, it could support cooking, repairs, education and training." size={66} />
        <Line from={10.5} duration={8.2} text="Imagine putting on mixed reality and learning to cook without prior experience." size={66} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
