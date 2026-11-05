// Synthesizes the music bed and UI sounds, so that the demo needs no licensed audio.
// The output is deterministic and follows the scene timing in the manifest.
import { mkdirSync, writeFileSync } from "node:fs";
import { scenes, solveShots } from "../src/manifest.ts";

const RATE = 44100;
const TAU = Math.PI * 2;

function wav(path: string, left: Float32Array, right: Float32Array) {
  const data = Buffer.alloc(left.length * 4);
  for (let i = 0; i < left.length; i += 1) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[i])) * 32767), i * 4);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), i * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
  header.writeUInt32LE(RATE, 24); header.writeUInt32LE(RATE * 4, 28); header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([header, data]));
}

function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const note = (semitonesFromA: number, octave = 0) => 220 * 2 ** (semitonesFromA / 12 + octave);
const start = (id: string) => { let t = 0; for (const s of scenes) { if (s.id === id) return t; t += s.dur; } return t; };
const total = scenes.reduce((t, s) => t + s.dur, 0);

// The moment of relief: the shot where the corrected step is verified.
const solveStart = start("solve");
let verifiedAt = solveStart;
for (const shot of solveShots) { if (shot.id === "solve-verified") break; verifiedAt += shot.dur; }

// Intensity (0..1) as time/value points.
const curve: [number, number][] = [
  [0, 0.25], [start("problem"), 0.4], [start("product"), 0.5], [start("workflow"), 0.62], [solveStart, 0.72],
  [verifiedAt - 0.3, 0.98], [verifiedAt + 0.5, 0.72], [start("status"), 0.42], [start("ai"), 0.5],
  [start("completion"), 0.62], [start("completion") + 7, 0.95], [start("vision"), 0.3], [start("end"), 0.6], [total - 2, 0.5], [total, 0],
];
const intensity = (t: number) => {
  for (let i = 1; i < curve.length; i += 1) {
    const [t0, v0] = curve[i - 1], [t1, v1] = curve[i];
    if (t <= t1) return v0 + (v1 - v0) * ((t - t0) / Math.max(t1 - t0, 1e-6));
  }
  return 0;
};

const BAR = 2.5; // 96 BPM in 4/4
const minor = [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]]; // Am F C G
const major = [[3, 7, 10], [-2, 2, 5], [0, 3, 7], [-4, 0, 3]]; // C G Am F, after the relief
const chordAt = (t: number) => {
  const set = t >= verifiedAt ? major : minor;
  return set[Math.floor(t / BAR) % set.length];
};

const n = Math.ceil(total * RATE);
const L = new Float32Array(n), R = new Float32Array(n);
let lowL = 0, lowR = 0;
const rng = random(20261104);
const phases = Array.from({ length: 6 }, () => rng());
for (let i = 0; i < n; i += 1) {
  const t = i / RATE, level = intensity(t), chord = chordAt(t);
  let padL = 0, padR = 0;
  chord.forEach((semi, index) => {
    const f = note(semi, -1);
    const a = (t * f * 1.003 + phases[index]) % 1, b = (t * f * 0.997 + phases[index + 3]) % 1;
    padL += a * 2 - 1; padR += b * 2 - 1;
  });
  const cutoff = 0.012 + 0.05 * level;
  lowL += cutoff * (padL / 3 - lowL); lowR += cutoff * (padR / 3 - lowR);
  const barPos = t % BAR;
  const eighth = t % (BAR / 8), pulseEnv = Math.exp(-eighth * 9);
  const sub = Math.sin(TAU * note(chord[0], -2) * t) * pulseEnv * 0.55 * level;
  const kick = t % (BAR / 2) < 0.14 ? Math.sin(TAU * (45 + 90 * Math.exp(-(t % (BAR / 2)) * 40)) * t) * Math.exp(-(t % (BAR / 2)) * 16) * Math.max(0, level - 0.45) * 1.1 : 0;
  // A sparse arpeggio appears only as tension rises.
  const step = Math.floor(t / (BAR / 8)) % 8;
  const arpNote = note(chord[[0, 2, 1, 2, 0, 1, 2, 1][step]], 1);
  const arp = Math.sin(TAU * arpNote * t) * Math.exp(-eighth * 7) * Math.max(0, level - 0.3) * 0.2;
  const shimmer = Math.sin(TAU * note(chord[2], 2) * t) * (0.5 + 0.5 * Math.sin(TAU * t / BAR)) * 0.02;
  const swell = 0.7 + 0.3 * Math.sin(TAU * barPos / BAR / 2);
  L[i] = lowL * 0.75 * swell * (0.5 + level) + sub + kick + arp * 0.9 + shimmer;
  R[i] = lowR * 0.75 * swell * (0.5 + level) + sub + kick + arp * 1.1 + shimmer;
}
// Stereo echo for depth.
const delay = Math.floor(RATE * BAR * 3 / 16);
for (let i = delay; i < n; i += 1) { L[i] += R[i - delay] * 0.22; R[i] += L[i - delay] * 0.22; }
let peak = 0;
for (let i = 0; i < n; i += 1) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
for (let i = 0; i < n; i += 1) {
  const fade = Math.min(1, i / (RATE * 1.5), (n - i) / (RATE * 2));
  L[i] *= (0.85 / peak) * fade; R[i] *= (0.85 / peak) * fade;
}
mkdirSync("public/audio", { recursive: true });
wav("public/audio/music.wav", L, R);

function sfx(name: string, seconds: number, render: (t: number, noise: number) => number, gain = 0.8) {
  const out = new Float32Array(Math.floor(seconds * RATE));
  const r = random(name.length * 7919);
  for (let i = 0; i < out.length; i += 1) out[i] = render(i / RATE, r() * 2 - 1) * gain;
  wav(`public/audio/${name}.wav`, out, out);
}
let band = 0;
sfx("whoosh", 0.6, (t, noise) => {
  const x = t / 0.6;
  band += (0.02 + 0.3 * Math.sin(Math.PI * x)) * (noise - band);
  return band * Math.sin(Math.PI * x) ** 2 * 1.6;
}, 0.5);
sfx("tick", 0.09, (t) => Math.sin(TAU * 1760 * t) * Math.exp(-t * 60), 0.35);
sfx("confirm", 0.7, (t) => (Math.sin(TAU * note(7, 1) * t) * Math.exp(-t * 7) + (t > 0.11 ? Math.sin(TAU * note(12, 1) * t) * Math.exp(-(t - 0.11) * 5) : 0)) * 0.5, 0.6);
sfx("alert", 0.45, (t) => (Math.sin(TAU * 311 * t) + (t > 0.14 ? Math.sin(TAU * 233 * t) : 0)) * Math.exp(-t * 6) * 0.5, 0.55);
console.log(`audio written: ${total.toFixed(1)} s, relief at ${verifiedAt.toFixed(1)} s`);
