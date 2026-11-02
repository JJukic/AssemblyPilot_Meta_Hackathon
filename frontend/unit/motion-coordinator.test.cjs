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
const {
  estimateGlobalShift, alignedDiffs, diffBoundingBox, FrameGate,
  BestFrameWindow, frameQualityScore,
} = require("../src/lib/ar/monitoring.ts");
const { InspectionCoordinator } = require("../src/lib/ar/coordinator.ts");
const { AutonomousMachine } = require("../src/lib/ar/autonomous.ts");

const W = 64, H = 48;
const ROI = { x0: 16, y0: 12, x1: 48, y1: 36 };
function scene(seedFn) {
  const a = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = seedFn(x, y);
  return a;
}
const pattern = () => scene((x, y) => (x * 37 + y * 91 + ((x * y) % 13) * 7) % 180 + 30);
function shifted(src, dx, dy, brightness = 0) {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = x - dx, sy = y - dy;
    out[y * W + x] = sx >= 0 && sy >= 0 && sx < W && sy < H
      ? Math.max(0, Math.min(255, src[sy * W + sx] + brightness)) : 30;
  }
  return out;
}
function paintBlock(a, x0, y0, x1, y1, v = 240) {
  const b = new Uint8Array(a);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) b[y * W + x] = v;
  return b;
}

test("head motion: global shift is estimated and compensated; no local change reported", () => {
  const base = pattern();
  const moved = shifted(base, 2, 1);
  const est = estimateGlobalShift(base, moved, W, H);
  assert.equal(est.dx, 2);
  assert.equal(est.dy, 1);
  const aligned = alignedDiffs(base, moved, W, H, ROI);
  assert.ok(aligned.roiDiff < 0.02, `aligned ROI diff ${aligned.roiDiff} must stay below the change threshold`);
  // Gate level: pure head motion never becomes a change candidate.
  const gate = new FrameGate();
  let ft = 0;
  const feed = (roiDiff, outsideDiff) => gate.assess({ hash: `h${ft}`, roiDiff, outsideDiff, sharpness: 12, frameTime: ++ft, at: ft });
  feed(0, 0);
  for (let i = 0; i < 6; i++) assert.notEqual(feed(aligned.roiDiff, aligned.outsideDiff).kind, "changed");
});

test("local placement/removal/rotation under head motion still qualifies after stability", () => {
  const base = pattern();
  const moved = shifted(base, -2, 0);
  const placed = paintBlock(moved, 28, 20, 40, 30);
  const aligned = alignedDiffs(base, placed, W, H, ROI);
  assert.ok(aligned.roiDiff > 0.05, `local change survives alignment (${aligned.roiDiff})`);
  const box = diffBoundingBox(base, placed, W, H, 0.12, aligned.dx, aligned.dy);
  assert.ok(box && box.x <= 28 / W + 0.05 && box.x + box.w >= 40 / W - 0.05);
  assert.ok(box.fraction > 0.01);
  // Removal is the inverse change; rotation/reposition changes the local mask too.
  assert.ok(alignedDiffs(placed, moved, W, H, ROI).roiDiff > 0.05);
  const rotated = paintBlock(moved, 28, 16, 36, 32, 200);
  assert.ok(alignedDiffs(placed, rotated, W, H, ROI).roiDiff > 0.03);
  // Gate: change then stable (with small aligned jitter) qualifies exactly once.
  const gate = new FrameGate();
  let ft = 0;
  const feed = (roiDiff) => gate.assess({ hash: `g${ft}`, roiDiff, outsideDiff: 0.002, sharpness: 12, frameTime: ++ft, at: ft });
  feed(0);
  assert.equal(feed(aligned.roiDiff).kind, "changed");
  feed(0.004); feed(0.003);
  assert.equal(feed(0.004).kind, "qualified");
});

test("lighting change alone is not an assembly change", () => {
  const base = pattern();
  const brighter = shifted(base, 0, 0, 25);
  const aligned = alignedDiffs(base, brighter, W, H, ROI);
  assert.ok(aligned.roiDiff < 0.02, `brightness-invariant diff ${aligned.roiDiff}`);
});

test("best-frame window is bounded and picks the sharpest well-exposed still frame", () => {
  const win = new BestFrameWindow(3);
  const cand = (sharpness, meanBrightness, roiDiff, at) => ({ at, frameTime: at, hash: `f${at}`, sharpness, meanBrightness, roiDiff });
  win.add(cand(4, 128, 0.001, 1));
  win.add(cand(38, 120, 0.001, 2));
  win.add(cand(20, 30, 0.001, 3));
  win.add(cand(10, 128, 0.001, 4));
  assert.equal(win.size, 3, "bounded history");
  assert.equal(win.best().at, 2);
  assert.ok(frameQualityScore(cand(38, 120, 0.001, 2)) > frameQualityScore(cand(4, 128, 0.001, 1)));
  assert.equal(new BestFrameWindow().best(), null);
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
  m.requestTrigger(2000); m.onVerifyResult("p", "s1", "still_incorrect");
  assert.match(m.requestTrigger(3000).reason, /Session Meta budget/);
});
