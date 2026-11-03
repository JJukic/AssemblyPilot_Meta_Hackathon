/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS harness transpiles TS modules. */
/* Phase 7: anchored field, frame gate, autonomous state machine. */
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
const { AnchorTracker, DEFAULT_FIELD, fieldCorners, placementInsideField, samePose } = require("../src/lib/ar/field.ts");
const { assessCameraProbe } = require("../src/lib/ar/monitoring.ts");
const { AutonomousMachine } = require("../src/lib/ar/autonomous.ts");

const pose = (x) => { const m = new Array(16).fill(0); m[0] = m[5] = m[10] = m[15] = 1; m[12] = x; return m; };

/* --- Anchoring (tests 31-48 of the Phase 7 spec, at the pure-logic level) --- */

test("field geometry: corners, bounds and pose identity are exact", () => {
  const corners = fieldCorners(DEFAULT_FIELD);
  assert.equal(corners.length, 4);
  assert.deepEqual(corners[0], [-0.24, 0, -0.16]);
  assert.equal(placementInsideField([0.1, 0, 0.05], DEFAULT_FIELD), true);
  assert.equal(placementInsideField([0.3, 0, 0], DEFAULT_FIELD), false);
  assert.equal(samePose(pose(1), pose(1)), true);
  assert.equal(samePose(pose(1), pose(2)), false);
});

test("anchor: explicit confirm, transient dropout holds pose, sustained loss is explicit, no silent relocation", () => {
  const t = new AnchorTracker(3);
  assert.equal(t.state, "unplaced");
  t.preview(true);
  assert.equal(t.state, "awaiting_confirmation");
  t.confirm(pose(1));
  assert.equal(t.state, "anchored");
  // Simulated head movement: live anchor poses may refine, held pose follows anchor only.
  assert.deepEqual(t.onPose(pose(1)).pose, pose(1));
  // Transient nulls hold the SAME pose (no jump, no hide).
  assert.equal(t.onPose(null).state, "tracking_degraded");
  assert.equal(t.onPose(null).state, "tracking_degraded");
  assert.deepEqual(t.onPose(null).pose, pose(1));
  assert.equal(t.onPose(null).state, "tracking_lost");
  assert.deepEqual(t.onPose(null).pose, pose(1), "lost field stays at last confirmed pose, never a guessed new one");
  // Recovery returns to the same anchor.
  assert.equal(t.onPose(pose(1)).state, "anchored");
  // Reference reset marks lost instead of adopting a new location.
  t.onReferenceReset();
  assert.equal(t.state, "tracking_lost");
  // Re-anchor is deliberate and clears the old pose.
  t.beginReanchor();
  assert.equal(t.state, "reanchoring");
  assert.equal(t.lastGoodPose, null);
  t.release();
  assert.equal(t.state, "unplaced");
});

test("anchor: repeated state updates cause no cumulative drift", () => {
  const t = new AnchorTracker();
  t.confirm(pose(2));
  for (let i = 0; i < 100; i++) t.onPose(pose(2));
  assert.deepEqual(t.lastGoodPose, pose(2));
});

test("camera probe: advancing frames vs stalled track during XR are distinguished", () => {
  const base = { secureContext: true, hasMediaDevices: true, hasXR: true, xrActive: true, trackState: "live" };
  assert.equal(assessCameraProbe({ ...base, frames: [{ frameTime: 1, hash: "a" }, { frameTime: 2, hash: "b" }] }).status, "likely");
  const stalled = assessCameraProbe({ ...base, frames: [{ frameTime: 1, hash: "a" }, { frameTime: 1, hash: "a" }] });
  assert.equal(stalled.status, "stalled");
  assert.equal(stalled.canCaptureDuringXR, false);
  assert.equal(assessCameraProbe({ ...base, secureContext: false, frames: [] }).status, "unavailable");
});

/* --- Autonomous state machine --- */

function armedMachine(over = {}) {
  const m = new AutonomousMachine({ minIntervalMs: 1000, verifyDelayMs: 500, maxAutoPerStep: 4, ...over });
  m.start("p1", "s1");
  m.cameraReady(true);
  m.anchored();
  assert.equal(m.state, "monitoring");
  return m;
}

test("autonomous: incorrect -> fresh INSPECT (never verify) -> correct -> separate verify -> advances exactly once", () => {
  const m = armedMachine();
  assert.equal(m.requestTrigger(10_000).intent, "inspect");
  assert.equal(m.requestTrigger(10_100).intent, "none", "one outstanding Meta request maximum");
  m.onInspectResult("p1", "s1", "incorrect", undefined, 10_200);
  assert.equal(m.state, "correction_required");
  m.changeDetected();
  assert.equal(m.state, "awaiting_correction");
  assert.equal(m.requestTrigger(10_500).intent, "none", "cooldown between automatic inspections");
  assert.equal(m.requestTrigger(11_000).intent, "inspect", "a repaired frame is inspected anew, not verified");
  m.onInspectResult("p1", "s1", "correct", undefined, 11_100);
  assert.equal(m.state, "correct_awaiting_verification");
  assert.equal(m.confirmAdvance(false), false, "a correct inspection alone never advances");
  assert.equal(m.requestTrigger(11_200).intent, "none", "verification needs a LATER frame");
  assert.equal(m.requestTrigger(11_700).intent, "verify");
  assert.deepEqual(m.onVerifyResult("p1", "s1", "verified"), { intent: "advance" });
  assert.equal(m.confirmAdvance(false), true);
  assert.equal(m.confirmAdvance(false), false, "exactly one advance per step");
  m.onAdvanced("s2");
  assert.equal(m.state, "monitoring");
  assert.equal(m.inspectionsUsed, 0, "per-step budget resets on the new step");
});

test("autonomous: verification that fails returns to inspect; final step completes", () => {
  const m = armedMachine();
  m.requestTrigger(10_000);
  m.onInspectResult("p1", "s1", "correct", undefined, 10_000);
  assert.equal(m.requestTrigger(11_000).intent, "verify");
  m.onVerifyResult("p1", "s1", "still_incorrect");
  assert.equal(m.state, "correction_required");
  assert.equal(m.nextIntent, "inspect");
  m.requestTrigger(12_500);
  m.onInspectResult("p1", "s1", "correct", undefined, 12_500);
  m.requestTrigger(13_100);
  m.onVerifyResult("p1", "s1", "verified");
  assert.equal(m.confirmAdvance(true), true);
  assert.equal(m.state, "completed");
  assert.equal(m.requestTrigger(99_000).intent, "none", "no calls after completion");
});

test("autonomous: cooldown, per-step cap, stale results, uncertain and errors never advance", () => {
  const m = armedMachine();
  m.requestTrigger(10_000);
  m.onInspectResult("p1", "s1", "uncertain");
  assert.equal(m.state, "uncertain");
  assert.equal(m.requestTrigger(10_500).intent, "none", "cooldown blocks repeated paid inference");
  m.requestTrigger(12_000);
  m.onInspectResult("other-project", "s1", "correct"); // stale: ignored
  assert.equal(m.state, "inspecting");
  m.onInspectResult("p1", "s1", "error", "transport");
  assert.equal(m.state, "inspection_failed");
  assert.equal(m.lastFailure, "transport");
  assert.equal(m.confirmAdvance(false), false);
  // cap
  const m3 = armedMachine({ maxAutoPerStep: 3 });
  for (let i = 0; i < 3; i++) {
    assert.notEqual(m3.requestTrigger(10_000 + i * 2000).intent, "none");
    m3.onInspectResult("p1", "s1", "incorrect");
  }
  assert.match(m3.requestTrigger(20_000).reason ?? "", /limit/);
  assert.equal(m3.state, "budget_exhausted");
  assert.equal(m3.requestTrigger(20_000, { manual: true }).intent, "none", "manual Inspect Now never bypasses budgets");
});

test("autonomous: failures back off exponentially, then stop in error until Resume", () => {
  const m = armedMachine({ minIntervalMs: 1000, maxConsecutiveFailures: 3 });
  m.requestTrigger(0); m.onInspectResult("p1", "s1", "error", "provider");
  assert.equal(m.canTrigger(1_500).ok, true);
  m.requestTrigger(1_500); m.onInspectResult("p1", "s1", "error", "provider");
  assert.equal(m.canTrigger(2_600).ok, false, "second failure doubles the wait");
  assert.match(m.canTrigger(2_600).reason, /Backing off/);
  m.requestTrigger(3_600); m.onInspectResult("p1", "s1", "error", "provider");
  assert.equal(m.state, "error");
  assert.equal(m.requestTrigger(99_000).intent, "none");
  m.resume();
  assert.equal(m.state, "anchoring");
  m.anchored();
  assert.equal(m.state, "monitoring");
});

test("autonomous: 409 conflict forgets the inspection so the next call is a fresh inspect", () => {
  const m = armedMachine();
  m.requestTrigger(0); m.onInspectResult("p1", "s1", "correct", undefined, 0);
  m.requestTrigger(1_000); m.onVerifyResult("p1", "s1", "error", "conflict");
  assert.equal(m.hasInspection, false);
  assert.equal(m.nextIntent, "inspect");
});

test("autonomous: pause/resume/stop, tracking loss and camera loss gate inspections and recover (no deadlock)", () => {
  const m = armedMachine();
  m.pause();
  assert.equal(m.requestTrigger(10_000).intent, "none");
  m.resume();
  assert.equal(m.state, "monitoring");
  m.anchorLost();
  assert.equal(m.state, "tracking_lost");
  assert.equal(m.requestTrigger(10_000).intent, "none");
  m.anchored();
  assert.equal(m.state, "monitoring");
  m.cameraUnavailable();
  assert.equal(m.requestTrigger(10_000).intent, "none");
  m.cameraRecovered();
  m.anchored();
  assert.equal(m.state, "monitoring", "camera recovery returns to monitoring (was stuck in camera_initializing)");
  // pause during a correct-awaiting-verification state resumes there
  m.requestTrigger(20_000); m.onInspectResult("p1", "s1", "correct", undefined, 20_000);
  m.pause(); m.resume();
  assert.equal(m.state, "correct_awaiting_verification");
  m.stop();
  assert.equal(m.state, "idle");
});

test("autonomous: manual results and server verification are adopted without a duplicate paid call", () => {
  const m = armedMachine();
  m.adoptManualResult("p1", "s1", "correct", 5_000);
  assert.equal(m.state, "correct_awaiting_verification");
  assert.equal(m.inspectionsUsed, 0, "manual call is not charged twice");
  m.serverVerified("p1", "s1");
  assert.equal(m.confirmAdvance(false), true);
  assert.equal(m.confirmAdvance(false), false);
});
