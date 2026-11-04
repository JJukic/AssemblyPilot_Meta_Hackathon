import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

for (const weight of ["500", "700", "800"]) {
  loadFont({ family: "Inter", url: staticFile(`fonts/inter-latin-${weight}-normal.woff2`), weight });
}
loadFont({ family: "JetBrains Mono", url: staticFile("fonts/jetbrains-mono-latin-500-normal.woff2"), weight: "500" });

// Colours follow frontend/src/app/globals.css and the AR panel.
export const color = {
  bg: "#0a101b", panel: "#101927", border: "#253144", muted: "#a9b8cc", text: "#eef4ff",
  blue: "#488cff", cyan: "#3fd0ff", green: "#3ddc84", red: "#ff5a5f", amber: "#ffb72b",
};
export const sans = "Inter, Arial, sans-serif";
export const mono = "'JetBrains Mono', Menlo, monospace";
