/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS harness transpiles TS modules. */
/* Phase 6.2: validated inspection summary bridge — no frames or masks stored. */
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
  summarizeInspection,
  summarizeVerification,
  errorSummary,
  validateSummary,
  saveInspectionSummary,
  loadInspectionSummary,
  resultHeadline,
  resultLines,
} = require("../src/lib/ar/inspectionResult.ts");

const workflow = (overrides = {}) => ({
  step_id: "step-1",
  status: "incorrect",
  confidence: 0.9,
  visible_blocks: [],
  issues: [{
    type: "wrong_color", block_id: null,
    description: "The top block is red instead of blue.",
    expected: "A blue block on top.", observed: "A red block on top.",
    suggested_fix: "Replace the red block with the blue block.", bounding_box: null,
  }],
  explanation: "The assembly does not match the expected step.",
  next_action: "Fix the top block, then verify again.",
  active_vision: null,
  analyzed_snapshot: { data_url: "data:image/jpeg;base64,AAAA", width: 64, height: 48 },
  inspection_id: "insp-1",
  snapshot_id: "a".repeat(64),
  specification_id: "b".repeat(64),
  state: "correction_required",
  tracked_issues: [],
  correction_plan: [{ issue_id: null, block_id: null, kind: "adjust", instruction: "Swap the red block for the blue one." }],
  muse_call_count: 1,
  meta_attempt_count: 1,
  model: "muse-spark-1.3",
  model_latency_ms: 10,
  inspected_at: "2026-11-01T00:00:00.000Z",
  ...overrides,
});

function fakeStorage() {
  const store = new Map();
  global.window = { sessionStorage: {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  } };
  return store;
}

test("summary keeps real fields and stores no frame, data URL or mask", () => {
  const s = summarizeInspection(workflow(), "proj-1");
  assert.equal(s.status, "incorrect");
  assert.equal(s.issues[0].expected, "A blue block on top.");
  assert.equal(s.issues[0].observed, "A red block on top.");
  assert.equal(s.issues[0].suggested_fix, "Replace the red block with the blue block.");
  assert.deepEqual(s.correctionPlan, ["Swap the red block for the blue one."]);
  assert.equal(s.nextAction, "Fix the top block, then verify again.");
  const serialized = JSON.stringify(s);
  assert.ok(!serialized.includes("data_url") && !serialized.includes("analyzed_snapshot"));
  assert.ok(!("analyzed_snapshot" in s) && !("segmentations" in s));
});

test("handoff is scoped to project, step and specification; stale is dropped", () => {
  fakeStorage();
  saveInspectionSummary(summarizeInspection(workflow(), "proj-1"));
  const now = Date.now();
  assert.equal(loadInspectionSummary("proj-1", "step-1", "b".repeat(64), now)?.inspectionId, "insp-1");
  assert.equal(loadInspectionSummary("proj-2", "step-1", null, now), null);
  assert.equal(loadInspectionSummary("proj-1", "step-2", null, now), null);
  assert.equal(loadInspectionSummary("proj-1", "step-1", "c".repeat(64), now), null); // spec changed
  assert.equal(loadInspectionSummary("proj-1", "step-1", null, now), null); // cleared as stale
  saveInspectionSummary(summarizeInspection(workflow(), "proj-1"));
  assert.equal(loadInspectionSummary("proj-1", "step-1", null, now + 31 * 60000), null); // TTL
  delete global.window;
});

test("a failed inspection replaces a previous success as the latest result", () => {
  fakeStorage();
  saveInspectionSummary(summarizeInspection(workflow({ status: "correct", state: "correct", issues: [], correction_plan: [] }), "proj-1"));
  assert.equal(resultHeadline(loadInspectionSummary("proj-1", "step-1"), false).text, "AI Assessment: Correct — fresh verification required");
  saveInspectionSummary(errorSummary("proj-1", "step-1", "Meta returned HTTP 503"));
  const latest = loadInspectionSummary("proj-1", "step-1");
  assert.equal(latest.kind, "error");
  assert.equal(resultHeadline(latest, false).text, "Inspection Failed");
  assert.match(resultLines(latest, false).join(" "), /not an incorrect assembly/);
  delete global.window;
});

test("correct assessment is not verified progress; verification summary can be verified", () => {
  const correct = summarizeInspection(workflow({ status: "correct", state: "correct", issues: [], correction_plan: [] }), "p");
  assert.equal(resultHeadline(correct, false).text, "AI Assessment: Correct — fresh verification required");
  assert.match(resultLines(correct, false).join(" "), /Step verified: No — fresh verification required/);
  assert.equal(resultHeadline(correct, true).tone, "verified");
  const verified = summarizeVerification({
    verification_id: "v1", previous_inspection_id: "insp-1", status: "verified",
    inspection: workflow({ status: "correct", state: "verified", issues: [], correction_plan: [], inspection_id: "insp-2" }),
    issue_assessments: [],
  }, "p");
  assert.equal(verified.verificationStatus, "verified");
  assert.equal(resultHeadline(verified, false).text, "✓ Step Verified");
  const still = summarizeVerification({
    verification_id: "v2", previous_inspection_id: "insp-1", status: "still_incorrect",
    inspection: workflow({ state: "still_incorrect", inspection_id: "insp-3" }), issue_assessments: [],
  }, "p");
  assert.match(resultHeadline(still, false).text, /Incorrect — Correction Required/);
  assert.match(resultLines(still, false).join(" "), /Replace the red block/);
});

test("uncertain result carries the requested additional view", () => {
  const s = summarizeInspection(workflow({
    status: "uncertain", state: "uncertain", issues: [], correction_plan: [],
    active_vision: { reason: "The top is hidden", requested_view: "top_down", instruction: "Take a top-down photo." },
  }), "p");
  assert.equal(resultHeadline(s, false).tone, "uncertain");
  const lines = resultLines(s, false).join(" ");
  assert.match(lines, /top_down/);
  assert.match(lines, /Take a top-down photo/);
});

test("unvalidated stored payloads are rejected", () => {
  assert.equal(validateSummary(null), null);
  assert.equal(validateSummary({ kind: "inspection", projectId: "p" }), null);
  const good = summarizeInspection(workflow(), "p");
  assert.ok(validateSummary(good));
  assert.equal(validateSummary({ ...good, status: "verified" }), null); // not an AI status
  assert.equal(validateSummary({ ...good, issues: [{ type: "x" }] }), null);
  assert.equal(validateSummary({ ...good, explanation: "x".repeat(5000) }), null);
});
