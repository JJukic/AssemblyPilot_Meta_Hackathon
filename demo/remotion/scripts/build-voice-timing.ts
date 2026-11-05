// Places the voice-over on the timeline from the manifest and writes the subtitles. Subtitle
// text comes only from src/voiceover.ts; cue times come from the word times in voice-words.json.
// Fails on a missing file, an overlap, a line that overruns its scene, a cue too long for two
// lines, or a video over 180 s.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FPS, MAX_SECONDS, scenes, totalFrames, voicePlacements } from "../src/manifest.ts";
import { voiceScenes } from "../src/voiceover.ts";

/** About 37 characters a line at the subtitle size and width, for two short lines. */
const MAX_CUE_CHARS = 74;
const HOLD_SECONDS = 0.18;
const problems: string[] = [];
const wordTimes: Record<string, { word: string; start: number; end: number }[]> = JSON.parse(readFileSync("src/voice-words.json", "utf8"));

const probe = (path: string) => execFileSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries",
  "stream=codec_name,sample_rate,channels:format=duration", "-of", "json", path]).toString();

/** Halves a long line at the clause boundary nearest its middle. */
function halve(line: string): string[] {
  if (line.length <= MAX_CUE_CHARS) return [line];
  const breaks = [...line.matchAll(/(?<=,) | (?=(?:and|but|or|with|which|through|to|that|on|in|from) )/g)].map((m) => m.index);
  if (!breaks.length) return [line];
  const at = breaks.sort((a, b) => Math.abs(a - line.length / 2) - Math.abs(b - line.length / 2))[0];
  return [...halve(line.slice(0, at).trim()), ...halve(line.slice(at).trim())];
}

const splitCues = (text: string) => text.split(/(?<=[.?!:])\s+/).flatMap(halve);
const written = (text: string) => text.replace("three point one", "3.1");
const sceneStart = (id: string) => { let t = 0; for (const s of scenes) { if (s.id === id) return t; t += Math.round(s.dur * FPS) / FPS; } throw new Error(`Unknown scene ${id}`); };
const sceneLength = (id: string) => scenes.find((s) => s.id === id)!.dur;
const stamp = (t: number) => {
  const ms = Math.round(t * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};

const placements: { voice: string; file: string; start: number; end: number; trimBefore: number; trimAfter?: number }[] = [];
const cues: { start: number; end: number; text: string }[] = [];
const rows: string[] = [];
let spokenSeconds = 0, words = 0;

for (const voice of voiceScenes) {
  const path = join("public", voice.file);
  if (!existsSync(path)) { problems.push(`Missing ${voice.file}`); continue; }
  const info = JSON.parse(probe(path));
  const duration = Number(info.format.duration);
  const stream = info.streams[0];
  const own = voicePlacements.filter((p) => p.voice === voice.id);
  if (!own.length) problems.push(`${voice.id} is not placed on the timeline`);
  const timed = wordTimes[voice.id] ?? [];
  const spokenWords = voice.spoken.split(/\s+/);
  if (timed.map((w) => w.word).join(" ") !== spokenWords.join(" ")) problems.push(`${voice.id}: run npm run align, the word times do not match the text`);
  spokenSeconds += duration;
  words += spokenWords.length;
  rows.push(`${voice.file.padEnd(32)} ${duration.toFixed(2).padStart(6)} s  ${stream.codec_name} ${stream.sample_rate} Hz ${stream.channels === 1 ? "mono" : "stereo"}`);

  const parts = own.map((p) => {
    const from = p.from ?? 0, to = p.to ?? duration;
    const start = sceneStart(p.scene) + p.at, end = start + (to - from);
    if (p.at + (to - from) > sceneLength(p.scene)) problems.push(`${voice.id} overruns scene ${p.scene}`);
    placements.push({ voice: voice.id, file: voice.file, start, end, trimBefore: Math.round(from * FPS), trimAfter: p.to === undefined ? undefined : Math.round(to * FPS) });
    return { from, to, start };
  });
  const toTimeline = (t: number) => { const part = parts.find((p) => t < p.to) ?? parts[parts.length - 1]; return part.start + Math.min(t, part.to) - part.from; };

  let index = 0;
  for (const line of splitCues(voice.spoken)) {
    const count = line.split(/\s+/).length;
    const first = timed[index], last = timed[index + count - 1];
    index += count;
    if (!first || !last) continue;
    const text = written(line);
    if (text.length > MAX_CUE_CHARS) problems.push(`Cue too long: ${text}`);
    cues.push({ start: toTimeline(first.start), end: toTimeline(last.end) + HOLD_SECONDS, text });
  }
}

const ordered = [...placements].sort((a, b) => a.start - b.start);
ordered.forEach((p, i) => { if (i && p.start < ordered[i - 1].end) problems.push(`${p.voice} overlaps ${ordered[i - 1].voice}`); });
const videoSeconds = totalFrames / FPS;
if (videoSeconds > MAX_SECONDS) problems.push(`Video is ${videoSeconds.toFixed(1)} s, over ${MAX_SECONDS} s`);

cues.sort((a, b) => a.start - b.start);
cues.forEach((c, i) => { if (i + 1 < cues.length) c.end = Math.min(c.end, cues[i + 1].start); });
writeFileSync("src/voice-timing.json", `${JSON.stringify({ placements: ordered, cues }, null, 2)}\n`);
mkdirSync("subtitles", { recursive: true });
writeFileSync("subtitles/voiceover.en.srt", cues.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join("\n"));

console.log(rows.join("\n"));
console.log(`voice-over: ${spokenSeconds.toFixed(2)} s, ${words} words, ${cues.length} subtitle cues; video: ${videoSeconds.toFixed(2)} s`);
if (problems.length) { console.error(problems.join("\n")); process.exitCode = 1; }
