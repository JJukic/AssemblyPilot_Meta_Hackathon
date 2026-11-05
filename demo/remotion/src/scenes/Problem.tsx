import { AbsoluteFill } from "remotion";
import { problemShot } from "../manifest";
import { CaptureBadge } from "../components/Overlays";
import { Clip } from "../components/Clip";

/** The reference scene. Its chapter card comes from ChapterTrack, like every other video chapter. */
export function Problem() {
  return (
    <AbsoluteFill>
      <Clip shot={problemShot} />
      <CaptureBadge />
    </AbsoluteFill>
  );
}
