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
const { FrameGate, assessCameraProbe } = require("../src/lib/ar/monitoring.ts");
const { AutonomousMachine } = require("../src/lib/ar/autonomous.ts");

const pose = (x) => { const m = new Array(16).fill(0); m[0] = m[5] = m[10] = m[15] = 1; m[12] = x; return m; };
const sample = (over = {}) => ({ hash: "a", roiDiff: 0, outsideDiff: 0, sharpness: 10, frameTime: 1, at: 0, ...over });

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

/* --- Frame gate --- */

test("gate: unchanged scene never qualifies; change + stability qualifies exactly once", () => {
  const g = new FrameGate();
  let ft = 0;
  const feed = (s) => g.assess(sample({ frameTime: ++ft, ...s }));
  assert.equal(feed({ hash: "a" }).kind, "unchanged");
  assert.equal(feed({ hash: "a" }).kind, "unchanged");
  assert.equal(feed({ hash: "b", roiDiff: 0.2 }).kind, "changed");
  assert.equal(feed({ hash: "b", roiDiff: 0.001 }).kind, "stabilizing");
  feed({ hash: "b", roiDiff: 0.001 });
  const q = feed({ hash: "b", roiDiff: 0.001 });
  assert.equal(q.kind, "qualified");
  // Same scene cannot qualify again (hysteresis / duplicate suppression).
  assert.notEqual(feed({ hash: "b", roiDiff: 0.001 }).kind, "qualified");
  g.noteInspected("b");
  assert.equal(feed({ hash: "b", roiDiff: 0.001 }).kind, "unchanged");
});

test("gate: camera movement, occlusion, blur and frozen frames never qualify", () => {
  const g = new FrameGate();
  let ft = 0;
  const feed = (s) => g.assess(sample({ frameTime: ++ft, ...s }));
  feed({ hash: "a" });
  assert.equal(feed({ hash: "b", roiDiff: 0.2, outsideDiff: 0.19 }).kind, "camera-moved");
  assert.equal(feed({ hash: "c", roiDiff: 0.2, occluded: true }).kind, "occluded");
  assert.equal(feed({ hash: "d", roiDiff: 0.2, sharpness: 0.5 }).kind, "blurry");
  const frozen = g.assess(sample({ hash: "e", frameTime: ft })); // frame clock stalls
  assert.equal(frozen.kind, "frozen");
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

function armedMachine() {
  const m = new AutonomousMachine({ minIntervalMs: 1000, maxAutoPerStep: 3 });
  m.start("p1", "s1");
  m.cameraReady(true);
  m.anchored();
  assert.equal(m.state, "monitoring");
  return m;
}

test("autonomous: incorrect -> correction -> verify still_incorrect -> correction -> verified advances exactly once", () => {
  const m = armedMachine();
  assert.equal(m.requestTrigger(10_000).intent, "inspect");
  assert.equal(m.requestTrigger(10_100).intent, "none", "one outstanding Meta request maximum");
  m.onInspectResult("p1", "s1", "incorrect");
  assert.equal(m.state, "correction_required");
  m.changeDetected();
  assert.equal(m.state, "awaiting_correction");
  assert.equal(m.requestTrigger(11_000).intent, "verify");
  assert.deepEqual(m.onVerifyResult("p1", "s1", "still_incorrect"), { intent: "none" });
  assert.equal(m.state, "correction_required");
  assert.equal(m.requestTrigger(12_000).intent, "verify");
  assert.deepEqual(m.onVerifyResult("p1", "s1", "verified"), { intent: "advance" });
  assert.equal(m.confirmAdvance(false), true);
  assert.equal(m.confirmAdvance(false), false, "exactly one advance per step");
  m.onAdvanced("s2");
  assert.equal(m.state, "monitoring");
  assert.equal(m.inspectionsUsed, 0, "per-step budget resets on the new step");
});

test("autonomous: correct inspection still requires fresh verification; final step completes", () => {
  const m = armedMachine();
  m.requestTrigger(10_000);
  m.onInspectResult("p1", "s1", "correct");
  assert.equal(m.state, "correct_awaiting_verification");
  assert.equal(m.confirmAdvance(true), false, "a correct inspection alone never advances");
  assert.equal(m.requestTrigger(11_000).intent, "verify");
  m.onVerifyResult("p1", "s1", "verified");
  assert.equal(m.confirmAdvance(true), true);
  assert.equal(m.state, "completed");
});

test("autonomous: cooldown, per-step cap, stale results, uncertain and errors never advance", () => {
  const m = armedMachine();
  m.requestTrigger(10_000);
  m.onInspectResult("p1", "s1", "uncertain");
  assert.equal(m.state, "uncertain");
  assert.equal(m.requestTrigger(10_500).intent, "none", "cooldown blocks repeated paid inference");
  m.requestTrigger(12_000);
  m.onInspectResult("other-project", "s1", "correct"); // stale: ignored
  assert.equal(m.state, "verifying");
  m.onInspectResult("p1", "s1", "error");
  // error path via verify channel:
  const m2 = armedMachine();
  m2.requestTrigger(10_000);
  m2.onInspectResult("p1", "s1", "incorrect");
  m2.requestTrigger(11_000);
  m2.onVerifyResult("p1", "s1", "error");
  assert.equal(m2.state, "inspection_failed");
  assert.equal(m2.confirmAdvance(false), false);
  // cap
  const m3 = armedMachine();
  for (let i = 0; i < 3; i++) {
    assert.notEqual(m3.requestTrigger(10_000 + i * 2000).intent, "none");
    m3.onInspectResult("p1", "s1", i === 0 ? "incorrect" : "incorrect");
    if (i > 0) m3.onVerifyResult("p1", "s1", "still_incorrect");
    // re-arm outcome channels realistically
    if (m3.state === "correction_required" && i > 0) { /* next loop verifies */ }
  }
  assert.match(m3.requestTrigger(20_000).reason ?? "", /limit/);
});

test("autonomous: pause/resume/stop and tracking loss gate inspections", () => {
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
  m.stop();
  assert.equal(m.state, "idle");
});
