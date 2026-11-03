/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS harness transpiles TS modules. */
/* Uncertain hold + explicit Check Again, and the bounded incorrect reassessment: fake camera (synthetic frames) + fake inspection
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

/* ---------- Uncertain hold / Check Again and incorrect reassessment (mocked camera + Meta; zero real calls) ---------- */
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

/** Count frame bursts (each Check Again must capture exactly one new frame selection). */
function countBursts(c) {
  const deps = c["deps"];
  const orig = deps.selectFrame;
  const box = { n: 0 };
  deps.selectFrame = async (minClock) => { box.n++; return orig(minClock); };
  return box;
}

test("uncertain is a hold: no automatic request, no timer, no change trigger — only Check Again continues", async () => {
  const { c, env, tick, world } = harness({ minIntervalMs: 1_000 });
  const ver = seq(U, U, C);
  env.respond = (intent) => intent === "verify" ? V : ver();
  await firstChange(env, tick, world);
  assert.equal(c.machine.state, "uncertain");
  assert.equal(c.machine.scheduledRetry().kind, "await_user", "no timer is planned after uncertain");
  await tick(240); // 2 minutes on the same view
  assert.equal(env.calls.length, 1, "no automatic follow-up request");
  env.scene = block(world, 90, 70, 10, 8, 235); // even a physical change does not trigger
  await tick(60);
  assert.equal(env.calls.length, 1, "no change-triggered request while uncertain");
  assert.equal(last(env).code, "uncertain_hold");
  assert.equal(last(env).headline, "UNCERTAIN — CHECK AGAIN");
  assert.match(last(env).detail, /Check Again/);
  assert.ok(!env.statuses.some((s) => /NEXT CHECK IN|RETRYING/.test(s.headline)), "no countdown is ever shown");
  // Check Again #1: exactly one new frame selection and one request (still uncertain → hold again).
  const bursts = countBursts(c);
  assert.match(await c.inspectNow(), /uncertain/);
  assert.equal(bursts.n, 1);
  assert.deepEqual(intents(env), ["inspect", "inspect"]);
  assert.ok(env.calls[1].clock > env.calls[0].clock, "a new frame");
  await tick(120);
  assert.equal(env.calls.length, 2, "hold again after the second uncertain");
  // Check Again #2: correct → the normal separate verification follows → one advance.
  await c.inspectNow();
  assert.equal(bursts.n, 2);
  await tickUntil(env, tick, 4);
  assert.deepEqual(intents(env), ["inspect", "inspect", "inspect", "verify"]);
  assert.deepEqual(env.advances, ["s1"]);
  await tick(120);
  assert.equal(env.calls.length, 4, "nothing after verification");
});

test("Check Again while a request or frame selection runs is refused (single flight: one capture, one request)", async () => {
  const { c, env, tick, world } = harness({ minIntervalMs: 1_000 });
  env.respond = U;
  await firstChange(env, tick, world);
  let release;
  env.respond = () => new Promise((r) => { release = r; });
  const first = c.inspectNow();
  for (let i = 0; i < 50 && !release; i++) await new Promise((r) => setImmediate(r));
  assert.match(await c.inspectNow(), /already running/);
  release(U);
  await first;
  assert.equal(env.calls.length, 2, "exactly one new request");
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

test("correct → uncertain verification → hold; Check Again runs a NEW inspection (never a second verify on the old one)", async () => {
  const { c, env, tick, world } = harness();
  const vs = seq(VU, V);
  const ins = seq(C, C);
  env.respond = (intent) => intent === "verify" ? vs() : ins();
  await firstChange(env, tick, world);
  await tickUntil(env, tick, 2);
  assert.deepEqual(intents(env), ["inspect", "verify"]);
  await tick(200);
  assert.equal(env.calls.length, 2, "no automatic request after the uncertain verification");
  assert.equal(last(env).code, "uncertain_hold");
  await c.inspectNow();
  await tickUntil(env, tick, 4);
  assert.deepEqual(intents(env), ["inspect", "verify", "inspect", "verify"]);
  assert.deepEqual(env.advances, ["s1"]);
});

test("another viewpoint requested: still a hold — even a clearly new view sends nothing until Check Again", async () => {
  const { c, env, tick, world } = harness({ minIntervalMs: 1_000 });
  env.respond = seq(UV, C);
  await firstChange(env, tick, world);
  await tick(120);
  assert.equal(env.calls.length, 1);
  assert.equal(last(env).code, "uncertain_hold");
  assert.match(last(env).detail, /requested side.*Check Again/);
  env.zoom = 1.6; // user moves closer (a clearly new viewpoint), then holds steady
  await tick(60);
  assert.equal(env.calls.length, 1, "a new view alone does not trigger");
  await c.inspectNow();
  assert.deepEqual(intents(env), ["inspect", "inspect"]);
});

test("Check Again respects the step budget: once exhausted, nothing is sent", async () => {
  const { c, env, tick, world } = harness({ minIntervalMs: 1_000, maxAutoPerStep: 2 });
  env.respond = U;
  await firstChange(env, tick, world);
  await c.inspectNow();
  assert.equal(env.calls.length, 2);
  assert.match(await c.inspectNow(), /limit/);
  await tick(100);
  assert.equal(env.calls.length, 2);
  assert.ok(!env.statuses.some((s) => /NEXT CHECK IN/.test(s.headline)));
});

test("incorrect reassessment: frame rejected → nothing spent, fresh frame required, short deferral (no burst every tick)", async () => {
  const { c, env, tick, world } = harness({ minIntervalMs: 1_000, correctionReassessMs: 5_000 });
  env.respond = seq(I, C);
  await firstChange(env, tick, world);
  const realSelect = env.selection;
  env.selection = { ok: false, reason: "No usable fresh frame in the burst (blurred)." };
  const bursts = countBursts(c);
  await tick(24); // 12 s (reassessment due after 5 s)
  assert.equal(env.calls.length, 1);
  assert.equal(c.machine.inspectionsUsed, 1, "rejection spends no budget");
  assert.ok(bursts.n >= 1 && bursts.n <= 5, `bursts deferred (got ${bursts.n})`);
  env.selection = realSelect;
  await tickUntil(env, tick, 2, 20);
  assert.equal(env.calls.length, 2);
  assert.ok(env.calls[1].clock > env.calls[0].clock);
});

test("pause during the uncertain hold: Check Again is refused while paused; after Resume only Check Again sends", async () => {
  const { c, env, tick, world } = harness({ minIntervalMs: 1_000 });
  env.respond = seq(U, C);
  await firstChange(env, tick, world);
  c.pause();
  await tick(40);
  assert.equal(await c.inspectNow(), "Paused");
  assert.equal(env.calls.length, 1, "pause suspends all requests");
  assert.equal(last(env).code, "paused");
  c.resume();
  await tick(40);
  assert.equal(env.calls.length, 1, "Resume alone does not re-check an uncertain result");
  await c.inspectNow();
  assert.equal(env.calls.length, 2);
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

test("camera stall and tracking loss block Check Again and the incorrect reassessment; both work after recovery", async () => {
  const { c, env, tick, world } = harness({ minIntervalMs: 1_000, correctionReassessMs: 5_000 });
  env.respond = seq(I, C);
  await firstChange(env, tick, world);
  env.stalled = true;
  await tick(20);
  assert.equal(env.calls.length, 1);
  assert.equal(last(env).code, "camera_error");
  env.stalled = false;
  env.ctx = { ...env.ctx, anchored: false, anchorState: "tracking_lost" };
  await tick(20);
  assert.equal(await c.inspectNow(), "Waiting for anchor", "Check Again needs tracking");
  assert.equal(env.calls.length, 1);
  assert.equal(last(env).code, "tracking_lost");
  env.ctx = { ...env.ctx, anchored: true, anchorState: "anchored" };
  await tickUntil(env, tick, 2, 40);
  assert.equal(env.calls.length, 2, "the incorrect reassessment recovers by itself");
});

test("re-anchor during a Check Again frame selection discards the capture; a later Check Again sends exactly one request", async () => {
  const { c, env, tick, world } = harness({ minIntervalMs: 1_000 });
  env.ctx = { ...env.ctx, viewerTracked: true, anchorEpoch: 1 };
  env.respond = U;
  await firstChange(env, tick, world);
  const deps = c["deps"];
  const orig = deps.selectFrame;
  deps.selectFrame = async (minClock) => { env.ctx = { ...env.ctx, anchorEpoch: 2 }; return orig(minClock); };
  assert.equal(await c.inspectNow(), "Tracking lost");
  assert.equal(env.calls.length, 1, "nothing sent for the discarded capture");
  deps.selectFrame = orig;
  await tick(60);
  assert.equal(env.calls.length, 1, "still no automatic request after the re-anchor");
  await c.inspectNow();
  assert.equal(env.calls.length, 2);
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

test("a late Check Again result after a step change never overwrites the newer step's state", async () => {
  const { c, env, tick, world } = harness({ minIntervalMs: 1_000 });
  env.respond = U;
  await firstChange(env, tick, world);
  let release;
  env.respond = () => new Promise((r) => { release = r; });
  const pending = c.inspectNow(); // Check Again in flight
  for (let i = 0; i < 50 && !release; i++) await new Promise((r) => setImmediate(r));
  env.ctx = { ...env.ctx, stepId: "s2" };
  c.onStepChanged("s2");
  release({ kind: "inspection", status: "correct" });
  await pending;
  assert.equal(c.machine.stepId, "s2");
  assert.equal(c.machine.lastVerdict, null, "the old step's late result is discarded");
  assert.equal(c.machine.awaitingUserCheck, false, "the new step is not held by the old uncertain");
  assert.deepEqual(env.advances, []);
});

test("field out of view: the due incorrect reassessment waits (no countdown), then runs when the field is looked at", async () => {
  const { env, tick, world } = harness({ minIntervalMs: 1_000, correctionReassessMs: 5_000 });
  env.respond = seq(I, C);
  await firstChange(env, tick, world);
  env.ctx = { ...env.ctx, fieldInView: false };
  await tick(30);
  assert.equal(env.calls.length, 1);
  assert.equal(last(env).code, "waiting_view");
  env.ctx = { ...env.ctx, fieldInView: true };
  await tickUntil(env, tick, 2, 20);
  assert.equal(env.calls.length, 2);
});
