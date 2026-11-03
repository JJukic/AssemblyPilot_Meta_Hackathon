/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS harness transpiles TS. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText, filename);
const { VoiceController, detectSpeechSupport, probeMicrophone } = require("../src/lib/ar/voice.ts");

class Recognition {
  starts = 0; stops = 0; aborts = 0;
  start() { this.starts++; }
  stop() { this.stops++; }
  abort() { this.aborts++; }
}
function setup(create, options) {
  const rec = new Recognition(), states = [], commands = [];
  const controller = new VoiceController(create ?? (() => rec), {
    onStateChange: (s) => states.push(s), onCommand: (c) => commands.push(c.action),
  }, options);
  return { rec, states, commands, controller };
}

test("Starting is not Listening; duplicate starts and pre-start results are ignored", () => {
  const { rec, controller, commands, states } = setup();
  controller.start();
  assert.equal(controller.status.state, "starting");
  assert.equal(controller.isListening, false);
  assert.equal(controller.start(), false);
  rec.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "show result" } }] });
  assert.deepEqual(commands, []);
  rec.onstart();
  assert.equal(controller.isListening, true);
  assert.deepEqual(states.map(s => s.state), ["starting", "listening"]);
  controller.dispose();
});

for (const error of ["not-allowed", "service-not-allowed", "audio-capture", "network", "language-not-supported", "no-speech", "aborted"]) {
  test(`${error} survives onend, stop, dispose and late onstart without retries`, () => {
    const { rec, controller } = setup();
    controller.start();
    const end = rec.onend, start = rec.onstart;
    rec.onerror({ error });
    const snapshot = controller.status;
    end(); start(); controller.stop(); controller.dispose();
    assert.equal(controller.status, snapshot);
    assert.equal(snapshot.state, "error");
    assert.equal(snapshot.errorCode, error);
    assert.ok(snapshot.message.includes(error));
    assert.equal(rec.starts, 1);
    assert.equal(controller.isListening, false);
    assert.equal(rec.onstart, null);
  });
}

test("synchronous error followed by end in start never claims Listening", () => {
  const rec = new Recognition();
  rec.start = function () { this.starts++; const end = this.onend; this.onerror({ error: "service-not-allowed" }); end(); };
  const { controller, states } = setup(() => rec);
  assert.equal(controller.start(), false);
  assert.deepEqual(states.map(s => s.state), ["starting", "error"]);
  assert.equal(controller.status.errorCode, "service-not-allowed");
});

test("constructor and start exceptions retain the browser exception", () => {
  for (const ctorThrows of [true, false]) {
    const rec = new Recognition();
    const fail = () => { throw new DOMException("Policy blocked", "NotAllowedError"); };
    if (!ctorThrows) rec.start = fail;
    const { controller } = setup(ctorThrows ? fail : () => rec);
    assert.equal(controller.start(), false);
    assert.equal(controller.status.state, "error");
    assert.match(controller.status.message, /NotAllowedError.*Policy blocked/);
  }
});

test("unexpected end before/after startup is an explicit persistent error", () => {
  for (const started of [false, true]) {
    const { rec, controller } = setup(); controller.start();
    if (started) rec.onstart();
    rec.onend();
    assert.equal(controller.status.errorCode, started ? "unexpected-end" : "ended-before-start");
    assert.equal(rec.starts, 1);
    assert.equal(controller.isListening, false);
    controller.dispose();
  }
});

test("configuration exceptions and additional browser diagnostics remain visible", () => {
  const rec = new Recognition();
  Object.defineProperty(rec, "lang", { set() { throw new Error("Unsupported locale"); } });
  const { controller } = setup(() => rec);
  assert.equal(controller.start(), false);
  assert.equal(controller.status.errorCode, "configuration-failed");
  assert.match(controller.status.message, /Unsupported locale/);
  const normal = setup(); normal.controller.start();
  normal.rec.onerror({ error: "network", message: "Service connection refused" });
  assert.match(normal.controller.status.message, /Service connection refused/);
  normal.controller.dispose();
});

test("startup deadline ends an unconfirmed session and ignores a late start", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { rec, controller } = setup(undefined, { startupTimeoutMs: 100 });
  controller.start(); const start = rec.onstart;
  t.mock.timers.tick(100);
  assert.equal(controller.status.errorCode, "startup-timeout");
  start(); assert.equal(controller.isListening, false);
  assert.equal(rec.aborts, 1);
});

test("stop waits for end, blocks commands and never restarts; missing end is bounded", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const emitEnd of [true, false]) {
    const { rec, controller, commands } = setup(undefined, { stopTimeoutMs: 100 });
    controller.start(); rec.onstart(); controller.stop();
    assert.equal(controller.status.state, "stopping");
    rec.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "show reference" } }] });
    assert.deepEqual(commands, []);
    rec.onerror({ error: "aborted" });
    if (emitEnd) rec.onend(); else t.mock.timers.tick(100);
    assert.equal(controller.status.state, "off");
    assert.equal(rec.starts, 1);
    controller.dispose();
  }
});

test("explicit retry releases old callbacks and duplicate finalized results stay suppressed", () => {
  const first = new Recognition(), second = new Recognition(); let calls = 0;
  const { controller, commands } = setup(() => ++calls === 1 ? first : second);
  controller.start(); const oldStart = first.onstart, oldEnd = first.onend;
  first.onerror({ error: "network" });
  controller.start(); oldStart(); oldEnd();
  assert.equal(controller.status.state, "starting");
  second.onstart();
  const event = { resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "show result" } }] };
  second.onresult(event); controller.gate.reset(); second.onresult(event);
  assert.deepEqual(commands, ["show-result"]);
  controller.dispose();
});

test("unsupported API is honest and constructor detection rejects non-callable values", () => {
  const { controller } = setup(() => null);
  assert.equal(controller.start(), false);
  assert.equal(controller.status.state, "unsupported");
  assert.equal(detectSpeechSupport({ SpeechRecognition: {} }).supported, false);
  assert.equal(detectSpeechSupport({ webkitSpeechRecognition: Recognition }).apiName, "webkitSpeechRecognition");
  assert.equal(detectSpeechSupport({ SpeechRecognition: Recognition, webkitSpeechRecognition: Recognition }).apiName, "SpeechRecognition");
});

test("microphone probe is separate, audio-only, and stops every returned track", async () => {
  let calls = 0, stops = 0;
  const track = { readyState: "live", stop() { stops++; } };
  const result = await probeMicrophone(async (constraints) => {
    calls++; assert.deepEqual(constraints, { audio: true });
    return { getAudioTracks: () => [track], getTracks: () => [track, track] };
  });
  assert.equal(calls, 1); assert.equal(stops, 2); assert.equal(result.ok, true);
  assert.match(result.message, /does not prove speech recognition/);
});

test("microphone permission errors, missing APIs and dead tracks are explicit", async () => {
  assert.equal((await probeMicrophone(undefined)).ok, false);
  const denied = await probeMicrophone(async () => { throw new DOMException("Denied", "NotAllowedError"); });
  assert.equal(denied.ok, false); assert.match(denied.message, /NotAllowedError/);
  let stopped = false;
  const dead = await probeMicrophone(async () => ({ getAudioTracks: () => [], getTracks: () => [{ stop() { stopped = true; } }] }));
  assert.equal(dead.ok, false); assert.equal(stopped, true);
});

test("even late microphone permission grants are immediately released", async () => {
  let grant, stopped = false;
  const result = probeMicrophone(() => new Promise(resolve => { grant = resolve; }));
  grant({ getAudioTracks: () => [{ readyState: "live" }], getTracks: () => [{ stop() { stopped = true; } }] });
  await result; assert.equal(stopped, true);
});
