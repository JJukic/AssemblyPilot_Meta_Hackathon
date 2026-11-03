/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS harness transpiles TS modules. */
/* PR 11 review regressions: Stop during fingerprinting, sticky Pause, idempotent
 * two-device advance, tracking-gated requests, request-scoped external results.
 * Fake camera + fake Meta/backend that COUNT would-be requests; zero real calls. */
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
const { AutonomousRunner } = require("../src/lib/ar/autoRunner.ts");
const { UploadRun } = require("../src/lib/ar/coordinator.ts");
const { moveCursor } = require("../src/lib/ar/cursor.ts");
const { ExternalRequestTracker, acceptExternalResult } = require("../src/lib/ar/cameraBridge.ts");
const { makeWorld, block, view } = require("./synthetic-frames.cjs");

const SOURCE = fs.readFileSync(__dirname + "/../src/components/ar/ARWorkspace.tsx", "utf8");
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

/* ------------------------------------------------------------------------ */
/* Shared fake world: synthetic camera frames + counted inspection endpoint */
/* ------------------------------------------------------------------------ */
function world(over = {}) {
  const w = makeWorld();
  const env = {
    t: 100_000, scene: w, ox: 40, oy: 30, lastClock: 0,
    ctx: { projectId: "p", stepId: "s1", xrActive: true, anchored: true, anchorState: "anchored", viewerTracked: true, anchorEpoch: 1, fieldInView: true, otherInspectionRunning: false, externalPending: false },
    calls: [], uploads: [], advances: [], statuses: [],
    respond: () => ({ kind: "inspection", status: "correct" }),
    selectGate: null, // deferred → frame selection waits for it
    inspectGate: null, // deferred → the (simulated) fingerprint/preparation waits for it
    responseGate: null, // deferred → the backend answer waits for it (request already sent)
  };
  const camera = {
    live: true,
    health: () => ({ state: "advancing", fps: 30, framesSeen: 9, lastAdvanceAgoMs: 10, clockSource: "media-time", label: "ok" }),
    grab: () => { const f = view(env.scene, env.ox, env.oy); env.lastClock = f.clock; return f; },
    start: async () => {}, stop() { this.live = false; },
  };
  const frame = () => ({ snapshot: { dataUrl: "data:image/jpeg;base64,AA", width: 1280, height: 720, capturedAt: "x" }, clock: env.lastClock, reason: "best", roiPx: { x: 0, y: 0, w: 1, h: 1 }, sharpness: 100 });
  const selectFrame = async (minClock) => {
    if (env.selectGate) await env.selectGate.promise;
    return { ok: env.lastClock > minClock, reason: "burst", frame: frame() };
  };
  camera.selectBest = selectFrame;
  /* Mirrors ARWorkspace.performInARInspection: run registered BEFORE the first
   * await, `open` re-checked after preparation and directly before upload. */
  const owned = { current: null };
  const inspect = async (intent, f, stepId, guard) => {
    env.calls.push({ intent, stepId, t: env.t });
    const run = new UploadRun(() => guard());
    owned.current = run.controller;
    try {
      if (env.inspectGate) await env.inspectGate.promise; // snapshotFingerprint()
      if (!run.open) return { kind: "error", failure: "aborted", message: "Cancelled before upload" };
      const sending = run.upload(async () => {
        env.uploads.push({ intent, stepId, t: env.t });
        if (env.responseGate) await env.responseGate.promise;
        return typeof env.respond === "function" ? env.respond(intent, stepId) : env.respond;
      });
      if (!sending) return { kind: "error", failure: "aborted", message: "Cancelled before upload" };
      const out = await sending;
      if (run.signal.aborted) return { kind: "error", failure: "aborted", message: "Cancelled" };
      return out;
    } finally {
      if (owned.current === run.controller) owned.current = null;
    }
  };
  const controllerDeps = {
    inspect,
    context: () => ({ ...env.ctx }),
    advance: async (stepId) => { env.advances.push(stepId); },
    onStatus: (s) => env.statuses.push(s),
    now: () => env.t,
  };
  const config = { minIntervalMs: 20_000, verifyDelayMs: 5_000, maxAutoPerStep: 4, maxPerSession: 12, ...over };
  return { w, env, camera, selectFrame, inspect, owned, controllerDeps, config };
}

function controllerHarness(over) {
  const h = world(over);
  const c = new AutoController({ ...h.controllerDeps, camera: h.camera, selectFrame: h.selectFrame }, h.config);
  c.start("p", "s1");
  const tick = async (n = 1) => { for (let i = 0; i < n; i++) { h.env.t += 500; await c.tick(); } };
  /** Start a tick that triggers on a physical change but do NOT await it (it may be gated). */
  const change = async () => {
    await tick(6);
    h.env.scene = block(h.w, 80, 60, 10, 8);
  };
  return { ...h, c, tick, change };
}
const last = (env) => env.statuses.at(-1);
/** Tick (without awaiting a gated in-flight run) until a request was started. */
async function tickUntilCall(h, n = 1, max = 40) {
  for (let i = 0; i < max && h.env.calls.length < n; i++) {
    h.env.t += 500;
    void h.c.tick();
    await flush();
  }
}

/* ================================ P1 #1 ================================= */
test("P1#1 Stop during snapshotFingerprint: the run is registered before the first await and no upload starts", async () => {
  const h = world();
  let tickFn = null;
  const runner = new AutonomousRunner({
    camera: () => h.camera,
    controller: { ...h.controllerDeps, onFrameRejected: () => {} },
    onStatus: (s) => h.env.statuses.push(s),
    onPhase: () => {},
    abortOwnRequest: () => h.owned.current?.abort(), // the exact ARWorkspace wiring
    setInterval: (fn) => { tickFn = fn; return 1; },
    clearInterval: () => { tickFn = null; },
  });
  // Override the controller config through the runner's controller after start.
  assert.equal(await runner.start({ projectId: "p", stepId: "s1" }), "started");
  const tick = async (n = 1) => { for (let i = 0; i < n; i++) { h.env.t += 500; tickFn?.(); await flush(); } };
  await tick(6);
  h.env.scene = block(h.w, 80, 60, 10, 8);
  h.env.inspectGate = deferred(); // fingerprinting hangs
  for (let i = 0; i < 20 && h.env.calls.length === 0; i++) await tick();
  assert.equal(h.env.calls.length, 1, "the inspection pipeline was entered (fingerprinting)");
  assert.ok(h.owned.current, "AbortController registered before the first await");
  runner.stop(); // user presses Stop while snapshotFingerprint() is still running
  h.env.inspectGate.resolve();
  await flush();
  assert.equal(h.env.uploads.length, 0, "no upload after Stop during fingerprinting");
  await tick(50);
  assert.equal(h.env.uploads.length, 0, "and nothing afterwards");
  assert.equal(runner.phase, "off");
});

test("P1#1 UploadRun: closed after any preparation step ⇒ upload() refuses; a late backend answer is not used", async () => {
  let valid = true;
  const run = new UploadRun(() => valid);
  const prep = deferred();
  let sent = 0;
  const pipeline = (async () => {
    await prep.promise; // fingerprint / image preparation
    if (!run.open) return "not-sent";
    const sending = run.upload(async () => { sent++; return "ok"; });
    return sending ? await sending : "not-sent";
  })();
  valid = false; // replaced / step changed while preparing
  prep.resolve();
  assert.equal(await pipeline, "not-sent");
  assert.equal(sent, 0);
  assert.equal(run.uploadStarted, false);
  const aborted = new UploadRun();
  aborted.abort();
  assert.equal(aborted.upload(async () => { sent++; }), null, "aborted run never uploads");
  assert.equal(sent, 0);
});

test("P1#1 ARWorkspace contract: run + AbortController before the first await, re-checked after fingerprint and before upload", () => {
  const fn = SOURCE.slice(SOURCE.indexOf("async function performInARInspection"), SOURCE.indexOf("/** \"Inspect Now\""));
  const runAt = fn.indexOf("new UploadRun(");
  const ownedAt = fn.indexOf("autoOwnedAbort.current = controller");
  const firstAwait = fn.indexOf("await ");
  assert.ok(runAt > 0 && ownedAt > 0 && runAt < firstAwait && ownedAt < firstAwait, "registered before the first await");
  const fp = fn.indexOf("await snapshotFingerprint(frame.dataUrl)");
  assert.match(fn.slice(fp, fp + 200), /if \(!run\.open\) return notSent\(previewId\)/, "checked right after fingerprinting");
  assert.doesNotMatch(fn, /await inspectSnapshot\(|await verifySnapshot\(/, "uploads only through run.upload (final pre-upload check)");
  assert.match(fn, /run\.upload\(\(signal\) => inspectSnapshot\(/);
  assert.match(fn, /run\.upload\(\(signal\) => verifySnapshot\(/);
  assert.match(fn, /mayUpload\?\.\(\)/, "the Autonomous run guard is part of `open`");
});

/* ================================ P1 #2 ================================= */
test("P1#2 Pause during a running inspection: a late UNCERTAIN keeps 'paused'; no requests until Resume", async () => {
  const h = controllerHarness({ minIntervalMs: 1_000 });
  h.env.respond = { kind: "inspection", status: "uncertain" };
  await h.change();
  h.env.responseGate = deferred(); // request reached the backend, answer pending
  await tickUntilCall(h);
  assert.equal(h.env.uploads.length, 1);
  h.c.pause();
  assert.equal(h.c.machine.state, "paused");
  h.env.responseGate.resolve(); // late uncertain answer
  await flush();
  assert.equal(h.c.machine.state, "paused", "a late result never unpauses");
  assert.equal(h.c.machine.lastVerdict, "uncertain", "…but it is recorded");
  assert.equal(last(h.env).code, "paused");
  assert.match(last(h.env).detail, /uncertain/);
  h.env.responseGate = null;
  h.env.t += 60_000; // far past every retry / cooldown deadline
  await h.tick(80);
  assert.equal(h.env.calls.length, 1, "no further request while paused");
  assert.equal(h.c.machine.state, "paused");
  h.c.resume();
  assert.equal(h.c.machine.state, "uncertain", "resume continues from the late verdict");
  await h.tick(80);
  assert.equal(h.env.calls.length, 1, "uncertain stays a hold after Resume (no automatic re-check)");
  assert.equal(last(h.env).code, "uncertain_hold");
  await h.c.inspectNow(); // explicit Check Again after Resume
  assert.equal(h.env.calls.length, 2, "requests continue only after Resume + Check Again");
});

test("P1#2 Pause: a late VERIFIED never advances while paused; Resume advances exactly once", async () => {
  const h = controllerHarness({ minIntervalMs: 1_000 });
  h.env.respond = (intent) => intent === "verify" ? { kind: "verification", status: "verified" } : { kind: "inspection", status: "correct" };
  await h.change();
  await tickUntilCall(h, 1);
  await flush();
  assert.equal(h.c.machine.state, "correct_awaiting_verification");
  h.env.responseGate = deferred();
  h.env.t += 6_000;
  await tickUntilCall(h, 2, 80);
  assert.equal(h.env.calls[1].intent, "verify");
  h.c.pause();
  h.env.responseGate.resolve();
  await flush();
  assert.equal(h.c.machine.state, "paused");
  assert.deepEqual(h.env.advances, [], "no automatic advance while paused");
  h.env.responseGate = null;
  await h.tick(40);
  assert.deepEqual(h.env.advances, []);
  assert.equal(h.env.calls.length, 2);
  // Server-progress confirmation while paused must not unpause either.
  h.c.machine.serverVerified("p", "s1");
  assert.equal(h.c.machine.state, "paused");
  assert.equal(h.c.machine.confirmAdvance(false), false);
  h.c.resume();
  await h.tick(5);
  assert.deepEqual(h.env.advances, ["s1"], "advance only after Resume, exactly once");
  assert.equal(h.env.calls.length, 2, "no extra paid request");
});

test("P1#2 Pause during fingerprinting: the prepared run is not uploaded", async () => {
  const h = controllerHarness();
  await h.change();
  h.env.inspectGate = deferred();
  await tickUntilCall(h);
  h.c.pause();
  h.env.inspectGate.resolve();
  await flush();
  assert.equal(h.env.uploads.length, 0, "guard() is false while paused");
  assert.equal(h.c.machine.state, "paused");
});

/* ================================ P1 #3 ================================= */
function cursorServer(steps, start = steps[0]) {
  const server = { step: start, revision: 0, writes: [] };
  const conflict = () => Object.assign(new Error("409 Another device changed the viewed step"), { status: 409 });
  const device = () => ({
    setView: async (stepId, revision) => {
      await Promise.resolve();
      if (revision !== server.revision) throw conflict();
      server.writes.push(stepId);
      server.step = stepId;
      server.revision++;
      return { step_id: server.step, revision: server.revision };
    },
    getView: async () => ({ step_id: server.step, revision: server.revision }),
  });
  return { server, device };
}

test("P1#3 two devices advance concurrently from step 1: step 2 is reached once, never skipped to 3", async () => {
  const { server, device } = cursorServer(["s1", "s2", "s3"]);
  const [a, b] = await Promise.all([
    moveCursor(device(), { from: "s1", to: "s2", revision: 0 }),
    moveCursor(device(), { from: "s1", to: "s2", revision: 0 }),
  ]);
  assert.equal(server.step, "s2", "Step 2 is not skipped");
  assert.deepEqual(server.writes, ["s2"], "the step change is applied exactly once");
  assert.deepEqual([a.kind, b.kind].sort(), ["moved", "synced"]);
  assert.equal(a.view.step_id, "s2");
  assert.equal(b.view.step_id, "s2");
});

test("P1#3 409 retry targets the same absolute step; a cursor elsewhere is only synchronised", async () => {
  // Revision bumped without moving (still at the origin): retry the SAME target once.
  const one = cursorServer(["s1", "s2", "s3"]);
  one.server.revision = 5;
  const moved = await moveCursor(one.device(), { from: "s1", to: "s2", revision: 4 });
  assert.equal(moved.kind, "moved");
  assert.equal(moved.retried, true);
  assert.deepEqual(one.server.writes, ["s2"]);
  // Another device already went further (s3): never move, never skip — only sync.
  const two = cursorServer(["s1", "s2", "s3"], "s3");
  two.server.revision = 2;
  const diverged = await moveCursor(two.device(), { from: "s1", to: "s2", revision: 0 });
  assert.equal(diverged.kind, "diverged");
  assert.equal(diverged.view.step_id, "s3");
  assert.deepEqual(two.server.writes, []);
});

test("P1#3 ARWorkspace contract: auto-advance is bound to the verified origin; no relative retry offset", () => {
  const nav = SOURCE.slice(SOURCE.indexOf("async function navigate("), SOURCE.indexOf("async function verify(mode"));
  assert.match(nav, /moveCursor\(/);
  assert.doesNotMatch(nav, /freshIndex \+ offset/, "the old relative retry is gone");
  const adv = SOURCE.slice(SOURCE.indexOf("async function advanceIfVerified"), SOURCE.indexOf("function reanchorField"));
  assert.match(adv, /navigate\(1, stepId\)/, "bound to the originally verified step");
});

/* ================================ P1 #4 ================================= */
test("P1#4 missing viewer pose blocks automatic requests even though the field is anchored", async () => {
  const h = controllerHarness();
  h.env.respond = (intent) => intent === "verify" ? { kind: "verification", status: "verified" } : { kind: "inspection", status: "correct" };
  h.env.ctx.viewerTracked = false; // anchor held, but no head pose
  await h.change();
  await h.tick(60);
  assert.equal(h.env.calls.length, 0, "no request without a viewer pose");
  assert.equal(last(h.env).code, "tracking_lost");
  // Tracking returns: monitoring recovers by itself; a real change is inspected again.
  h.env.ctx.viewerTracked = true;
  await h.tick(10);
  assert.notEqual(last(h.env).code, "tracking_lost");
  h.env.scene = block(h.w, 30, 20, 10, 8);
  await h.tick(40);
  assert.deepEqual(h.env.calls.map((c) => c.intent), ["inspect", "verify"], "requests resume only with a viewer pose");
  assert.deepEqual(h.env.advances, ["s1"]);
});

test("P1#4 tracking loss during frame selection invalidates the prepared run (nothing sent)", async () => {
  const h = controllerHarness();
  await h.change();
  h.env.selectGate = deferred();
  const running = h.tick(10);
  await flush();
  h.env.ctx.viewerTracked = false; // lost while the burst is being selected
  h.env.selectGate.resolve();
  await running;
  assert.equal(h.env.calls.length, 0);
  assert.equal(h.env.uploads.length, 0);
  assert.ok(h.env.statuses.some((s) => s.headline === "TRACKING LOST — CAPTURE DISCARDED"));
  assert.equal(h.c.machine.busy, false, "no request slot left reserved");
  assert.equal(h.c.machine.inspectionsUsed, 0, "no budget spent");
  h.env.selectGate = null;
  await h.tick(80);
  assert.equal(h.env.calls.length, 0, "still nothing while tracking is lost");
});

test("P1#4 tracking loss during fingerprinting: guard() turns false and the upload is skipped", async () => {
  const h = controllerHarness();
  await h.change();
  h.env.inspectGate = deferred();
  await tickUntilCall(h);
  h.env.ctx.anchored = false;
  h.env.ctx.anchorState = "tracking_lost";
  h.env.inspectGate.resolve();
  await flush();
  assert.equal(h.env.uploads.length, 0);
});

test("P1#4 Re-anchor invalidates a prepared run and the result of a request already in flight", async () => {
  const h = controllerHarness();
  await h.change();
  h.env.selectGate = deferred();
  const running = h.tick(10);
  await flush();
  h.env.ctx.anchorEpoch = 2; // Re-anchor (and a new confirmed placement) during selection
  h.env.selectGate.resolve();
  await running;
  assert.equal(h.env.uploads.length, 0, "prepared capture of the old placement is never sent");
  h.env.selectGate = null;
  // Request in flight when re-anchoring: its result is not used.
  const r = controllerHarness();
  r.env.respond = { kind: "inspection", status: "correct" };
  await r.change();
  r.env.responseGate = deferred();
  await tickUntilCall(r);
  r.env.ctx.anchorEpoch = 2;
  r.env.responseGate.resolve();
  await flush();
  assert.equal(r.env.uploads.length, 1);
  assert.notEqual(r.c.machine.lastOutcome, "correct", "late result of the old placement discarded");
  assert.equal(r.c.machine.nextIntent, "inspect", "no verification can follow from it");
});

test("P1#4 ARWorkspace/runtime contract: auto context uses viewer tracking + anchor epoch; Re-anchor aborts the auto request", () => {
  assert.match(SOURCE, /anchored: runtime\.current\?\.autoInspectionReady \?\? false/);
  assert.match(SOURCE, /viewerTracked: runtime\.current \? runtime\.current\.viewerTracked : undefined/);
  assert.match(SOURCE, /anchorEpoch: runtime\.current\?\.anchorEpoch/);
  const re = SOURCE.slice(SOURCE.indexOf("function reanchorField"), SOURCE.indexOf("/** Switch the AR panel view"));
  assert.match(re, /autoOwnedAbort\.current\?\.abort\(\)/);
  assert.doesNotMatch(SOURCE, /onClick=\{\(\) => runtime\.current\?\.reset\(\)\}/, "every Re-anchor button invalidates auto captures");
  const runtime = fs.readFileSync(__dirname + "/../src/lib/ar/runtime.ts", "utf8");
  assert.match(runtime, /get autoInspectionReady\(\) \{ return !this\.ended && this\.anchorTracker\.isAnchored && this\.tracking; \}/);
});

/* ================================ P2 #5 ================================= */
const bridgeSummary = (inspectionId) => ({
  kind: "inspection", state: "correction_required", status: "correct", explanation: "x", issues: [],
  correctionPlan: [], nextAction: "y", errorMessage: null, verificationStatus: null,
  specificationId: "spec-1", inspectionId, snapshotId: "snap",
  overall: { kind: "incorrect", printGate: "fail", expectedPrint: null, observedPrint: null, printAction: null, faceStatus: null, geometryStatus: null },
});
const payload = (requestId, inspectionId, over = {}) => ({ request_id: requestId, project_id: "p", step_id: "s1", mode: "inspect", updated_at: 1, summary: bridgeSummary(inspectionId), ...over });
const req = (requestId, over = {}) => ({ requestId, projectId: "p", stepId: "s1", code: "CAM123", spec: "spec-rev-1", ...over });
const here = (over = {}) => () => ({ projectId: "p", stepId: "s1", code: "CAM123", spec: "spec-rev-1", ...over });

test("P2#5 an old response arriving before the new result is never accepted for the new request", async () => {
  const t = new ExternalRequestTracker();
  t.begin(req("old"));
  t.begin(req("new")); // a new check with the same project, step and pairing code
  const got = await t.pollOnce(async () => payload("old", "insp-old"), here());
  assert.equal(got, null, "old result rejected");
  assert.equal(t.current.requestId, "new", "still waiting for the new one");
  const fresh = await t.pollOnce(async () => payload("new", "insp-new"), here());
  assert.equal(fresh.summary.inspectionId, "insp-new");
  assert.equal(t.current, null, "the request is consumed exactly once");
});

test("P2#5 project / step / pairing code / specification are all checked", () => {
  const r = req("r1");
  assert.ok(acceptExternalResult(payload("r1", "i"), r, here()()));
  assert.equal(acceptExternalResult(payload("r1", "i", { project_id: "other" }), r, here()()), null);
  assert.equal(acceptExternalResult(payload("r1", "i", { step_id: "s2" }), r, here()()), null);
  assert.equal(acceptExternalResult(payload("r1", "i"), r, here({ stepId: "s2" })()), null);
  assert.equal(acceptExternalResult(payload("r1", "i"), r, here({ code: "OTHER1" })()), null);
  assert.equal(acceptExternalResult(payload("r1", "i"), r, here({ spec: "spec-rev-2" })()), null);
  assert.equal(acceptExternalResult(payload("r1", "i"), { ...r, specificationId: "spec-9" }, here()()), null);
  assert.equal(acceptExternalResult({ ...payload("r1", "i"), request_id: undefined }, r, here()()), null, "unscoped legacy payloads are never accepted");
});

test("P2#5 step change, unmount and Stop during polling drop the late result (no stale 'Step Verified')", async () => {
  for (const cause of ["step change", "unmount", "stop"]) {
    const t = new ExternalRequestTracker();
    t.begin(req("r1"));
    const net = deferred();
    const polling = t.pollOnce(() => net.promise, here());
    t.invalidate(); // what ARWorkspace does on step change / unmount / Stop
    net.resolve(payload("r1", "late", { summary: { ...bridgeSummary("late"), verificationStatus: "verified" } }));
    assert.equal(await polling, null, `${cause}: late result ignored`);
    assert.equal(t.current, null);
  }
  // A new request started while the previous poll was in flight.
  const t = new ExternalRequestTracker();
  t.begin(req("a"));
  const net = deferred();
  const polling = t.pollOnce(() => net.promise, here());
  t.begin(req("b"));
  net.resolve(payload("a", "late-a"));
  assert.equal(await polling, null);
  assert.equal(t.current.requestId, "b", "extPending stays for the active request only");
});

test("P2#5 ARWorkspace contract: requestId flows from request to poll; invalidated on step change, Stop and unmount", () => {
  const fallback = SOURCE.slice(SOURCE.indexOf("async function requestExternalFallback"), SOURCE.indexOf("/* -------- External camera companion"));
  assert.match(fallback, /const requestId = await requestExternalCapture\(/);
  assert.match(fallback, /extTracker\.begin\(\{ requestId, projectId, stepId, code, spec: issuedSpec \}\)/);
  assert.match(SOURCE, /latestExternalResult\(r\.projectId, r\.stepId, r\.code, r\.requestId\)/);
  assert.match(SOURCE, /extTracker\.current\.stepId !== view\.step_id\) extTracker\.invalidate\(\)/);
  const stop = SOURCE.slice(SOURCE.indexOf("function stopAutonomous"), SOURCE.indexOf("const stopAutoRef"));
  assert.match(stop, /extTracker\.invalidate\(\)/);
  assert.match(SOURCE, /alive\.current = false;\s*extTracker\.invalidate\(\)/);
  assert.doesNotMatch(SOURCE, /summaryFromBridge\(payload, projectId, stepId\)/, "old unscoped polling removed");
});

/* ================================ P2 #6 ================================= */
test("P2#6 unmount captures the camera references BEFORE runner.stop() clears the shared ref", () => {
  const cleanup = SOURCE.slice(SOURCE.indexOf("alive.current = false;\n      extTracker.invalidate()"), SOURCE.indexOf("}, [runner, extTracker]);"));
  const capture = cleanup.indexOf("const monitor = monitorRef.current;");
  const stop = cleanup.indexOf("runner.stop();");
  assert.ok(capture > 0 && capture < stop, "reference saved before runner.stop()");
  assert.match(cleanup, /monitor\?\.stop\(\);/);
  assert.match(cleanup, /companionCamera\?\.stop\(\);/);
  const companion = SOURCE.slice(SOURCE.indexOf("async function runCompanionOnce"), SOURCE.indexOf("/** Bridge from the long-lived controller"));
  assert.match(companion, /companionCameraRef\.current = monitor; \/\/ owner known before the first await/);
});

test("uncertain fix contract: every manual verdict (incl. verification and external camera) reaches Autonomous", () => {
  const src = fs.readFileSync(require.resolve("../src/components/ar/ARWorkspace.tsx"), "utf8");
  assert.match(src, /const manualVerdict = manualVerdictOf\(d\);\s*if \(manualVerdict\) controllerRef\.current\?\.adoptManual\(manualVerdict, stepId, !!d\.needsView\);/);
  assert.doesNotMatch(src, /if \(!d\.verificationStatus\) controllerRef\.current\?\.adoptManual/, "verification results are no longer skipped");
  const fn = src.slice(src.indexOf("function manualVerdictOf"), src.indexOf("function summaryVerdictOf"));
  assert.match(fn, /verificationStatus === "uncertain"\) return "uncertain"/);
  assert.match(fn, /verificationStatus === "still_incorrect"\) return "incorrect"/);
  assert.match(src, /const external = summaryVerdictOf\(summary\);\s*if \(external && summary\.stepId === viewRef\.current\.step_id\) controllerRef\.current\?\.adoptManual\(external, summary\.stepId\);/);
  // Double Check Again: a second press while one runs is refused (single flight).
  const check = src.slice(src.indexOf("async function checkStep"), src.indexOf("async function finishAssembly"));
  assert.match(check, /if \(checkingRef\.current\) return \{ ok: false, reason: "Check already in progress" \};\s*const stepId/);
  assert.ok(check.indexOf("checkingRef.current = true") < check.indexOf("await "), "the guard is set before the first await");
});
