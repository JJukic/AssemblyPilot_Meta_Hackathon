/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS harness transpiles TS modules. */
/* Local Whisper voice: WAV encoding, bounded loop, duplicates, cleanup, intent freshness. */
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
// api.ts reads process.env only; safe in Node.
const { encodeWav, downsample, rms, LocalVoiceController, recordMicClip } = require("../src/lib/ar/voiceLocal.ts");
const { matchCommand } = require("../src/lib/ar/voice.ts");
const {
  saveVoiceVerifyIntent,
  readVoiceVerifyIntent,
  clearVoiceVerifyIntent,
  isFreshFrame,
} = require("../src/lib/ar/voiceVerify.ts");

test("WAV encoder emits a valid 16 kHz mono header and PCM payload", () => {
  const wav = encodeWav(new Float32Array([0, 0.5, -0.5, 1]), 16000);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...wav.slice(8, 12)), "WAVE");
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(wav.length, 44 + 8);
  assert.equal(rms(new Float32Array([0, 0])), 0);
  assert.equal(downsample(new Float32Array(32000), 32000, 16000).length, 16000);
});

test("verify-again is an allowlisted command in English and German", () => {
  assert.equal(matchCommand("Verify again").action, "verify-again");
  assert.equal(matchCommand("Erneut prüfen").action, "verify-again");
  assert.equal(matchCommand("verify"), null);
});

function fakeController(transcripts, onCommand) {
  let clip = 0;
  let transcription = 0;
  const cleaned = [];
  const api = {
    createSession: async () => ({ token: "tok" }),
    revokeSession: async () => { cleaned.push("revoked"); },
    status: async () => ({ available: true, engine: "fake", model: "tiny", reason: "" }),
    transcribe: async () => {
      const t = transcripts[Math.min(transcription++, transcripts.length - 1)];
      const m = matchCommand(t);
      return { matched: !!m, action: m?.action ?? null, phrase: m?.phrase ?? null, language: m?.language ?? null, transcript: t, duration_seconds: 1 };
    },
  };
  const controller = new LocalVoiceController({
    api,
    recordClip: async () => {
      clip++;
      return {
        samples: new Float32Array(16000).fill(0.5),
        sampleRate: 16000,
        stream: {},
        cleanup: () => cleaned.push(`clip${clip}`),
      };
    },
    onCommand,
  });
  return { controller, cleaned, clips: () => clip };
}

test("one action per clip: consecutive legitimate repeats execute; pending blocks overlap", async () => {
  const got = [];
  const { controller, cleaned } = fakeController(["Next step", "Next step"], async (c) => got.push(c.action));
  await controller.recordOnce();
  await controller.recordOnce(); // a new clip is a new utterance: executes again
  assert.deepEqual(got, ["next", "next"]);
  controller.stop();
  assert.ok(cleaned.includes("revoked"));
  assert.equal(controller.isListening, false);

  // While an action is pending, a further clip is rejected explicitly.
  let release;
  const statuses = [];
  const slow = fakeController(["Next step", "Next step"], () => new Promise((r) => { release = r; }));
  slow.controller.deps.onStatus = (s) => statuses.push(s);
  const first = slow.controller.recordOnce();
  await new Promise((r) => setTimeout(r, 20));
  await slow.controller.recordOnce();
  assert.equal(slow.clips(), 1);
  assert.match(statuses.at(-1), /already recording, processing or executing/);
  release({ ok: true });
  await first;
  slow.controller.dispose();
});

test("microphone permission failure never loops and reports honestly", async () => {
  const errors = [];
  const controller = new LocalVoiceController({
    api: {
      createSession: async () => ({ token: "t" }),
      revokeSession: async () => {},
      status: async () => ({ available: true, engine: "fake", model: "tiny", reason: "" }),
      transcribe: async () => { throw new Error("should not be called"); },
    },
    recordClip: async () => { const e = new Error("denied"); e.name = "NotAllowedError"; throw e; },
    onCommand: () => {},
    onError: (m) => errors.push(m),
  });
  await controller.recordOnce();
  assert.ok(errors[0].includes("permission was denied"));
  controller.dispose();
});

test("voice verify intent is project/step scoped, fresh-only and expirable", () => {
  const store = new Map();
  global.window = { sessionStorage: {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  } };
  const now = Date.now();
  saveVoiceVerifyIntent({ mode: "verify", projectId: "p1", stepId: "s1", requestedAt: new Date(now).toISOString() });
  assert.equal(readVoiceVerifyIntent("p1", "s1", now)?.mode, "verify");
  assert.equal(readVoiceVerifyIntent("p2", "s1", now), null);
  assert.equal(readVoiceVerifyIntent("p1", "s2", now), null);
  assert.equal(readVoiceVerifyIntent("p1", "s1", now + 121000), null);
  assert.equal(isFreshFrame(new Date(now + 1000).toISOString(), new Date(now).toISOString()), true);
  assert.equal(isFreshFrame(new Date(now - 1000).toISOString(), new Date(now).toISOString()), false);
  clearVoiceVerifyIntent();
  assert.equal(readVoiceVerifyIntent("p1", "s1", now), null);
  delete global.window;
});

test("frontend matcher matches the shared parity fixture exactly", () => {
  const fixture = JSON.parse(fs.readFileSync(__dirname + "/../src/lib/ar/voice-commands.json", "utf8"));
  for (const [phrase, action, language] of fixture.accepted) {
    const matched = matchCommand(phrase);
    assert.ok(matched, phrase);
    assert.equal(matched.action, action, phrase);
    assert.equal(matched.language, language, phrase);
  }
  for (const phrase of fixture.rejected) assert.equal(matchCommand(phrase), null, phrase);
});

test("diagnostics: unmatched, duplicate and failed outcomes are explicit", async () => {
  const diagnostics = [];
  const { controller } = fakeController(["the weather is nice"], async () => ({ ok: true }));
  controller.deps.onDiagnostic = (d) => diagnostics.push(d);
  await controller.recordOnce();
  assert.equal(diagnostics.at(-1).state, "rejected");
  assert.equal(diagnostics.at(-1).reason, "Phrase not recognized");

  const failing = fakeController(["Next step"], async () => ({ ok: false, reason: "Already at last step" }));
  failing.controller.deps.onDiagnostic = (d) => diagnostics.push(d);
  await failing.controller.recordOnce();
  assert.equal(diagnostics.at(-1).state, "failed");
  assert.equal(diagnostics.at(-1).reason, "Already at last step");
});

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
const flush = () => new Promise(r => setImmediate(r));

function microphone(t) {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const processor = { onaudioprocess: null, connect() {}, disconnect() {} };
  let stopped = 0;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() { stopped++; } }] }) },
  } });
  globalThis.window = { AudioContext: class {
    state = "running";
    sampleRate = 48000;
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createScriptProcessor() { return processor; }
    async resume() {}
    async close() {}
  } };
  t.after(() => {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete globalThis.navigator;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else delete globalThis.window;
  });
  return {
    stopped: () => stopped,
    feed(level) { processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(4096).fill(level) } }); },
  };
}

test("recording keeps the full working window after a click/pause before quiet speech", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const mic = microphone(t);
  let completed = false;
  const recording = recordMicClip(4000).then(clip => { completed = true; return clip; });
  await flush();
  mic.feed(0.04); // A click, breath, or the first word exceeds the old VAD threshold.
  for (let i = 0; i < 10; i++) { mic.feed(0); t.mock.timers.tick(85); await flush(); }
  assert.equal(completed, false, "700 ms of silence must not terminate the four-second window");
  // Quiet speech is valid input even though it is below the removed 0.02 VAD threshold.
  for (let i = 0; i < 12; i++) mic.feed(0.015);
  t.mock.timers.tick(3150);
  const clip = await recording;
  assert.equal(clip.samples.length, 23 * 4096);
  assert.ok(Math.abs(clip.samples.at(-1) - 0.015) < 0.0001);
  assert.equal(mic.stopped(), 1, "release the microphone before transcription starts");
  clip.cleanup(); assert.equal(mic.stopped(), 1);
});

test("overlapping record requests share one clip; a subsequent intentional repeat executes", async () => {
  const ready = deferred(); let recordings = 0;
  const got = [];
  const { controller } = fakeController(["Next step"], async c => got.push(c.action));
  controller.deps.recordClip = async () => {
    recordings++; await ready.promise;
    return { samples: new Float32Array(16000).fill(0.1), sampleRate: 16000, cleanup() {} };
  };
  const first = controller.recordOnce(), duplicate = controller.recordOnce();
  await flush();
  assert.equal(recordings, 1, "lock must cover session creation and audio capture, not just dispatch");
  ready.resolve(); await Promise.all([first, duplicate]);
  assert.deepEqual(got, ["next"]);
  await controller.recordOnce();
  assert.deepEqual(got, ["next", "next"]);
  controller.dispose();
});

test("stop discards an in-flight Whisper result before it can dispatch", async () => {
  const result = deferred(), got = [];
  const { controller } = fakeController(["Next step"], async c => got.push(c.action));
  controller.api.transcribe = () => result.promise;
  const pending = controller.recordOnce(); await flush();
  controller.stop();
  result.resolve({ matched: true, action: "next", phrase: "next step", transcript: "Next step", language: "en" });
  await pending;
  assert.deepEqual(got, [], "a stopped session must never execute a late response");
});

test("stop during session creation revokes late tokens and never opens the microphone", async () => {
  const session = deferred(), revoked = [];
  const { controller, clips } = fakeController(["next step"], async () => {});
  controller.api.createSession = () => session.promise;
  controller.api.revokeSession = async token => revoked.push(token);
  const starting = controller.start();
  assert.equal(await controller.start(), false);
  controller.stop(); session.resolve({ token: "late-token" });
  assert.equal(await starting, false);
  assert.equal(clips(), 0); assert.equal(controller.isListening, false);
  assert.deepEqual(revoked, ["late-token"]);
});

test("aborting an active recording releases tracks without waiting for the window", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const mic = microphone(t), abort = new AbortController();
  const recording = recordMicClip(4000, abort.signal);
  await flush(); mic.feed(0.05);
  abort.abort();
  await assert.rejects(recording, { name: "AbortError" });
  assert.equal(mic.stopped(), 1);
  t.mock.timers.tick(4000); assert.equal(mic.stopped(), 1);
});

test("late microphone permission is released after cancellation", async t => {
  microphone(t);
  const permission = deferred(), abort = new AbortController(); let stopped = 0;
  navigator.mediaDevices.getUserMedia = () => permission.promise;
  const recording = recordMicClip(4000, abort.signal);
  abort.abort(); permission.resolve({ getTracks: () => [{ stop() { stopped++; } }] });
  await assert.rejects(recording, { name: "AbortError" });
  assert.equal(stopped, 1);
});

test("a normalized backend phrase cannot override rejected raw speech", async () => {
  const got = [], diagnostics = [];
  const { controller } = fakeController([], async c => got.push(c.action));
  controller.api.transcribe = async () => ({ matched: true, action: "next", phrase: "next step", transcript: "do not go to next step", language: "en" });
  controller.deps.onDiagnostic = d => diagnostics.push(d);
  await controller.recordOnce();
  assert.deepEqual(got, []);
  assert.match(diagnostics.at(-1).reason, /Frontend validation rejected/);
  controller.stop();
});

test("the selected Whisper language and raw transcript survive through dispatch diagnostics", async () => {
  const diagnostics = [], got = [];
  const { controller } = fakeController([], async c => { got.push(c.action); return { ok: true }; });
  controller.deps.language = "de";
  controller.deps.onDiagnostic = d => diagnostics.push(d);
  controller.api.transcribe = async (_blob, _token, language) => {
    assert.equal(language, "de");
    return { matched: true, action: "next", phrase: "naechster schritt", transcript: "Nächster Schritt!", language: "de" };
  };
  await controller.recordOnce();
  assert.deepEqual(got, ["next"]);
  assert.equal(diagnostics.at(-1).transcript, "Nächster Schritt!");
  assert.equal(diagnostics.at(-1).state, "completed");
  controller.stop();
});
