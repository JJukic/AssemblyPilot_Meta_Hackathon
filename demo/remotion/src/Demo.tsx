import { AbsoluteFill, Audio, Series, getStaticFiles, interpolate, staticFile } from "remotion";
import { FadeScene } from "./components/Overlays";
import { FPS, frames, scenes, totalFrames, type SceneId } from "./manifest";
import { Subtitles, VoiceTrack, musicLevel } from "./components/VoiceOver";
import { AIExplanation } from "./scenes/AIExplanation";
import { AssemblyWorkflow } from "./scenes/AssemblyWorkflow";
import { BrowserDemo } from "./scenes/BrowserDemo";
import { Completion } from "./scenes/Completion";
import { EndCard } from "./scenes/EndCard";
import { FutureVision } from "./scenes/FutureVision";
import { Intro } from "./scenes/Intro";
import { Problem } from "./scenes/Problem";
import { ProblemSolving, StatusLegend } from "./scenes/ProblemSolving";
import { ProductIntro } from "./scenes/ProductIntro";
import "./theme";

const VIEWS: Record<SceneId, () => React.JSX.Element> = {
  intro: Intro, problem: Problem, product: ProductIntro, workflow: AssemblyWorkflow, browser: BrowserDemo, solve: ProblemSolving,
  status: StatusLegend, ai: AIExplanation, completion: Completion, vision: FutureVision, end: EndCard,
};

export function Demo() {
  const hasMusic = getStaticFiles().some((file) => file.name === "audio/music.wav");
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Series>
        {scenes.map((scene) => {
          const View = VIEWS[scene.id];
          const duration = frames(scene.dur);
          return (
            <Series.Sequence key={scene.id} durationInFrames={duration} name={scene.id}>
              <FadeScene duration={duration}><View /></FadeScene>
            </Series.Sequence>
          );
        })}
      </Series>
      {hasMusic && <Audio src={staticFile("audio/music.wav")} volume={(f) => musicLevel(f / FPS) * interpolate(f, [totalFrames - 45, totalFrames], [1, 0.8], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />}
      <VoiceTrack />
      <Subtitles />
    </AbsoluteFill>
  );
}
