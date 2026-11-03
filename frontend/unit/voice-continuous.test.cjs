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
    return { matched: true, action: "show-result", phrase: "show result", language: "en", transcript: "Show result", duration_seconds: 1 };
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
  assert.deepEqual(got, ["show-result", "show-result"]);
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
    api: fakeApi(["the weather is nice", "Show result"]),
    captureFactory: () => capture,
    onCommand: async (c) => { got.push(c.action); return { ok: true }; },
    onDiagnostic: (d) => diagnostics.push(d),
  });
  await controller.start();
  capture.push();
  capture.push();
  await sleep(40);
  assert.deepEqual(got, ["show-result"]);
  assert.equal(diagnostics[0].state, "rejected");
  assert.equal(diagnostics.at(-1).state, "completed");
  controller.dispose();
});

test("XR entry keeps the same stream, suspended audio is reported honestly, exit/stop releases it", async () => {
  const capture = new FakeCapture();
  const statuses = [];
  const captureDiags = [];
  const controller = new LocalVoiceController({
    api: fakeApi(["Show result"]),
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
    return { matched: true, action: "show-result", phrase: "show result", language: "en", transcript: "Show result", duration_seconds: 1 };
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
    api: fakeApi(["Recenter"]),
    captureFactory: () => capture,
    onCommand: async (c) => { got.push(c.action); return { ok: true }; },
  });
  capture.push();
  await controller.recordOnce();
  assert.deepEqual(got, ["recenter"]);
  assert.equal(capture.releases, 1, "one-shot capture is released after the command");
  controller.dispose();

  const live = new FakeCapture();
  const liveController = new LocalVoiceController({
    api: fakeApi(["Show result"]),
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

/* ---------- In-AR voice (panel Start/Stop Voice) ---------- */
const { voicePanel, voiceToggle, VOICE_CONSENT_TEXT } = require("../src/lib/ar/voicePanel.ts");

test("AR voice: started inside AR (after entry), every panel command executes once on one stream; Stop Voice releases the mic", async () => {
  const capture = new FakeCapture();
  const got = [];
  const listening = [];
  const controller = new LocalVoiceController({
    api: fakeApi(["Next Step", "Previous Step", "More Text", "Previous Text", "Check Step", "Check Again",
      "Start Autonomous", "Pause Autonomous", "Resume Autonomous", "Stop Autonomous", "Confirm Assembly Field",
      "Reset Panel Position", "Show Result", "Show Instructions", "Exit AR"]),
    captureFactory: () => capture,
    onCommand: async (cmd) => { got.push(cmd.action); return { ok: true }; },
    onListeningChange: (l) => listening.push(l),
  });
  assert.equal(capture.starts, 0, "nothing records before Start Voice");
  assert.equal(await controller.start(), true);
  controller.setXRActive(true); // ARWorkspace does this when started while a session is active
  for (let i = 0; i < 15; i++) {
    capture.push();
    for (let k = 0; k < 6 && got.length <= i; k++) await sleep(5);
  }
  assert.deepEqual(got, ["next", "previous", "more-text", "previous-text", "verify", "verify-again", "auto-start", "auto-pause",
    "auto-resume", "auto-stop", "confirm-field", "recenter", "show-result", "show-instructions", "exit"]);
  assert.equal(capture.starts, 1, "the microphone is not restarted between commands");
  controller.stop();
  assert.equal(capture.releases, 1, "Stop Voice releases the microphone");
  assert.equal(controller.isListening, false);
  assert.equal(listening.at(-1), false);
});

test("AR voice: Whisper backend unreachable and mic permission denied are explicit errors, never a silent Off", async () => {
  const errors = [];
  const down = new LocalVoiceController({
    api: { ...fakeApi(["x"]), createSession: async () => { throw new TypeError("Failed to fetch"); } },
    captureFactory: () => new FakeCapture(),
    onCommand: async () => ({ ok: true }),
    onError: (e) => errors.push(e),
  });
  assert.equal(await down.start(), false);
  assert.match(errors.at(-1), /local voice session|backend/i);
  const view = voicePanel({ listening: false, busy: false, consentPending: false, processing: false, error: errors.at(-1), diagnostic: null });
  assert.equal(view.tone, "error");
  assert.match(view.line, /^Voice error: /);
  assert.equal(view.button, "Start Voice", "retry possible");

  const denied = new FakeCapture();
  denied.start = async () => { const e = new Error("denied"); e.name = "NotAllowedError"; throw e; };
  const micErrors = [];
  const noMic = new LocalVoiceController({
    api: fakeApi(["x"]), captureFactory: () => denied, onCommand: async () => ({ ok: true }), onError: (e) => micErrors.push(e),
  });
  assert.equal(await noMic.start(), false);
  assert.match(micErrors.at(-1), /permission/i);
  assert.equal(noMic.isListening, false);
});

test("AR voice: consent is explicit (two taps), and the panel shows Listening / Processing / Heard → Executed", () => {
  assert.equal(voiceToggle({ listening: false, busy: false, consented: false, consentPending: false }), "ask-consent");
  assert.equal(voiceToggle({ listening: false, busy: false, consented: false, consentPending: true }), "start");
  assert.equal(voiceToggle({ listening: false, busy: false, consented: true, consentPending: false }), "start");
  assert.equal(voiceToggle({ listening: false, busy: true, consented: true, consentPending: false }), "busy");
  assert.equal(voiceToggle({ listening: true, busy: false, consented: true, consentPending: false }), "stop");
  const base = { listening: false, busy: false, consentPending: false, processing: false, error: "", diagnostic: null };
  assert.deepEqual(voicePanel(base), { line: "Voice: Off", tone: "idle", button: "Start Voice" });
  assert.equal(voicePanel({ ...base, consentPending: true }).line, VOICE_CONSENT_TEXT);
  assert.match(VOICE_CONSENT_TEXT, /not stored/);
  assert.equal(voicePanel({ ...base, consentPending: true }).button, "Confirm Voice");
  assert.equal(voicePanel({ ...base, listening: true }).line, "Voice: Listening");
  assert.equal(voicePanel({ ...base, listening: true, processing: true }).line, "Voice: Processing");
  const done = voicePanel({ ...base, listening: true, diagnostic: { transcript: "Next Step", action: "next", state: "completed", detail: "Step 2 → 3" } });
  assert.equal(done.line, "Voice: Listening · Heard “Next Step” → Executed: Step 2 → 3");
  assert.equal(done.button, "Stop Voice");
  const unknown = voicePanel({ ...base, listening: true, diagnostic: { transcript: "hello there", action: null, state: "unmatched" } });
  assert.match(unknown.line, /not a command/);
  const failed = voicePanel({ ...base, listening: true, diagnostic: { transcript: "Pause Autonomous", action: "auto-pause", state: "failed", reason: "Autonomous is not running" } });
  assert.match(failed.line, /Not executed: Autonomous is not running/);
});

test("AR voice: a failing dispatch (e.g. during Autonomous) never stops listening; the next command still runs", async () => {
  const capture = new FakeCapture();
  const got = [];
  const controller = new LocalVoiceController({
    api: fakeApi(["Pause Autonomous", "Show Result"]),
    captureFactory: () => capture,
    onCommand: async (cmd) => { got.push(cmd.action); if (cmd.action === "auto-pause") throw new Error("runner busy"); return { ok: true }; },
  });
  await controller.start();
  controller.setXRActive(true);
  capture.push();
  for (let k = 0; k < 10 && got.length < 1; k++) await sleep(5);
  capture.push();
  for (let k = 0; k < 10 && got.length < 2; k++) await sleep(5);
  assert.deepEqual(got, ["auto-pause", "show-result"]);
  assert.equal(controller.isListening, true);
  controller.stop();
});
