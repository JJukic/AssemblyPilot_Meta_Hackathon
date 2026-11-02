/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS harness transpiles TS modules. */
/* Cumulative step hologram: split, validation, instances, height/stack help (pure). */
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
const { splitScene, validateHologram, nextFreeInstance, proxyBlock, duplicateBlock, stackHelp, footprint } = require("../src/lib/ar/hologram.ts");

const brick = (over = {}) => ({
  target_block_id: "yellow", instance: 1, origin: "tabletop_session", method: "manual_authoring",
  evidence: "measured", confirmed: true, dimensions: { x_mm: 31.8, y_mm: 9.6, z_mm: 15.8 },
  studs: null, position_m: [0, 0, 0], rotation_deg: [0, 0, 0], ...over,
});
const required = [{ block_id: "yellow", required_quantity: 2, name: "2x4", color: "yellow" }, { block_id: "blue", required_quantity: 1, name: "2x4", color: "blue" }];

test("scene split: earlier steps are 'assembled', the current step's blocks are 'current'; invalid entries are dropped", () => {
  const scene = { excluded: [], blocks: [
    { step_id: "s1", step_position: 1, placement: brick() },
    { step_id: "s2", step_position: 2, placement: brick({ target_block_id: "blue", position_m: [0, 0.0096, 0] }) },
    { step_id: "s2", step_position: 2, placement: brick({ instance: 2, position_m: [0.04, 0, 0] }) },
    { step_id: "s2", step_position: 2, placement: brick({ instance: 0 }) },
  ] };
  const v = splitScene(scene, "s2");
  assert.equal(v.assembled.length, 1);
  assert.equal(v.current.length, 2);
  assert.deepEqual(splitScene(scene, "s1").current.map((p) => p.target_block_id), ["yellow"]);
  assert.deepEqual(splitScene(null, "s1"), { assembled: [], current: [] });
});

test("validation mirrors the backend: duplicates, unassigned instances, foreign blocks and Y < 0", () => {
  assert.deepEqual(validateHologram([brick(), brick({ instance: 2, position_m: [0.04, 0, 0] })], required), []);
  const errors = validateHologram([
    brick(), brick(), brick({ target_block_id: "blue", instance: 2 }), brick({ target_block_id: "red" }), brick({ instance: 2, position_m: [0, -0.001, 0] }),
  ], required).join("\n");
  assert.match(errors, /already placed/);
  assert.match(errors, /exceeds the 1 required/);
  assert.match(errors, /not assigned/);
  assert.match(errors, /cannot be below the tabletop/);
});

test("add / duplicate pick the next free instance and never invent measurements", () => {
  assert.deepEqual(nextFreeInstance(required, [brick()]), { block_id: "yellow", instance: 2 });
  assert.deepEqual(nextFreeInstance(required, [brick()], "blue"), { block_id: "blue", instance: 1 });
  const p = proxyBlock({ block_id: "blue", instance: 1 });
  assert.equal(p.evidence, "approximate", "new blocks are explicitly approximate proxies");
  const dup = duplicateBlock(brick({ position_m: [0, 0.0096, 0] }), required, [brick({ position_m: [0, 0.0096, 0] })]);
  assert.equal(dup.instance, 2);
  assert.equal(dup.position_m[1], 0.0096, "same authored height");
  assert.equal(dup.position_m[0], 0.0318, "placed beside the original");
  assert.equal(dup.evidence, "measured", "same block type keeps its authored measurements");
  const other = duplicateBlock(brick(), required, [brick(), brick({ instance: 2 })]);
  assert.equal(other.target_block_id, "blue");
  assert.equal(other.evidence, "approximate", "another block type never inherits measurements");
  assert.equal(other.studs, null);
  assert.equal(duplicateBlock(brick(), required, [brick(), brick({ instance: 2 }), brick({ target_block_id: "blue" })]), null);
});

test("height help: Y is the bottom face; a stacked block rests on the body top of the block below", () => {
  const base = { label: "Yellow #1", placement: brick() };
  const onTable = stackHelp(brick(), []);
  assert.equal(onTable.status, "on_table");
  assert.equal(onTable.topMm, 9.6);
  const stacked = stackHelp(brick({ target_block_id: "blue", position_m: [0.008, 0.0096, 0] }), [base]);
  assert.equal(stacked.status, "stacked");
  assert.match(stacked.explanation, /Rests on Yellow #1 \(top 9\.6 mm\)/);
  assert.match(stacked.explanation, /studs not included/);
  const floating = stackHelp(brick({ target_block_id: "blue", position_m: [0, 0.02, 0] }), [base]);
  assert.equal(floating.status, "floating");
  assert.deepEqual(floating.suggestions.map((s) => s.yM), [0.0096], "explicit suggestion, never auto-applied");
  const sunk = stackHelp(brick({ target_block_id: "blue", position_m: [0, 0.005, 0] }), [base]);
  assert.equal(sunk.status, "intersecting");
  const beside = stackHelp(brick({ target_block_id: "blue", position_m: [0.05, 0.0096, 0] }), [base]);
  assert.equal(beside.status, "floating", "no overlap = no support");
  const approx = stackHelp(brick({ target_block_id: "blue", position_m: [0, 0.03, 0] }), [{ label: "Proxy", placement: brick({ evidence: "approximate" }) }]);
  assert.equal(approx.suggestions[0].fromApproximate, true, "suggestions say when they derive from approximate data");
  assert.equal(stackHelp(brick({ rotation_deg: [90, 0, 0] }), [base]).status, "tilted");
});

test("footprint accounts for Y rotation", () => {
  const f = footprint(brick({ rotation_deg: [0, 90, 0] }));
  assert.ok(Math.abs((f.x1 - f.x0) - 15.8) < 1e-6);
  assert.ok(Math.abs((f.z1 - f.z0) - 31.8) < 1e-6);
});
