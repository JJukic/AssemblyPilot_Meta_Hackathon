import { completionShots } from "../manifest";
import { ShotSeries } from "../components/ShotSeries";

export function Completion() {
  return <ShotSeries shots={completionShots} />;
}
