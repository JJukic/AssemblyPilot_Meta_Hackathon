/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS harness transpiles TS modules. */
/* Guided HoloLens flow: states, visible buttons, short instruction (pure). */
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
const { deriveGuide, shortInstruction, MARKER } = require("../src/lib/ar/guidedFlow.ts");

const base = { anchored: true, checking: false, serverVerified: false, manuallyConfirmed: false, isLastStep: false, summary: null };
const sum = (kind, overall) => ({ kind, overall: overall ? { kind: overall } : null });
const ids = (v) => v.buttons.map((b) => `${b.id}:${b.label}`);

test("short instruction comes from step data, never from camera text", () => {
  assert.equal(shortInstruction([{ color: "red", name: "2x4 brick", quantity: 1 }], true), "Place the red 2×4 brick on the green marker.");
  assert.equal(shortInstruction([{ color: "rot", name: "Stein 2×4", quantity: 1 }], true), "Place the red 2×4 brick on the green marker.");
  assert.equal(shortInstruction([{ color: "yellow", name: "Involve Me", quantity: 1 }], false), "Place the yellow brick “Involve Me” in the assembly field.");
  assert.equal(shortInstruction([{ color: "blue", name: "2x2", quantity: 2 }], true), "Place 2 blue 2×2 bricks on the green marker.");
  assert.match(shortInstruction([], true), /No bricks/);
  assert.ok(shortInstruction([{ color: "red", name: "2x4 brick", quantity: 1 }], true).length < 60, "short enough for HoloLens");
});

test("Ready → Prüfe → Correct + 'Next step'", () => {
  const ready = deriveGuide(base);
  assert.equal(ready.label, "Ready");
  assert.deepEqual(ids(ready), ["verify:Check"]);
  assert.equal(ready.marker, MARKER.target);
  const checking = deriveGuide({ ...base, checking: true });
  assert.equal(checking.label, "Checking…");
  assert.deepEqual(checking.buttons, [], "no actions while checking");
  assert.equal(deriveGuide({ ...base, summary: sum("inspecting", null) }).state, "checking");
  const ok = deriveGuide({ ...base, serverVerified: true });
  assert.equal(ok.label, "Correct");
  assert.equal(ok.message, "Step correct.");
  assert.deepEqual(ids(ok), ["next:Next step ▶"]);
  assert.equal(ok.marker, MARKER.correct);
});

test("falsch → rot + 'Baustein ausrichten' + 'Check again'; teilweise → gelb + Fallback sichtbar", () => {
  const wrong = deriveGuide({ ...base, summary: sum("inspection", "incorrect") });
  assert.equal(wrong.label, "Try again");
  assert.equal(wrong.message, "Adjust the brick.");
  assert.deepEqual(ids(wrong), ["verify:Check again"]);
  assert.equal(wrong.marker, MARKER.wrong);
  assert.equal(wrong.ghostTint, MARKER.wrong);
  const partial = deriveGuide({ ...base, summary: sum("inspection", "uncertain") });
  assert.equal(partial.marker, MARKER.partial);
  assert.deepEqual(ids(partial), ["verify:Check again", "confirm:Confirm position"]);
  const failed = deriveGuide({ ...base, summary: sum("error", null) });
  assert.ok(ids(failed).includes("confirm:Confirm position"), "fallback visible when the check cannot run");
});

test("a correct inspection alone is never 'Correct' (fresh verification still needed); manual confirm is labelled as such", () => {
  const almost = deriveGuide({ ...base, summary: sum("inspection", "correct") });
  assert.equal(almost.state, "almost");
  assert.ok(!ids(almost).some((x) => x.startsWith("next")));
  const verified = deriveGuide({ ...base, summary: sum("verification", "verified") });
  assert.equal(verified.label, "Correct");
  const confirmed = deriveGuide({ ...base, manuallyConfirmed: true, summary: sum("inspection", "uncertain") });
  assert.equal(confirmed.state, "confirmed");
  assert.match(confirmed.message, /not AI verified/);
  assert.deepEqual(ids(confirmed), ["next:Next step ▶"]);
});

test("field not placed shows a placement hint; last step completes without a next button", () => {
  const placing = deriveGuide({ ...base, anchored: false });
  assert.equal(placing.state, "placing");
  assert.deepEqual(placing.buttons, []);
  assert.equal(deriveGuide({ ...base, anchored: null }).state, "ready", "2D page needs no field");
  const last = deriveGuide({ ...base, serverVerified: true, isLastStep: true });
  assert.equal(last.state, "complete");
  assert.deepEqual(last.buttons, []);
});

test("a check that could not run (camera unavailable) shows an error with the visible fallback, not the old result", () => {
  const v = deriveGuide({ ...base, checkError: "Keine Prüfung möglich: Kamera nicht verfügbar", summary: sum("inspection", "incorrect") });
  assert.equal(v.state, "error");
  assert.match(v.message, /Kamera nicht verfügbar/);
  assert.deepEqual(ids(v), ["verify:Check again", "confirm:Confirm position"]);
});
