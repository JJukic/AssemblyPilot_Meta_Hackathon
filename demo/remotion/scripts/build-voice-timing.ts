// Measures the voice-over files, places them on the timeline from the manifest and writes the
// subtitles. Subtitle text comes only from src/voiceover.ts, so it cannot drift from the speech.
// Fails on a missing file, an overlap, a line that overruns its scene, or a video over 180 s.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FPS, MAX_SECONDS, scenes, totalFrames, voicePlacements } from "../src/manifest.ts";
import { voiceScenes } from "../src/voiceover.ts";

const MAX_CUE_CHARS = 96;
const SNAP_SECONDS = 1.2;
const problems: string[] = [];

const probe = (path: string) => execFileSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries",
  "stream=codec_name,sample_rate,channels:format=duration", "-of", "json", path]).toString();

function pauses(path: string) {
  const log = spawnSync("ffmpeg", ["-hide_banner", "-i", path, "-af", "silencedetect=noise=-40dB:d=0.3", "-f", "null", "-"]).stderr.toString();
  const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  return starts.map((start, i) => ({ start, end: ends[i] ?? start })).filter((p) => p.start > 0.05);
}

/** Halves a long line at the clause boundary nearest its middle. */
function halve(line: string): string[] {
  if (line.length <= MAX_CUE_CHARS) return [line];
  const breaks = [...line.matchAll(/(?<=,) | (?=(?:and|but|or|with|which) )/g)].map((m) => m.index);
  if (!breaks.length) return [line];
  const at = breaks.sort((a, b) => Math.abs(a - line.length / 2) - Math.abs(b - line.length / 2))[0];
  return [...halve(line.slice(0, at).trim()), ...halve(line.slice(at).trim())];
}

/** Splits at sentences, then at clauses. Only sentence starts may snap to a pause. */
function splitCues(text: string) {
  return text.split(/(?<=[.?!:])\s+/).flatMap((sentence) => halve(sentence).map((line, i) => ({ line, opensSentence: i === 0 })));
}

const sceneStart = (id: string) => { let t = 0; for (const s of scenes) { if (s.id === id) return t; t += Math.round(s.dur * FPS) / FPS; } throw new Error(`Unknown scene ${id}`); };
const sceneLength = (id: string) => scenes.find((s) => s.id === id)!.dur;
const stamp = (t: number) => {
  const ms = Math.round(t * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};

const placements: { voice: string; file: string; start: number; end: number; trimBefore: number; trimAfter?: number; sourceFrom: number }[] = [];
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
  spokenSeconds += duration;
  words += voice.spoken.split(/\s+/).length;
  rows.push(`${voice.file.padEnd(32)} ${duration.toFixed(2).padStart(6)} s  ${stream.codec_name} ${stream.sample_rate} Hz ${stream.channels === 1 ? "mono" : "stereo"}`);

  const parts = own.map((p) => {
    const from = (p.from ?? 0), to = p.to ?? duration;
    const start = sceneStart(p.scene) + p.at, end = start + (to - from);
    if (p.at + (to - from) > sceneLength(p.scene)) problems.push(`${voice.id} overruns scene ${p.scene}`);
    placements.push({ voice: voice.id, file: voice.file, start, end, trimBefore: Math.round(from * FPS), trimAfter: p.to === undefined ? undefined : Math.round(to * FPS), sourceFrom: from });
    return { from, to, start };
  });
  const toTimeline = (t: number) => { const part = parts.find((p) => t < p.to) ?? parts[parts.length - 1]; return part.start + Math.min(t, part.to) - part.from; };

  // Spread the text over the speech by character count, then snap each cue to a real pause.
  const silent = pauses(path);
  const speechTotal = duration - silent.reduce((t, p) => t + p.end - p.start, 0);
  const toFileTime = (speech: number) => { let t = speech; for (const p of silent) { if (t < p.start) break; t += p.end - p.start; } return t; };
  const lines = splitCues(voice.subtitle ?? voice.spoken);
  const totalChars = lines.reduce((t, l) => t + l.line.length, 0);
  let done = 0;
  const starts = lines.map(({ line, opensSentence }) => {
    let t = toFileTime((done / totalChars) * speechTotal);
    const near = silent.map((p) => p.end).sort((a, b) => Math.abs(a - t) - Math.abs(b - t))[0];
    if (done && opensSentence && near !== undefined && Math.abs(near - t) <= SNAP_SECONDS) t = near;
    done += line.length;
    return done - line.length ? t : 0;
  });
  lines.forEach(({ line: text }, i) => {
    const fileEnd = i + 1 < lines.length ? starts[i + 1] : duration;
    const pause = silent.find((p) => p.end === fileEnd);
    cues.push({ start: toTimeline(starts[i]), end: toTimeline(pause ? pause.start : fileEnd), text });
  });
}

const ordered = [...placements].sort((a, b) => a.start - b.start);
ordered.forEach((p, i) => { if (i && p.start < ordered[i - 1].end) problems.push(`${p.voice} overlaps ${ordered[i - 1].voice}`); });
const videoSeconds = totalFrames / FPS;
if (videoSeconds > MAX_SECONDS) problems.push(`Video is ${videoSeconds.toFixed(1)} s, over ${MAX_SECONDS} s`);

cues.sort((a, b) => a.start - b.start);
writeFileSync("src/voice-timing.json", `${JSON.stringify({ placements: ordered, cues }, null, 2)}\n`);
mkdirSync("subtitles", { recursive: true });
writeFileSync("subtitles/voiceover.en.srt", cues.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join("\n"));

console.log(rows.join("\n"));
console.log(`voice-over: ${spokenSeconds.toFixed(2)} s, ${words} words, ${cues.length} subtitle cues; video: ${videoSeconds.toFixed(2)} s`);
if (problems.length) { console.error(problems.join("\n")); process.exitCode = 1; }
