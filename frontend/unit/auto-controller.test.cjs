/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS harness transpiles TS modules. */
/* Integrated autonomous loop: fake camera (synthetic frames) + fake inspection
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
const { AutoController, classifyFailure } = require("../src/lib/ar/autoController.ts");
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
      const f = view(env.scene, env.ox, env.oy);
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

test("head movement alone over a long session makes ZERO paid calls", async () => {
  const { env, tick } = harness();
  await tick(6);
  for (let i = 0; i < 40; i++) {
    env.ox = 40 + Math.round(8 * Math.sin(i / 3));
    env.oy = 30 + Math.round(5 * Math.cos(i / 4));
    await tick(i % 5 === 0 ? 6 : 1);
  }
  assert.equal(env.calls.length, 0);
});

test("placement → exactly one inspect; correct → a LATER separate verify; verified → one advance", async () => {
  const { env, tick, world } = harness();
  await tick(6);
  env.scene = block(world, 80, 60, 10, 8);
  await tick(8);
  assert.deepEqual(env.calls.map((c) => c.intent), ["inspect"]);
  assert.equal(last(env).code, "awaiting_verification");
  env.respond = (intent) => intent === "verify" ? { kind: "verification", status: "verified" } : { kind: "inspection", status: "correct" };
  await tick(14); // ≥ verifyDelay, still view
  assert.deepEqual(env.calls.map((c) => c.intent), ["inspect", "verify"]);
  assert.ok(env.calls[1].clock > env.calls[0].clock, "verification uses a newer camera frame");
  assert.deepEqual(env.advances, ["s1"]);
  await tick(10);
  assert.equal(env.calls.length, 2, "no extra calls after verification");
});

test("incorrect → correction is re-INSPECTED after a real change; unchanged scene is never re-sent", async () => {
  const { env, tick, world } = harness();
  env.respond = { kind: "inspection", status: "incorrect" };
  await tick(6);
  env.scene = block(world, 80, 60, 10, 8, 30);
  await tick(8);
  assert.equal(env.calls.length, 1);
  assert.equal(last(env).code, "correction_required");
  await tick(60); // 30 s of an unchanged scene
  assert.equal(env.calls.length, 1, "no paid call on an unchanged scene");
  env.scene = block(world, 80, 60, 10, 8, 235);
  await tick(8);
  assert.deepEqual(env.calls.map((c) => c.intent), ["inspect", "inspect"]);
});

test("cooldown: a change right after an inspection waits, then fires once (the event is not lost)", async () => {
  const { env, tick, world } = harness();
  env.respond = { kind: "inspection", status: "incorrect" };
  await tick(6);
  env.scene = block(world, 80, 60, 10, 8);
  await tick(8);
  env.scene = block(world, 70, 60, 10, 8);
  await tick(8);
  assert.equal(env.calls.length, 1);
  assert.equal(last(env).code, "cooldown");
  await tick(30);
  assert.equal(env.calls.length, 2);
});

test("hand passes through the field without changing anything: no paid call", async () => {
  const { env, tick, world } = harness();
  await tick(6);
  for (const x of [72, 78, 84, 90]) { env.scene = block(world, x, 64, 16, 22, 30); await tick(1); }
  env.scene = world;
  await tick(10);
  assert.equal(env.calls.length, 0);
});

test("camera stall → camera error, no calls; frames resume → monitoring recovers by itself", async () => {
  const { env, tick, world } = harness();
  await tick(6);
  env.stalled = true;
  env.scene = block(world, 80, 60, 10, 8);
  await tick(4);
  assert.equal(last(env).code, "camera_error");
  assert.equal(env.calls.length, 0);
  env.stalled = false;
  await tick(10);
  assert.equal(env.calls.length, 1, "after recovery the placement is inspected");
});

test("field not anchored / tracking lost / not in view → no calls, truthful status, then continues", async () => {
  const { env, tick, world } = harness();
  env.ctx.anchored = false; env.ctx.anchorState = "awaiting_confirmation";
  await tick(4);
  assert.equal(last(env).code, "field_not_placed");
  env.ctx.anchorState = "tracking_lost";
  await tick(2);
  assert.equal(last(env).code, "tracking_lost");
  env.ctx.anchored = true; env.ctx.anchorState = "anchored";
  await tick(6);
  env.ctx.fieldInView = false;
  env.scene = block(world, 80, 60, 10, 8);
  await tick(8);
  assert.equal(env.calls.length, 0);
  assert.equal(last(env).code, "waiting_view");
  env.ctx.fieldInView = true;
  await tick(3);
  assert.equal(env.calls.length, 1);
});

test("stale result: the step changes during the request → result discarded, no advance", async () => {
  const { c, env, tick, world } = harness();
  env.respond = () => {
    env.ctx.stepId = "s2"; // remote navigation while Meta runs
    c.onStepChanged("s2");
    return { kind: "verification", status: "verified" };
  };
  await tick(6);
  env.scene = block(world, 80, 60, 10, 8);
  await tick(8);
  assert.equal(env.calls.length, 1);
  assert.equal(env.advances.length, 0);
  assert.equal(c.machine.stepId, "s2");
  assert.equal(c.machine.hasInspection, false, "old-step inspection never carries over");
});

test("pause → no analysis and no calls; resume re-references the scene instead of paying for it", async () => {
  const { c, env, tick, world } = harness();
  await tick(6);
  c.pause();
  env.scene = block(world, 80, 60, 10, 8);
  await tick(20);
  assert.equal(env.calls.length, 0);
  c.resume();
  await tick(10);
  assert.equal(env.calls.length, 0, "a change made while paused becomes the new reference");
});

test("per-step and per-session budgets hold across many changes; exhaustion is explicit", async () => {
  const { env, tick, world } = harness({ minIntervalMs: 1000, maxAutoPerStep: 2, maxPerSession: 3 });
  env.respond = { kind: "inspection", status: "incorrect" };
  await tick(6);
  for (let i = 0; i < 6; i++) { env.scene = block(world, 64 + i * 6, 60, 10, 8); await tick(10); }
  assert.equal(env.calls.length, 2);
  assert.equal(last(env).code, "budget");
});

test("errors back off; frame-selection rejection spends no budget; manual inspection elsewhere blocks", async () => {
  const { c, env, tick, world } = harness({ minIntervalMs: 2000 });
  await tick(6);
  env.selection = { ok: false, reason: "No usable fresh frame in the burst (too dark)." };
  env.scene = block(world, 80, 60, 10, 8);
  await tick(8);
  assert.equal(env.calls.length, 0);
  assert.equal(c.machine.inspectionsUsed, 0);
  assert.equal(last(env).code, "quality_insufficient");
  env.selection = null;
  env.ctx.otherInspectionRunning = true;
  await tick(4);
  assert.equal(env.calls.length, 0);
  assert.equal(last(env).code, "busy_elsewhere");
  env.ctx.otherInspectionRunning = false;
  env.respond = { kind: "error", failure: "transport", message: "Cannot reach the backend." };
  await tick(4);
  assert.equal(env.calls.length, 1);
  assert.match(last(env).headline, /TRANSPORT ERROR/);
  env.scene = block(world, 70, 60, 10, 8);
  await tick(12);
  assert.equal(env.calls.length, 2, "the real change is retried after the back-off");
  assert.ok(env.calls[1].t - env.calls[0].t >= 2000, "no retry before the back-off expired");
});

test("Inspect Now bypasses only the cooldown — never budgets or single flight", async () => {
  const { c, env, tick } = harness({ maxAutoPerStep: 1 });
  env.respond = { kind: "inspection", status: "incorrect" };
  await tick(6);
  await c.inspectNow();
  assert.equal(env.calls.length, 1);
  await c.inspectNow();
  assert.equal(env.calls.length, 1);
});

test("failure classification never turns infrastructure into a visual verdict", () => {
  const err = (status, message = "x") => Object.assign(new Error(message), { status });
  assert.equal(classifyFailure(new Error("Cannot reach the backend. Check that it is running, then retry.")), "transport");
  assert.equal(classifyFailure(err(409)), "conflict");
  assert.equal(classifyFailure(err(410)), "stale");
  assert.equal(classifyFailure(err(504)), "provider");
  assert.equal(classifyFailure(err(429)), "provider");
  assert.equal(classifyFailure(err(422)), "rejected");
  assert.equal(classifyFailure(err(500)), "backend");
  assert.equal(classifyFailure(Object.assign(new Error("The operation was aborted"), { name: "AbortError" })), "aborted");
  assert.equal(classifyFailure(new Error("Invalid verification evidence. No verification was accepted.")), "invalid_response");
});

test("rejected burst: the unsent frame is reported for the panel, nothing is inspected or charged", async () => {
  const { c, env, tick, world } = harness();
  const rejected = [];
  c.deps.onFrameRejected = (preview, reason) => rejected.push({ preview, reason });
  await tick(6);
  env.selection = { ok: false, reason: "No usable fresh frame in the burst (too dark).", preview: { dataUrl: "data:image/jpeg;base64,DARK", width: 1280, height: 720, capturedAt: "t" } };
  env.scene = block(world, 80, 60, 10, 8);
  await tick(8);
  assert.equal(env.calls.length, 0);
  assert.equal(c.machine.inspectionsUsed, 0);
  assert.ok(rejected.length >= 1);
  assert.equal(rejected[0].preview.dataUrl, "data:image/jpeg;base64,DARK");
});

test("the frame given to inspect() is exactly the selected frame object (no re-capture between selection and upload)", async () => {
  const { c, env, tick, world } = harness();
  const selected = [], inspected = [];
  const select = c.deps.selectFrame;
  c.deps.selectFrame = async (minClock) => {
    const result = await select(minClock);
    if (result.ok) selected.push(result.frame);
    return result;
  };
  const inspect = c.deps.inspect;
  c.deps.inspect = async (intent, frame, stepId) => { inspected.push(frame); return inspect(intent, frame, stepId); };
  env.respond = { kind: "inspection", status: "incorrect" };
  await tick(6);
  env.scene = block(world, 80, 60, 10, 8);
  await tick(8);
  assert.equal(inspected.length, 1);
  assert.equal(inspected[0], selected[0], "identical object: same snapshot, same data URL, same clock");
});
