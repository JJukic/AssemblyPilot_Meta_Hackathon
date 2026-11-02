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
  assert.equal(shortInstruction([{ color: "red", name: "2x4 brick", quantity: 1 }], true), "Lege den roten 2×4-Stein auf die grüne Markierung.");
  assert.equal(shortInstruction([{ color: "rot", name: "Stein 2×4", quantity: 1 }], true), "Lege den roten 2×4-Stein auf die grüne Markierung.");
  assert.equal(shortInstruction([{ color: "yellow", name: "Involve Me", quantity: 1 }], false), "Lege den gelben Baustein „Involve Me“ in das Montagefeld.");
  assert.equal(shortInstruction([{ color: "blue", name: "2x2", quantity: 2 }], true), "Lege 2 blaue 2×2-Steine auf die grüne Markierung.");
  assert.match(shortInstruction([], true), /Keine Bausteine/);
  assert.ok(shortInstruction([{ color: "red", name: "2x4 brick", quantity: 1 }], true).length < 60, "short enough for HoloLens");
});

test("Bereit → Prüfe → Korrekt + 'Nächster Schritt'", () => {
  const ready = deriveGuide(base);
  assert.equal(ready.label, "Bereit");
  assert.deepEqual(ids(ready), ["verify:Prüfen"]);
  assert.equal(ready.marker, MARKER.target);
  const checking = deriveGuide({ ...base, checking: true });
  assert.equal(checking.label, "Prüfe …");
  assert.deepEqual(checking.buttons, [], "no actions while checking");
  assert.equal(deriveGuide({ ...base, summary: sum("inspecting", null) }).state, "checking");
  const ok = deriveGuide({ ...base, serverVerified: true });
  assert.equal(ok.label, "Korrekt");
  assert.equal(ok.message, "Schritt korrekt.");
  assert.deepEqual(ids(ok), ["next:Nächster Schritt ▶"]);
  assert.equal(ok.marker, MARKER.correct);
});

test("falsch → rot + 'Baustein ausrichten' + 'Erneut prüfen'; teilweise → gelb + Fallback sichtbar", () => {
  const wrong = deriveGuide({ ...base, summary: sum("inspection", "incorrect") });
  assert.equal(wrong.label, "Noch einmal versuchen");
  assert.equal(wrong.message, "Baustein ausrichten.");
  assert.deepEqual(ids(wrong), ["verify:Erneut prüfen"]);
  assert.equal(wrong.marker, MARKER.wrong);
  assert.equal(wrong.ghostTint, MARKER.wrong);
  const partial = deriveGuide({ ...base, summary: sum("inspection", "uncertain") });
  assert.equal(partial.marker, MARKER.partial);
  assert.deepEqual(ids(partial), ["verify:Erneut prüfen", "confirm:Position bestätigen"]);
  const failed = deriveGuide({ ...base, summary: sum("error", null) });
  assert.ok(ids(failed).includes("confirm:Position bestätigen"), "fallback visible when the check cannot run");
});

test("a correct inspection alone is never 'Korrekt' (fresh verification still needed); manual confirm is labelled as such", () => {
  const almost = deriveGuide({ ...base, summary: sum("inspection", "correct") });
  assert.equal(almost.state, "almost");
  assert.ok(!ids(almost).some((x) => x.startsWith("next")));
  const verified = deriveGuide({ ...base, summary: sum("verification", "verified") });
  assert.equal(verified.label, "Korrekt");
  const confirmed = deriveGuide({ ...base, manuallyConfirmed: true, summary: sum("inspection", "uncertain") });
  assert.equal(confirmed.state, "confirmed");
  assert.match(confirmed.message, /nicht KI-geprüft/);
  assert.deepEqual(ids(confirmed), ["next:Nächster Schritt ▶"]);
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
  assert.deepEqual(ids(v), ["verify:Erneut prüfen", "confirm:Position bestätigen"]);
});
