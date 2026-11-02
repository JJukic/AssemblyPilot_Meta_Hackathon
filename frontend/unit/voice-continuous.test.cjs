/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS harness transpiles TS modules. */
/* Continuous in-AR voice: persistent stream, capture-during-processing, XR lifecycle. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    filename,
  );
const { LocalVoiceController, PersistentMicCapture } = require("../src/lib/ar/voiceLocal.ts");
const { matchCommand } = require("../src/lib/ar/voice.ts");

const flush = () => new Promise((r) => setImmediate(r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}
const loud = () => ({ samples: new Float32Array(16000).fill(0.5), sampleRate: 16000, durationMs: 1000, rms: 0.5 });

class FakeCapture {
  constructor() {
    this.queue = [];
    this.waiters = [];
    this.starts = 0;
    this.releases = 0;
    this.flushes = 0;
    this.ensureCalls = 0;
    this.healthState = { mic: "active", trackState: "live", trackMuted: false, contextState: "running", bufferedSamples: 0, totalSamples: 0, lastRms: 0.5, utterances: 0 };
  }
  async start() { this.starts++; }
  release() {
    this.releases++;
    this.waiters.splice(0).forEach((w) => w(null));
  }
  flush() { this.flushes++; }
  health() { return { ...this.healthState, bufferedSamples: this.queue.reduce((n, u) => n + u.samples.length, 0) }; }
  async ensureAlive() { this.ensureCalls++; return this.healthState.mic === "active"; }
  push(u = loud()) {
    const w = this.waiters.shift();
    if (w) w(u);
    else this.queue.push(u);
  }
  nextUtterance() {
    const q = this.queue.shift();
    if (q) return Promise.resolve(q);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 5);
      this.waiters.push((u) => { clearTimeout(timer); resolve(u); });
    });
  }
}

function fakeApi(transcripts, transcribeImpl) {
  let i = 0;
  const calls = [];
  return {
    calls,
    createSession: async () => ({ token: "tok" }),
    revokeSession: async () => { calls.push("revoked"); },
    status: async () => ({ available: true, engine: "fake", model: "tiny", reason: "" }),
    transcribe: async (...args) => {
      calls.push("transcribe");
      if (transcribeImpl) return transcribeImpl(...args);
      const t = transcripts[Math.min(i++, transcripts.length - 1)];
      const m = matchCommand(t);
      return { matched: !!m, action: m?.action ?? null, phrase: m?.phrase ?? null, language: m?.language ?? null, transcript: t, duration_seconds: 1 };
    },
  };
}

test("continuous: speech during transcription is buffered and both consecutive commands execute in order", async () => {
  const capture = new FakeCapture();
  const gate = deferred();
  let transcribeCalls = 0;
  const api = fakeApi([], async () => {
    transcribeCalls++;
    if (transcribeCalls === 1) await gate.promise;
    return { matched: true, action: "next", phrase: "next step", language: "en", transcript: "Next step", duration_seconds: 1 };
  });
  const got = [];
  const controller = new LocalVoiceController({
    api,
    captureFactory: () => capture,
    onCommand: async (c) => { got.push(c.action); return { ok: true }; },
  });
  assert.equal(await controller.start(), true);
  capture.push();
  await sleep(20);
  assert.equal(transcribeCalls, 1);
  assert.equal(controller.isProcessing, true);
  capture.push(); // spoken while Whisper is busy — must not be lost
  gate.resolve();
  await sleep(30);
  assert.deepEqual(got, ["next", "next"]);
  assert.equal(transcribeCalls, 2);
  assert.equal(capture.starts, 1, "one persistent stream for the whole session");
  controller.stop();
  assert.equal(capture.releases, 1);
  assert.ok(api.calls.includes("revoked"));
});

test("continuous: unknown phrase is reported and the next command still executes", async () => {
  const capture = new FakeCapture();
  const diagnostics = [];
  const got = [];
  const controller = new LocalVoiceController({
    api: fakeApi(["the weather is nice", "Next step"]),
    captureFactory: () => capture,
    onCommand: async (c) => { got.push(c.action); return { ok: true }; },
    onDiagnostic: (d) => diagnostics.push(d),
  });
  await controller.start();
  capture.push();
  capture.push();
  await sleep(40);
  assert.deepEqual(got, ["next"]);
  assert.equal(diagnostics[0].state, "rejected");
  assert.equal(diagnostics.at(-1).state, "completed");
  controller.dispose();
});

test("XR entry keeps the same stream, suspended audio is reported honestly, exit/stop releases it", async () => {
  const capture = new FakeCapture();
  const statuses = [];
  const captureDiags = [];
  const controller = new LocalVoiceController({
    api: fakeApi(["Next step"]),
    captureFactory: () => capture,
    onCommand: async () => ({ ok: true }),
    onStatus: (s) => statuses.push(s),
    onCaptureDiagnostic: (d) => captureDiags.push(d),
  });
  await controller.start();
  controller.setXRActive(true);
  await flush();
  assert.equal(capture.ensureCalls, 1, "XR entry resumes/repairs in place");
  assert.equal(capture.starts, 1, "XR entry must not re-acquire the microphone");
  assert.equal(controller.inXR, true);
  // Suspended context: health poll must not keep claiming "Listening".
  capture.healthState = { ...capture.healthState, mic: "suspended", contextState: "suspended" };
  await sleep(40);
  assert.ok(captureDiags.some((d) => d.mic === "suspended"));
  assert.ok(statuses.some((s) => s.includes("Microphone suspended")));
  controller.stop(); // AR exit path in ARWorkspace calls stop via session end
  assert.equal(capture.releases, 1);
  assert.equal(controller.isListening, false);
});

test("continuous: stop during transcription discards the late result", async () => {
  const capture = new FakeCapture();
  const gate = deferred();
  const got = [];
  const api = fakeApi([], async () => {
    await gate.promise;
    return { matched: true, action: "next", phrase: "next step", language: "en", transcript: "Next step", duration_seconds: 1 };
  });
  const controller = new LocalVoiceController({
    api,
    captureFactory: () => capture,
    onCommand: async (c) => { got.push(c.action); },
  });
  await controller.start();
  capture.push();
  await sleep(15);
  controller.stop();
  gate.resolve();
  await sleep(15);
  assert.deepEqual(got, []);
  assert.equal(capture.releases, 1);
});

test("push-to-talk: one-shot outside continuous mode executes once and releases capture; flush while listening", async () => {
  const capture = new FakeCapture();
  const got = [];
  const controller = new LocalVoiceController({
    api: fakeApi(["Previous step"]),
    captureFactory: () => capture,
    onCommand: async (c) => { got.push(c.action); return { ok: true }; },
  });
  capture.push();
  await controller.recordOnce();
  assert.deepEqual(got, ["previous"]);
  assert.equal(capture.releases, 1, "one-shot capture is released after the command");
  controller.dispose();

  const live = new FakeCapture();
  const liveController = new LocalVoiceController({
    api: fakeApi(["Next step"]),
    captureFactory: () => live,
    onCommand: async () => ({ ok: true }),
  });
  await liveController.start();
  await liveController.pushToTalk();
  assert.equal(live.flushes, 1);
  liveController.dispose();
});

test("persistent capture: one getUserMedia, VAD segmentation, suspended resume, ended-track recovery, release", async () => {
  let gumCalls = 0;
  let closed = 0;
  let processor;
  const tracks = [];
  const makeTrack = () => {
    const track = { readyState: "live", muted: false, stopped: 0, onended: null, stop() { this.stopped++; this.readyState = "ended"; } };
    tracks.push(track);
    return track;
  };
  class FakeContext {
    constructor() {
      this.state = "suspended";
      this.sampleRate = 48000;
      this.destination = {};
    }
    async resume() { this.state = "running"; }
    async close() { closed++; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createScriptProcessor() {
      processor = { onaudioprocess: null, connect() {}, disconnect() {} };
      return processor;
    }
  }
  const capture = new PersistentMicCapture({
    getUserMedia: async () => {
      gumCalls++;
      const track = makeTrack();
      return { getTracks: () => [track], getAudioTracks: () => [track] };
    },
    audioContext: FakeContext,
  });
  await capture.start();
  await capture.start();
  assert.equal(gumCalls, 1, "stream acquired once");
  assert.equal(capture.health().mic, "active", "suspended context is resumed at start");
  const feed = (level) => processor.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(4096).fill(level) } });
  feed(0.5); feed(0.5);
  for (let i = 0; i < 9; i++) feed(0);
  const first = await capture.nextUtterance(50);
  assert.ok(first.samples.length > 1200);
  feed(0.5);
  for (let i = 0; i < 9; i++) feed(0);
  const second = await capture.nextUtterance(50);
  assert.ok(second.samples.length > 1200);
  assert.equal(gumCalls, 1, "utterances share the same stream");
  // Ended track (e.g. interrupted at XR entry) recovers with one re-acquire.
  tracks[0].readyState = "ended";
  assert.equal(await capture.ensureAlive(), true);
  assert.equal(gumCalls, 2);
  capture.release();
  assert.equal(tracks.at(-1).stopped, 1);
  assert.ok(closed >= 1);
  assert.equal(capture.health().mic, "off");
});
