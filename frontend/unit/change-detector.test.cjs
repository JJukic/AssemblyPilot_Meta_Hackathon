/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS harness transpiles TS modules. */
/* Deterministic synthetic camera frames: head motion, placement, removal,
 * rotation, hand occlusion, lighting, moving closer, pre-existing build.
 * These prove the detector logic only — never physical HoloLens behaviour. */
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
const { ChangeDetector, register, CENTER_ROI } = require("../src/lib/ar/changeDetector.ts");

const { W, H, makeWorld, block, view } = require("./synthetic-frames.cjs");
const run = (d, frames) => frames.map((f) => d.observe(f));
const settle = (d, world, ox = 40, oy = 30, opts) => run(d, Array.from({ length: 5 }, () => view(world, ox, oy, opts)));
const kinds = (reports) => reports.map((r) => r.kind);

test("registration recovers a pure head translation with no local change", () => {
  const world = makeWorld();
  const a = view(world, 40, 30), b = view(world, 43, 28);
  const r = register(a.gray, b.gray, W, H, CENTER_ROI, 6, 0.14);
  assert.deepEqual([r.dx, r.dy], [-3, 2], "content shifted by the head move is registered");
  assert.ok(r.roiFraction < 0.01, `roi ${r.roiFraction}`);
});

test("head movement alone never produces a change (re-baselines instead of paying)", () => {
  const d = new ChangeDetector();
  const world = makeWorld();
  assert.ok(kinds(settle(d, world)).includes("baseline-set"));
  // natural head sway: several shifted, then stable at a new pose
  const seen = [];
  for (const [ox, oy] of [[42, 31], [45, 33], [47, 33], [48, 34]]) seen.push(d.observe(view(world, ox, oy)).kind);
  seen.push(...kinds(settle(d, world, 48, 34)));
  assert.ok(!seen.includes("change"), seen.join(","));
  assert.equal(d.pending, false);
  // larger move beyond registration range: viewpoint change, still no paid change
  seen.length = 0;
  seen.push(...kinds(settle(d, world, 62, 40)));
  assert.ok(!seen.includes("change"), seen.join(","));
});

test("placement while still qualifies; same scene does not qualify again after accept()", () => {
  const d = new ChangeDetector();
  const world = makeWorld();
  settle(d, world);
  const placed = block(world, 80, 60, 10, 8);
  const reports = settle(d, placed);
  assert.equal(reports.at(-1).kind, "change");
  assert.equal(d.pending, true);
  d.accept();
  assert.ok(!kinds(settle(d, placed)).includes("change"));
});

test("placement followed by head movement is NOT lost (latch survives camera motion)", () => {
  const d = new ChangeDetector();
  const world = makeWorld();
  settle(d, world);
  const hand = block(world, 80, 64, 16, 22, 30);
  d.observe(view(hand));                       // hand enters the ROI: local activity
  const placed = block(world, 80, 60, 10, 8);
  d.observe(view(placed));
  // user immediately looks around before the view ever becomes stable
  for (const [ox, oy] of [[50, 36], [58, 41], [61, 42]]) d.observe(view(placed, ox, oy));
  const reports = settle(d, placed, 61, 42);
  assert.equal(reports.at(-1).kind, "change", kinds(reports).join(","));
});

test("removal and rotation are changes; hand passing through without change is not", () => {
  const world = makeWorld();
  const placed = block(world, 80, 60, 12, 6);
  const d = new ChangeDetector();
  settle(d, placed);
  assert.equal(settle(d, world).at(-1).kind, "change", "removal");
  d.accept();
  assert.equal(settle(d, block(world, 80, 60, 6, 12)).at(-1).kind, "change", "rotation (footprint changes)");
  d.accept();
  const rotated = block(world, 80, 60, 6, 12);
  const hand = block(rotated, 80, 66, 18, 24, 25);
  d.observe(view(hand));
  d.observe(view(hand));
  const after = settle(d, rotated);
  assert.ok(!kinds(after).includes("change"), kinds(after).join(","));
  assert.equal(d.pending, false, "hand-only occlusion clears the latch once the scene matches the reference");
});

test("hand occlusion is never 'stable' while moving; lighting change alone is not a change", () => {
  const world = makeWorld();
  const d = new ChangeDetector();
  settle(d, world);
  const moving = [block(world, 70, 66, 18, 24, 25), block(world, 78, 62, 18, 24, 25), block(world, 86, 58, 18, 24, 25)]
    .map((w) => d.observe(view(w)).kind);
  assert.ok(!moving.includes("change"), moving.join(","));
  const lit = settle(d, world, 40, 30, { gain: 1.25, offset: 12 });
  assert.ok(!kinds(lit).includes("change"), kinds(lit).join(","));
});

test("moving closer re-baselines without a change, but qualifies after 'another view needed'", () => {
  const world = makeWorld();
  const placed = block(world, 80, 60, 10, 8);
  const d = new ChangeDetector();
  settle(d, placed);
  assert.ok(!kinds(settle(d, placed, 40, 30, { zoom: 1.6 })).includes("change"));
  settle(d, placed);
  d.requestNewView();
  assert.equal(settle(d, placed, 40, 30, { zoom: 1.6 }).at(-1).kind, "change");
});

test("pre-existing construction becomes the baseline (no automatic paid call), duplicate frames carry no evidence", () => {
  const world = block(makeWorld(), 80, 60, 10, 8);
  const d = new ChangeDetector();
  const reports = settle(d, world);
  assert.ok(kinds(reports).includes("baseline-set"));
  assert.ok(!kinds(reports).includes("change"));
  const f = view(world);
  d.observe(f);
  assert.equal(d.observe({ ...f }).kind, "settling", "same frame clock is not new evidence");
  d.reset();
  assert.equal(d.hasBaseline, false);
});
