import { AbsoluteFill } from "remotion";
import { completionShots } from "../manifest";
import { Grid, RightSectionHeading } from "../components/Overlays";
import { ShotSeries } from "../components/ShotSeries";

export function Completion() {
  return (
    <AbsoluteFill>
      <Grid />
      <ShotSeries shots={completionShots} split />
      <RightSectionHeading number="07" title="ASSEMBLY COMPLETE" />
    </AbsoluteFill>
  );
}
