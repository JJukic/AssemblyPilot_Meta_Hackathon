import { Composition, Still } from "remotion";
import { ArchitectureDiagram } from "./ArchitectureDiagram";
import { Demo } from "./Demo";
import { FPS, HEIGHT, WIDTH, totalFrames } from "./manifest";

export const Root = () => (
  <>
    <Composition id="AssemblyPilotDemo" component={Demo} durationInFrames={totalFrames} fps={FPS} width={WIDTH} height={HEIGHT} />
    <Still id="ArchitectureDiagram" component={ArchitectureDiagram} width={WIDTH} height={HEIGHT} />
  </>
);
