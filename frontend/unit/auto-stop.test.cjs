/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS harness transpiles TS modules. */
/* Regression: Autonomous Assembly must be fully stoppable inside immersive AR. */
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

/* --- fake browser camera (getUserMedia resolves only when the test says so) --- */
function fakeMedia() {
  const pending = [];
  const tracks = [];
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    mediaDevices: {
      getUserMedia: () => new Promise((resolve) => {
        const track = { readyState: "live", label: "fake cam", stop() { this.readyState = "ended"; } };
        tracks.push(track);
        const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
        pending.push(() => resolve(stream));
      }),
    },
  } });
  global.document = {
    createElement: (tag) => tag === "video"
      ? { muted: false, playsInline: false, srcObject: null, readyState: 4, videoWidth: 64, videoHeight: 48, currentTime: 0, play: async () => {} }
      : { width: 0, height: 0, getContext: () => null },
  };
  return { pending, tracks, resolveNext: async () => { pending.shift()(); for (let i = 0; i < 5; i++) await Promise.resolve(); } };
}

test("REPRO camera: stop() while getUserMedia is still pending must not leave a live track", async () => {
  const media = fakeMedia();
  const { MonitorCamera } = require("../src/lib/ar/autonomousMonitor.ts");
  const cam = new MonitorCamera();
  const starting = cam.start().catch((e) => e);
  cam.stop(); // user pressed Stop during camera start
  await media.resolveNext();
  await starting;
  assert.equal(media.tracks[0].readyState, "ended", "the late stream must be released immediately");
  assert.equal(cam.live, false);
});

test("REPRO panel: while Autonomous runs, the immersive panel offers a distinct Stop control", () => {
  const { layoutButtons } = require("../src/lib/ar/runtime.ts");
  const running = layoutButtons([{ id: "verify", label: "Check" }], { autoActive: true });
  const stop = running.find((b) => b.id === "auto-stop");
  assert.ok(stop, "Stop must be reachable without the 2D page");
  assert.ok(running.find((b) => b.id === "auto"), "Pause/Resume stays a separate control");
  assert.ok(stop.w >= 110 && stop.h >= 80, "hand-ray sized");
  assert.ok(!layoutButtons([{ id: "verify", label: "Check" }]).some((b) => b.id === "auto-stop"), "no Stop when nothing runs");
});

test("REPRO dispatch: the immersive action handler implements a true Stop (not only start/pause/resume)", () => {
  const src = fs.readFileSync(__dirname + "/../src/components/ar/ARWorkspace.tsx", "utf8");
  const stopCase = src.slice(src.indexOf('case "auto-stop":'), src.indexOf('case "auto-stop":') + 300);
  assert.ok(src.includes('case "auto-stop":'), "auto-stop action must be handled");
  assert.match(stopCase, /stopAutonomous\(/);
});

/* ---------- AutonomousRunner lifecycle (mocked camera, timer and backend) ---------- */
const { AutonomousRunner } = require("../src/lib/ar/autoRunner.ts");
const { makeWorld, view } = require("./synthetic-frames.cjs");

function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function harness({ deferStart = false } = {}) {
  const world = makeWorld();
  const env = { cameras: [], timers: new Map(), nextTimer: 1, inspects: [], aborts: 0, advances: 0, statuses: [], phases: [], xrActive: true };
  const makeCamera = () => {
    const startGate = deferStart ? deferred() : null;
    const cam = {
      liveFlag: false, stopped: 0, starts: 0, startGate,
      get live() { return this.liveFlag; },
      async start() { this.starts++; if (this.startGate) await this.startGate.promise; this.liveFlag = true; },
      stop() { this.stopped++; this.liveFlag = false; },
      health: () => ({ state: "advancing", fps: 30, framesSeen: 9, lastAdvanceAgoMs: 5, clockSource: "media-time", label: "ok" }),
      grab: () => view(world),
      selectBest: async (minClock) => ({ ok: true, frame: { snapshot: { dataUrl: "data:image/jpeg;base64,AA", width: 1280, height: 720, capturedAt: "t" }, clock: minClock + 1, reason: "best", roiPx: { x: 0, y: 0, w: 1, h: 1 }, sharpness: 9 } }),
    };
    env.cameras.push(cam);
    return cam;
  };
  const runner = new AutonomousRunner({
    camera: makeCamera,
    controller: {
      inspect: (intent) => { const d = deferred(); env.inspects.push({ intent, ...d }); return d.promise; },
      context: () => ({ projectId: "p", stepId: "s1", xrActive: env.xrActive, anchored: true, anchorState: "anchored", fieldInView: true, otherInspectionRunning: false, externalPending: false }),
      advance: async () => { env.advances++; },
      now: () => Date.now(),
    },
    onStatus: (st) => env.statuses.push(st),
    onPhase: (phase) => env.phases.push(phase),
    abortOwnRequest: () => { env.aborts++; },
    setInterval: (fn) => { const id = env.nextTimer++; env.timers.set(id, fn); return id; },
    clearInterval: (id) => env.timers.delete(id),
  });
  const tickAll = async () => { for (const fn of env.timers.values()) fn(); await flush(); };
  return { runner, env, tickAll };
}
const start = (runner) => runner.start({ projectId: "p", stepId: "s1" });

test("Start → Stop while immersive XR is active: timer, controller and camera released; XR untouched", async () => {
  const { runner, env } = harness();
  assert.equal(await start(runner), "started");
  assert.equal(runner.phase, "running");
  assert.equal(env.timers.size, 1);
  const machine = runner.machine;
  assert.equal(runner.stop(), true);
  assert.equal(runner.phase, "off");
  assert.equal(env.timers.size, 0, "monitoring timer cleared");
  assert.equal(env.cameras[0].stopped >= 1 && !env.cameras[0].live, true, "camera tracks released");
  assert.equal(machine.state, "idle");
  assert.equal(runner.controller, null);
  assert.equal(env.aborts, 1, "the run's own client request is aborted");
  assert.equal(env.xrActive, true, "Stop never ends the XR session");
});

test("Start → Pause → Stop: Pause keeps the camera, Stop releases it", async () => {
  const { runner, env } = harness();
  await start(runner);
  assert.equal(runner.pause(), true);
  assert.equal(runner.phase, "paused");
  assert.equal(env.cameras[0].live, true, "pause keeps the camera open");
  runner.stop();
  assert.equal(runner.phase, "off");
  assert.equal(env.cameras[0].live, false);
  assert.equal(runner.resume(), false, "nothing to resume after Stop");
});

test("Stop during an in-flight inspection: the delayed response cannot advance, update status or restart", async () => {
  const { runner, env, tickAll } = harness();
  await start(runner);
  for (let i = 0; i < 4; i++) await tickAll();
  const pending = runner.controller.inspectNow();
  await flush();
  assert.equal(env.inspects.length, 1, "one inspection is in flight");
  const statusesBefore = env.statuses.length;
  runner.stop();
  env.inspects[0].resolve({ kind: "verification", status: "verified" }); // late backend answer
  await pending;
  await flush();
  assert.equal(env.advances, 0, "a late 'verified' never advances a stopped run");
  assert.equal(env.statuses.length, statusesBefore, "no status update after Stop");
  assert.equal(runner.phase, "off");
  for (let i = 0; i < 5; i++) await tickAll();
  assert.equal(env.inspects.length, 1, "zero new automatic inspection requests after Stop");
});

test("Rapid Start/Stop: Stop while the camera is still opening cancels the run and releases the late stream", async () => {
  const { runner, env } = harness({ deferStart: true });
  const starting = start(runner);
  assert.equal(runner.phase, "starting");
  runner.stop();
  assert.equal(runner.phase, "off");
  env.cameras[0].startGate.resolve(); // permission/stream arrives after Stop
  assert.equal(await starting, "cancelled");
  assert.equal(env.cameras[0].live, false, "late camera released");
  assert.equal(runner.controller, null, "no controller created after Stop");
  assert.equal(env.timers.size, 0, "no monitoring timer started after Stop");
  // A new explicit Start works and owns exactly one timer.
  const again = start(runner);
  env.cameras[1].startGate.resolve();
  assert.equal(await again, "started");
  assert.equal(env.timers.size, 1);
  assert.equal(await start(runner), "ignored", "a second Start while running is ignored (no duplicate camera)");
  assert.equal(env.cameras.length, 2);
  runner.stop();
  runner.stop(); // idempotent
  assert.equal(env.timers.size, 0);
});

test("old timer callbacks of a stopped run never tick (no restart without an explicit Start)", async () => {
  const { runner, env } = harness();
  await start(runner);
  const staleTick = [...env.timers.values()][0];
  runner.stop();
  staleTick();
  await flush();
  assert.equal(env.inspects.length, 0);
  assert.equal(runner.phase, "off");
  assert.deepEqual(env.phases.slice(-1), ["off"]);
});

test("XR session end contract: the session-end callback stops Autonomous; the 2D Stop button and panel Stop use the same path", () => {
  const src = fs.readFileSync(__dirname + "/../src/components/ar/ARWorkspace.tsx", "utf8");
  const end = src.slice(src.indexOf("runtime.current = null;"), src.indexOf("runtime.current = null;") + 600);
  assert.match(end, /stopAutoRef\.current\(/, "ending immersive AR stops Autonomous");
  assert.match(src, /onClick=\{\(\) => stopAutonomous\(\)\}>Stop Autonomous Assembly/);
  const stopFn = src.slice(src.indexOf("function stopAutonomous("), src.indexOf("function stopAutonomous(") + 500);
  assert.match(stopFn, /runner\.stop\(/);
  assert.doesNotMatch(stopFn, /runtime\.current\?\.end\(\)|\.reset\(\)/, "Stop never ends XR or re-anchors");
});
