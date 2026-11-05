import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { NODES } from "../ArchitectureDiagram";
import { Grid, RightSectionHeading, SourceBadge } from "../components/Overlays";
import { voicePlacements } from "../manifest";
import { color } from "../theme";
import words from "../voice-words.json";

const lead = voicePlacements.find((p) => p.voice === "06-architecture")!.at;
const spoken = words["06-architecture"];
const at = (word: string) => lead + spoken.find((w) => w.word.replace(/[^\w]/g, "") === word)!.start;

/** Each card lights up on the word that names it, so that the picture follows the speech. */
const CUES: { node: keyof typeof NODES; from: number; to: number }[] = [
  { node: "camera", from: at("camera") - 0.5, to: at("backend") },
  { node: "backend", from: at("backend"), to: at("Orchestrator") - 0.4 },
  { node: "orchestrator", from: at("Orchestrator") - 0.4, to: at("Muse") },
  { node: "muse", from: at("Muse"), to: at("When") },
  { node: "sam", from: at("When"), to: at("validated") - 0.2 },
  { node: "result", from: at("validated") - 0.2, to: at("both") },
  { node: "display", from: at("both"), to: 99 },
];

function Spotlight({ node, from, to }: (typeof CUES)[number]) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = frame / fps;
  const opacity = Math.min(interpolate(s, [from, from + 0.25], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }), interpolate(s, [to, to + 0.3], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const n = NODES[node];
  return <div style={{ position: "absolute", left: n.x - 5, top: n.y - 5, width: n.w + 10, height: n.h + 10, borderRadius: 18, border: `3px solid ${color.cyan}`, boxShadow: "0 0 30px rgba(63,208,255,0.75)", opacity }} />;
}

export function ArchitectureScene() {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, 90], [0.965, 1], { extrapolateRight: "clamp" });
  const opacity = interpolate(frame, [0, 24], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill>
      <Grid />
      <AbsoluteFill style={{ opacity, transform: `scale(${scale})` }}>
        <Img src={staticFile("architecture/assemblypilot-architecture.png")} style={{ width: 1920, height: 1080 }} />
        {CUES.map((cue) => <Spotlight key={cue.node} {...cue} />)}
      </AbsoluteFill>
      <RightSectionHeading title="ARCHITECTURE" subtitle="How the AI workflow connects the real world" />
      <SourceBadge text="Explanatory diagram" />
    </AbsoluteFill>
  );
}
