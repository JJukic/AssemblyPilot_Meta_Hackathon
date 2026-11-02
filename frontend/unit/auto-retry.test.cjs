/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS harness transpiles TS modules. */
/* Scheduled Check Step / Check Again loop: fake camera (synthetic frames) + fake inspection
 * endpoint that COUNTS would-be paid calls. Zero real Meta requests. */
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
const { AutoController } = require("../src/lib/ar/autoController.ts");
const { makeWorld, block, view } = require("./synthetic-frames.cjs");

function harness(over = {}) {
  const world = makeWorld();
  const env = {
    t: 100_000,
    scene: world,
    ox: 40, oy: 30,
    live: true,
    stalled: false,
    ctx: { projectId: "p", stepId: "s1", xrActive: true, anchored: true, anchorState: "anchored", fieldInView: true, otherInspectionRunning: false, externalPending: false },
    calls: [],
    advances: [],
    statuses: [],
    respond: () => ({ kind: "inspection", status: "correct" }),
    selection: null,
    lastClock: 0,
  };
  const camera = {
    get live() { return env.live; },
    health: () => env.stalled
      ? { state: "stalled", fps: null, framesSeen: 9, lastAdvanceAgoMs: 4000, clockSource: "media-time", label: "stalled" }
      : { state: "advancing", fps: 30, framesSeen: 9, lastAdvanceAgoMs: 10, clockSource: "media-time", label: "ok" },
    grab: () => {
      if (env.stalled) return null;
      const f = view(env.scene, env.ox, env.oy, { zoom: env.zoom ?? 1 });
      env.lastClock = f.clock;
      return f;
    },
  };
  const deps = {
    camera,
    selectFrame: async (minClock) => env.selection ?? {
      ok: env.lastClock > minClock,
      reason: "burst",
      frame: { snapshot: { dataUrl: "data:image/jpeg;base64,AA", width: 1280, height: 720, capturedAt: "x" }, clock: env.lastClock, reason: "best of 4", roiPx: { x: 0, y: 0, w: 1, h: 1 }, sharpness: 100 },
    },
    inspect: async (intent, frame, stepId) => {
      env.calls.push({ intent, stepId, clock: frame.clock, t: env.t });
      return typeof env.respond === "function" ? env.respond(intent, stepId) : env.respond;
    },
    context: () => ({ ...env.ctx }),
    advance: async (stepId) => { env.advances.push(stepId); },
    onStatus: (s) => env.statuses.push(s),
    now: () => env.t,
  };
  const c = new AutoController(deps, { minIntervalMs: 20_000, verifyDelayMs: 5_000, maxAutoPerStep: 4, maxPerSession: 12, ...over });
  c.start("p", "s1");
  const tick = async (n = 1) => { for (let i = 0; i < n; i++) { env.t += 500; await c.tick(); } };
  return { c, env, tick, world };
}
const last = (env) => env.statuses.at(-1);

/* ---------- Scheduled Check Step / Check Again loop (mocked camera + Meta; zero real calls) ---------- */
const seq = (...outs) => { let i = 0; return () => outs[Math.min(i++, outs.length - 1)]; };
const U = { kind: "inspection", status: "uncertain" };
const UV = { kind: "inspection", status: "uncertain", needsView: true };
const C = { kind: "inspection", status: "correct" };
const I = { kind: "inspection", status: "incorrect" };
const V = { kind: "verification", status: "verified" };
const VU = { kind: "verification", status: "uncertain" };
const intents = (env) => env.calls.map((c) => c.intent);
async function firstChange(env, tick, world) {
  await tick(6);
  env.scene = block(world, 80, 60, 10, 8);
  await tick(8);
  assert.equal(env.calls.length, 1, "the physical change triggers the first Check Step");
}
const tickUntil = async (env, tick, n, max = 200) => { for (let i = 0; i < max && env.calls.length < n; i++) await tick(); };

test("uncertain → uncertain → correct → verified WITHOUT any further physical change; fresh frames, cooldown kept, one advance", async () => {
  const { env, tick, world } = harness();
  const ver = seq(U, U, C);
  env.respond = (intent) => intent === "verify" ? V : ver();
  await firstChange(env, tick, world);
  await tickUntil(env, tick, 4);
  assert.deepEqual(intents(env), ["inspect", "inspect", "inspect", "verify"]);
  for (let i = 1; i < env.calls.length; i++) assert.ok(env.calls[i].clock > env.calls[i - 1].clock, "every request uses a new frame");
  assert.ok(env.calls[1].t - env.calls[0].t >= 20_000 && env.calls[2].t - env.calls[1].t >= 20_000, "existing cooldown is never bypassed");
  assert.ok(env.calls[3].t - env.calls[2].t >= 5_000, "verification waits the verification delay");
  assert.deepEqual(env.advances, ["s1"]);
  await tick(120);
  assert.equal(env.calls.length, 4, "nothing after verification");
  assert.deepEqual(env.advances, ["s1"], "advances exactly once");
});

test("uncertain retry fires 5 s after the result when the cooldown is shorter; status counts down truthfully", async () => {
  const { env, tick, world } = harness({ minIntervalMs: 1_000 });
  env.respond = seq(U, C);
  await firstChange(env, tick, world);
  const resultAt = env.calls[0].t; // the mocked Meta answers immediately
  await tick(1);
  assert.match(last(env).headline, /^UNCERTAIN — NEXT CHECK IN [1-5] S$/);
  assert.equal(last(env).code, "retry_scheduled");
  await tickUntil(env, tick, 2);
  assert.equal(intents(env)[1], "inspect");
  assert.ok(env.calls[1].t - resultAt >= 5_000 && env.calls[1].t - resultAt <= 7_000, "≈5 s retry target");
  assert.ok(env.statuses.some((s) => s.headline === "CHECKING STEP AGAIN WITH META AI…"));
});

test("incorrect → correction (detected change) → correct → Check Again verified", async () => {
  const { env, tick, world } = harness();
  const ver = seq(I, C);
  env.respond = (intent) => intent === "verify" ? V : ver();
  env.ox = 40;
  await tick(6);
  env.scene = block(world, 80, 60, 10, 8, 30);
  await tick(8);
  assert.equal(last(env).code, "correction_required");
  assert.match(last(env).detail, /rechecked in \d+ s/);
  env.t += 20_000;
  env.scene = block(world, 80, 60, 10, 8, 235); // the user fixes it
  await tickUntil(env, tick, 3);
  assert.deepEqual(intents(env), ["inspect", "inspect", "verify"]);
  assert.deepEqual(env.advances, ["s1"]);
});

test("incorrect without a detected correction: one bounded reassessment after 60 s, never a loop", async () => {
  const { env, tick, world } = harness();
  env.respond = I;
  await firstChange(env, tick, world);
  await tick(110); // 55 s
  assert.equal(env.calls.length, 1, "no reassessment before correctionReassessMs");
  await tick(400); // 200 s more
  assert.equal(env.calls.length, 3, "bounded: maxTimedRetries scheduled reassessments");
  assert.equal(last(env).code, "correction_required");
  assert.doesNotMatch(last(env).detail, /rechecked in/, "no misleading countdown once exhausted");
});

test("correct → uncertain verification → a NEW Check Step (never a second verify on the old inspection)", async () => {
  const { env, tick, world } = harness();
  const vs = seq(VU, V);
  const ins = seq(C, C);
  env.respond = (intent) => intent === "verify" ? vs() : ins();
  await firstChange(env, tick, world);
  await tickUntil(env, tick, 4);
  assert.deepEqual(intents(env), ["inspect", "verify", "inspect", "verify"]);
  assert.deepEqual(env.advances, ["s1"]);
});

test("another viewpoint requested: no timed retry and no countdown until a clearly new view is steady", async () => {
  const { env, tick, world } = harness({ minIntervalMs: 1_000 });
  env.respond = seq(UV, C);
  await firstChange(env, tick, world);
  await tick(120); // 60 s on the same view
  assert.equal(env.calls.length, 1, "identical views are never re-sent because a timer expired");
  assert.equal(last(env).headline, "ANOTHER CAMERA VIEW REQUIRED");
  assert.ok(!env.statuses.slice(-100).some((s) => /NEXT CHECK IN/.test(s.headline)));
  env.zoom = 1.6; // user moves closer (a clearly new viewpoint), then holds steady
  await tickUntil(env, tick, 2, 60);
  assert.deepEqual(intents(env), ["inspect", "inspect"]);
});

test("repeated uncertain on an unchanged view is bounded (maxTimedRetries), then asks for another view", async () => {
  const { env, tick, world } = harness({ minIntervalMs: 1_000 });
  env.respond = U;
  await firstChange(env, tick, world);
  await tick(300);
  assert.equal(env.calls.length, 3, "1 change-triggered + 2 scheduled");
  assert.equal(last(env).code, "another_view");
  assert.match(last(env).detail, /change the viewpoint/);
});

test("budget exhaustion stops the retry loop with an explicit status and no countdown", async () => {
  const { env, tick, world } = harness({ minIntervalMs: 1_000, maxAutoPerStep: 2 });
  env.respond = U;
  await firstChange(env, tick, world);
  await tick(200);
  assert.equal(env.calls.length, 2);
  assert.equal(last(env).code, "budget");
  assert.ok(!/NEXT CHECK IN/.test(last(env).headline));
});

test("frame rejected for a scheduled retry: nothing spent, a fresh frame is required, short deferral (no burst every tick)", async () => {
  const { c, env, tick, world } = harness({ minIntervalMs: 1_000 });
  env.respond = seq(U, C);
  await firstChange(env, tick, world);
  let bursts = 0;
  const realSelect = env.selection;
  env.selection = { ok: false, reason: "No usable fresh frame in the burst (blurred)." };
  const deps = c["deps"];
  const orig = deps.selectFrame;
  deps.selectFrame = async (minClock) => { bursts++; return orig(minClock); };
  await tick(24); // 12 s
  assert.equal(env.calls.length, 1);
  assert.equal(c.machine.inspectionsUsed, 1, "rejection spends no budget");
  assert.ok(bursts >= 1 && bursts <= 5, `bursts deferred (got ${bursts})`);
  env.selection = realSelect;
  await tickUntil(env, tick, 2, 20);
  assert.equal(env.calls.length, 2);
  assert.ok(env.calls[1].clock > env.calls[0].clock);
});

test("pause during the countdown: no request while paused; resume re-checks only after a steady view", async () => {
  const { c, env, tick, world } = harness({ minIntervalMs: 1_000 });
  env.respond = seq(U, C);
  await firstChange(env, tick, world);
  c.pause();
  await tick(40);
  assert.equal(env.calls.length, 1, "pause suspends all automatic requests");
  assert.equal(last(env).code, "paused");
  c.resume();
  await tickUntil(env, tick, 2, 30);
  assert.equal(env.calls.length, 2, "resumes the scheduled check");
});

test("stop during an in-flight request: the delayed result never schedules or sends anything", async () => {
  const { c, env, tick, world } = harness({ minIntervalMs: 1_000 });
  let release;
  env.respond = () => new Promise((r) => { release = r; });
  await tick(6);
  env.scene = block(world, 80, 60, 10, 8);
  const pending = tick(8);
  for (let i = 0; i < 50 && !release; i++) await new Promise((r) => setImmediate(r));
  assert.equal(env.calls.length, 1);
  c.stop();
  release(U);
  await pending;
  env.respond = U;
  await tick(100);
  assert.equal(env.calls.length, 1, "no request after Stop");
  assert.equal(c.machine.state, "idle");
  assert.equal(last(env).code, "off");
});

test("camera stall and tracking loss suspend the scheduled check; it resumes after recovery", async () => {
  const { env, tick, world } = harness({ minIntervalMs: 1_000 });
  env.respond = seq(U, C);
  await firstChange(env, tick, world);
  env.stalled = true;
  await tick(20);
  assert.equal(env.calls.length, 1);
  assert.equal(last(env).code, "camera_error");
  env.stalled = false;
  env.ctx = { ...env.ctx, anchored: false, anchorState: "tracking_lost" };
  await tick(20);
  assert.equal(env.calls.length, 1);
  assert.equal(last(env).code, "tracking_lost");
  env.ctx = { ...env.ctx, anchored: true, anchorState: "anchored" };
  await tickUntil(env, tick, 2, 40);
  assert.equal(env.calls.length, 2, "recovers by itself and retries");
});

test("step change during an outstanding inspection: stale result discarded, the old retry never fires on the new step", async () => {
  const { c, env, tick, world } = harness({ minIntervalMs: 1_000 });
  let release;
  env.respond = () => new Promise((r) => { release = r; });
  await tick(6);
  env.scene = block(world, 80, 60, 10, 8);
  const pending = tick(8);
  for (let i = 0; i < 50 && !release; i++) await new Promise((r) => setImmediate(r));
  env.ctx = { ...env.ctx, stepId: "s2" };
  c.onStepChanged("s2");
  release(U);
  await pending;
  env.respond = U;
  await tick(60);
  assert.equal(env.calls.length, 1, "no scheduled retry carried over to the new step");
  assert.equal(c.machine.lastVerdict, null);
  assert.deepEqual(env.advances, []);
});

test("field out of view: the due retry waits (no countdown), then runs when the field is looked at", async () => {
  const { env, tick, world } = harness({ minIntervalMs: 1_000 });
  env.respond = seq(U, C);
  await firstChange(env, tick, world);
  env.ctx = { ...env.ctx, fieldInView: false };
  await tick(30);
  assert.equal(env.calls.length, 1);
  assert.equal(last(env).code, "waiting_view");
  env.ctx = { ...env.ctx, fieldInView: true };
  await tickUntil(env, tick, 2, 20);
  assert.equal(env.calls.length, 2);
});
