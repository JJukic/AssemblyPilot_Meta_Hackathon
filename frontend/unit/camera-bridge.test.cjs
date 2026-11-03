/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS harness transpiles TS modules. */
/* In-AR verification: bridge validation + the no-XR-exit contract. */
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
// api.ts reads process.env only; safe in Node.
const { summaryFromBridge, bridgeSummary, validPairingCode, newPairingCode } = require("../src/lib/ar/cameraBridge.ts");

const payload = (over = {}) => ({
  mode: "inspect",
  updated_at: Math.floor(Date.now() / 1000),
  summary: {
    kind: "inspection", state: "correction_required", status: "correct",
    explanation: "Printed side wrong.", issues: [], correctionPlan: ["Present the required side."],
    nextAction: "Fix and verify.", errorMessage: null, verificationStatus: null,
    specificationId: "spec-1", inspectionId: "insp-1", snapshotId: "snap-1",
    overall: { kind: "incorrect", printGate: "fail", expectedPrint: "Involve Me",
      observedPrint: "insights", printAction: "Present the required side.", faceStatus: null, geometryStatus: null },
    ...over,
  },
});

test("bridge result validates into a scoped AR summary; stale/mismatched payloads rejected", () => {
  const summary = summaryFromBridge(payload(), "p1", "s1", "spec-1");
  assert.equal(summary.overall.kind, "incorrect");
  assert.equal(summary.projectId, "p1");
  assert.equal(summary.stepId, "s1");
  // activeVision is never carried over the bridge.
  assert.equal(summary.activeVision, null);
  assert.equal(summaryFromBridge(payload(), "p1", "s1", "other-spec"), null);
  assert.equal(summaryFromBridge(payload({ overall: { kind: "kinda-verified" } }), "p1", "s1"), null);
  assert.equal(summaryFromBridge(payload({ status: 42 }), "p1", "s1"), null);
});

test("bridge summary strips local-only fields and pairing codes are well-formed", () => {
  const code = newPairingCode();
  assert.equal(validPairingCode(code), true);
  assert.equal(validPairingCode("x"), false);
  const stripped = bridgeSummary({
    kind: "inspection", state: "correct", status: "correct", explanation: "", issues: [],
    correctionPlan: [], nextAction: "", errorMessage: null, verificationStatus: null,
    specificationId: "s", inspectionId: "i", snapshotId: "n", overall: null,
    projectId: "p", stepId: "s1", activeVision: null, updatedAt: new Date().toISOString(),
  });
  assert.equal("projectId" in stripped, false);
  assert.equal("updatedAt" in stripped, false);
});

test("Verify Step contract: XR verify never ends the session or routes to the camera workspace", () => {
  const source = fs.readFileSync(__dirname + "/../src/components/ar/ARWorkspace.tsx", "utf8");
  const handleVerify = source.slice(source.indexOf('case "verify":'), source.indexOf('case "confirm":'));
  // Buttons "Prüfen" / "Erneut prüfen" run the guided in-page check.
  assert.match(handleVerify, /checkStep\(\)/);
  assert.doesNotMatch(handleVerify, /verify\(\)/);
  const inAR = source.slice(source.indexOf("async function captureCheck"), source.indexOf("async function requestExternalFallback"));
  assert.match(inAR, /if \(!active && !opts\.inPage\) return done\(await verify\(mode\)\)/);
  assert.match(inAR, /captureCheck\("inspect", \{ inPage: true/, "guided check never routes to the camera workspace");
  assert.doesNotMatch(inAR, /runtime\.current\?\.end\(\)|router\.push/);
  assert.match(inAR, /performInARInspection/);
  assert.match(inAR, /requestExternalFallback/);
  // The only session-ending paths left are explicit Exit AR / session teardown.
  const exit = source.slice(source.indexOf("async function exitAR"), source.indexOf("async function handleAction"));
  assert.match(exit, /runtime\.current\?\.end\(\)/);
});
