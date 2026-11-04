import { AbsoluteFill } from "remotion";
import { browserShots } from "../manifest";
import { Grid, RightSectionHeading } from "../components/Overlays";
import { ShotSeries } from "../components/ShotSeries";

export function BrowserDemo() {
  return (
    <AbsoluteFill>
      <Grid />
      <ShotSeries shots={browserShots} split />
      <RightSectionHeading number="04" title="IN THE BROWSER" />
    </AbsoluteFill>
  );
}
