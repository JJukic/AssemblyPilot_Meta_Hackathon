import { browserShots } from "../manifest";
import { ShotSeries } from "../components/ShotSeries";

export function BrowserDemo() {
  return <ShotSeries shots={browserShots} />;
}
