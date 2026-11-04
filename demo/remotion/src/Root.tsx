import { Composition } from "remotion";
import { Demo } from "./Demo";
import { FPS, HEIGHT, WIDTH, totalFrames } from "./manifest";

export const Root = () => (
  <Composition id="AssemblyPilotDemo" component={Demo} durationInFrames={totalFrames} fps={FPS} width={WIDTH} height={HEIGHT} />
);
