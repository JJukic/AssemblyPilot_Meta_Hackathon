// Checks that every clip in the manifest exists, is decodable and is long enough.
// Unavailable clips are written to clip-status.json and render as a labelled placeholder.
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { browserShots, completionShots, introShots, problemShot, productShots, solveShots, workflowShots, type Shot } from "../src/manifest.ts";

const shots: Shot[] = [...introShots, problemShot, ...productShots, ...workflowShots.before, ...workflowShots.after, ...browserShots, ...solveShots, ...completionShots];
const unavailable: string[] = [];
const durations = new Map<string, number>();

for (const src of new Set(shots.map((shot) => shot.src))) {
  const path = join("public", src);
  if (!existsSync(path)) { console.warn(`MISSING  ${src}`); unavailable.push(src); continue; }
  if (src.endsWith(".jpg")) { console.log(`ok       ${src}`); continue; }
  try {
    const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]).toString();
    durations.set(src, Number(out));
    console.log(`ok       ${src} (${Number(out).toFixed(1)} s)`);
  } catch { console.warn(`UNREADABLE ${src}`); unavailable.push(src); }
}

let problems = 0;
for (const shot of shots) {
  const length = durations.get(shot.src);
  const end = shot.from + shot.dur * (shot.rate ?? 1);
  if (length !== undefined && end > length) { console.warn(`RANGE    ${shot.id} ends at ${end.toFixed(1)} s of ${length.toFixed(1)} s`); problems += 1; }
}
writeFileSync("src/clip-status.json", `${JSON.stringify({ unavailable }, null, 2)}\n`);
console.log(`${shots.length} shots, ${unavailable.length} unavailable clips, ${problems} range problems`);
if (problems) process.exitCode = 1;
