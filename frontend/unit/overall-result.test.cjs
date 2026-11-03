/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS harness transpiles TS modules. */
/* Overall result: a green semantic assessment must never hide a failed mandatory gate. */
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
const { overallResult } = require("../src/lib/overall.ts");
const {
  summarizeInspection, summarizeVerification, saveInspectionSummary,
  loadInspectionSummary, resultHeadline, resultLines, validateSummary,
} = require("../src/lib/ar/inspectionResult.ts");

const PRINT_FAIL = {
  schema_version: 1, target_block_id: "block-1", expected_print: "Involve Me",
  observed_print: "insights", observed_logo: null, observed_registered_side_id: null,
  observed_registered_side_name: null, recognition_status: "mismatch",
  recognition_method: "meta_zero_shot", evidence_quality: "clear", known_alternative: true,
  description: "Wrong side.", suggested_action: "Present the registered print “Involve Me” on the required surface, then capture a fresh image.",
  snapshot_id: "a".repeat(64), bounding_box: null, reference_image_id: null,
  direction_required: false, direction_supported: false, gate_status: "fail",
};

function workflow(over = {}) {
  return {
    step_id: "s1", specification_id: "spec", inspection_id: "insp", snapshot_id: "a".repeat(64),
    state: "correction_required", status: "correct", explanation: "Shape and color look right.",
    issues: [], correction_plan: [], next_action: "Fix it.", active_vision: null,
    print_recognition: PRINT_FAIL, face: null, geometry: null, ...over,
  };
}

test("A/E: semantic correct + print fail => overall incorrect, never correct", () => {
  const o = overallResult({ state: "correction_required", status: "correct", printGate: "fail" });
  assert.equal(o.kind, "incorrect");
  assert.match(o.headline, /INCORRECT/);
  // Even without the backend state, the gate alone decides.
  assert.equal(overallResult({ status: "correct", printGate: "fail" }).kind, "incorrect");
});

test("B: print pass + all gates pass => correct, still not verified", () => {
  const o = overallResult({ state: "correct", status: "correct", printGate: "pass" });
  assert.equal(o.kind, "correct");
  assert.match(o.headline, /FRESH VERIFICATION REQUIRED/);
});

test("C: uncertain print evidence => overall uncertain, no pass", () => {
  assert.equal(overallResult({ state: "uncertain", status: "correct", printGate: "uncertain" }).kind, "uncertain");
});

test("D: correct print but unsupported required direction => uncertain, not verified", () => {
  assert.equal(
    overallResult({ state: "uncertain", status: "correct", printGate: "uncertain", faceStatus: "uncertain" }).kind,
    "uncertain",
  );
});

test("F/G: geometry or face failure overrides semantic correct", () => {
  assert.equal(overallResult({ status: "correct", geometryConstrained: true, geometryStatus: "incorrect" }).kind, "incorrect");
  assert.equal(overallResult({ status: "correct", faceStatus: "incorrect" }).kind, "incorrect");
  assert.equal(overallResult({ status: "correct", geometryConstrained: false, geometryStatus: "incorrect" }).kind, "correct",
    "unconstrained geometry does not gate");
});

test("H: only backend-recorded verification yields Step Verified", () => {
  assert.equal(overallResult({ state: "verified", status: "correct", printGate: "pass", stepVerified: true }).kind, "verified");
  assert.equal(overallResult({ state: "correct", status: "correct", printGate: "pass" }).kind, "correct");
});

test("I: no print rule (not_applicable) invents no mandatory gate", () => {
  assert.equal(overallResult({ state: "correct", status: "correct", printGate: "not_applicable" }).kind, "correct");
});

test("J: AR summary carries the print gate; headline and lines say Incorrect with cause", () => {
  const summary = summarizeInspection(workflow(), "p1");
  assert.equal(summary.overall.kind, "incorrect");
  assert.equal(summary.overall.expectedPrint, "Involve Me");
  assert.equal(summary.overall.observedPrint, "insights");
  assert.equal(validateSummary(JSON.parse(JSON.stringify(summary)))?.stepId, "s1");
  const headline = resultHeadline(summary, false);
  assert.equal(headline.tone, "incorrect");
  assert.match(headline.text, /Incorrect — Correction Required/);
  const lines = resultLines(summary, false).join("\n");
  assert.match(lines, /Wrong printed side/);
  assert.match(lines, /Expected: Involve Me/);
  assert.match(lines, /Observed: insights/);
  // A stale pre-overall summary (state only) must also never headline Correct.
  const stale = { ...summary, overall: null };
  assert.equal(resultHeadline(stale, false).tone, "incorrect");
  // Round-trip through storage keeps identity scoping.
  const store = new Map();
  global.window = { sessionStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) } };
  saveInspectionSummary(summary);
  assert.equal(loadInspectionSummary("p1", "s1", "spec")?.overall.kind, "incorrect");
  assert.equal(loadInspectionSummary("p1", "other-step", "spec"), null);
  delete global.window;
});

test("verification summary is verified only when the backend status is verified", () => {
  const ok = summarizeVerification({ status: "verified", inspection: workflow({ state: "verified", print_recognition: { ...PRINT_FAIL, recognition_status: "match", gate_status: "pass", observed_print: "Involve Me" } }) }, "p1");
  assert.equal(ok.overall.kind, "verified");
  assert.equal(resultHeadline(ok, false).tone, "verified");
  const bad = summarizeVerification({ status: "still_incorrect", inspection: workflow() }, "p1");
  assert.equal(bad.overall.kind, "incorrect");
});
