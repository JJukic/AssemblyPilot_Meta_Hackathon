/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS harness transpiles TS modules. */
/* Motion-compensated monitoring, best-frame selection, inspection coordination. */
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
const { candidateStats, candidateDefect, pickBestCandidate } = require("../src/lib/ar/monitoring.ts");
const { InspectionCoordinator } = require("../src/lib/ar/coordinator.ts");
const { AutonomousMachine } = require("../src/lib/ar/autonomous.ts");

/* Burst frame selection (replaces the metadata-only BestFrameWindow). */
const SW = 48, SH = 36;
const img = (fn) => Uint8Array.from({ length: SW * SH }, (_, i) => fn(i % SW, Math.floor(i / SW)));
const sharpImg = () => img((x, y) => ((Math.floor(x / 3) + Math.floor(y / 3)) % 2 ? 200 : 60));
const blurImg = () => img((x, y) => 130 + 40 * Math.sin(x / 9) * Math.cos(y / 9));

test("burst selection: the sharpest well-exposed fresh candidate wins, with an explained reason", () => {
  const cands = [candidateStats(blurImg(), SW, SH, 1), candidateStats(sharpImg(), SW, SH, 2), candidateStats(blurImg(), SW, SH, 3)];
  assert.ok(cands[1].sharpness > cands[0].sharpness * 5, "Laplacian variance separates focus/motion blur");
  const pick = pickBestCandidate(cands);
  assert.equal(pick.ok, true);
  assert.equal(pick.index, 1);
  assert.match(pick.reason, /best of 3: sharpness/);
});

test("burst selection rejects stale, duplicate, black, overexposed and uniform frames — never fabricates freshness", () => {
  const black = candidateStats(img(() => 2), SW, SH, 5);
  const white = candidateStats(img(() => 253), SW, SH, 6);
  const flat = candidateStats(img(() => 120), SW, SH, 7);
  assert.match(candidateDefect(black), /dark/);
  assert.match(candidateDefect(white), /overexposed/);
  assert.match(candidateDefect(flat), /uniform/);
  const none = pickBestCandidate([black, white, flat]);
  assert.equal(none.ok, false);
  // Frames not newer than the last sent frame are never re-used.
  const old = candidateStats(sharpImg(), SW, SH, 4);
  assert.equal(pickBestCandidate([old], 4).ok, false);
  const dup = pickBestCandidate([candidateStats(sharpImg(), SW, SH, 9), candidateStats(sharpImg(), SW, SH, 9)], 4);
  assert.equal(dup.ok, true);
  assert.match(dup.reason, /duplicate frame/);
  // A low-texture but valid tabletop is ranked, not rejected (no deadlock).
  assert.equal(pickBestCandidate([candidateStats(blurImg(), SW, SH, 10)]).ok, true);
});

test("coordinator: single lease, stale results rejected, step change invalidates", () => {
  const c = new InspectionCoordinator();
  const lease = c.acquire("p1", "s1", "inspect");
  assert.ok(lease !== null);
  assert.equal(c.acquire("p1", "s1", "verify"), null, "no concurrent transaction");
  assert.equal(c.accepts(lease, "p1", "s1"), true);
  assert.equal(c.accepts(lease, "p1", "s2"), false, "stale step result rejected");
  assert.equal(c.accepts(lease + 99, "p1", "s1"), false);
  c.release(lease);
  assert.equal(c.busy, false);
  const second = c.acquire("p1", "s2", "inspect");
  c.invalidateStep();
  assert.equal(c.accepts(second, "p1", "s2"), false, "navigation invalidates in-flight work");
});

test("session Meta budget and one-time initial assessment are enforced", () => {
  const m = new AutonomousMachine({ minIntervalMs: 0, maxAutoPerStep: 10, maxPerSession: 2 });
  m.start("p", "s1");
  m.cameraReady(true);
  m.anchored();
  m.armInitialAssessment();
  assert.equal(m.initialAssessmentArmed, true);
  m.noteInitialAssessment();
  assert.equal(m.initialAssessmentArmed, false);
  m.armInitialAssessment();
  assert.equal(m.initialAssessmentArmed, false, "initial assessment only once per session");
  m.requestTrigger(1000); m.onInspectResult("p", "s1", "incorrect");
  m.requestTrigger(2000); m.onInspectResult("p", "s1", "incorrect");
  assert.match(m.requestTrigger(3000).reason, /Session Meta budget/);
  assert.equal(m.state, "budget_exhausted", "exhaustion is an explicit state");
  m.onAdvanced("s2");
  m.stepChanged("s3");
  assert.match(m.requestTrigger(9000).reason, /Session Meta budget/, "session budget survives step changes");
});
