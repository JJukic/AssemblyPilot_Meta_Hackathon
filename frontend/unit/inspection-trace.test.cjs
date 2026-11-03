/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS harness transpiles TS modules. */
/* Inspection diagnostics: frame quality, uncertain taxonomy, trace identity. */
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
const { assessFrameQuality, classifyUncertain } = require("../src/lib/ar/monitoring.ts");
const { InspectionTrace, snapshotFingerprint, encodedByteSize } = require("../src/lib/ar/inspectionTrace.ts");

test("black, blank and content-free frames are rejected before any Meta call", () => {
  assert.equal(assessFrameQuality(0, 0).ok, false);
  assert.match(assessFrameQuality(1, 5).reason, /black/);
  assert.equal(assessFrameQuality(255, 0).ok, false);
  assert.equal(assessFrameQuality(120, 0).ok, false);
  assert.match(assessFrameQuality(120, 0).reason, /no image content/);
  assert.equal(assessFrameQuality(120, 800).ok, true);
});

test("uncertain taxonomy distinguishes print, face, geometry, semantic and infrastructure", () => {
  assert.equal(classifyUncertain({ printGate: "uncertain" }).cause, "print");
  assert.equal(classifyUncertain({ faceStatus: "uncertain" }).cause, "face");
  assert.equal(classifyUncertain({ geometryConstrained: true, geometryStatus: "not_measured" }).cause, "geometry");
  assert.equal(classifyUncertain({ geometryConstrained: false, geometryStatus: "not_measured" }).cause, "none");
  assert.equal(classifyUncertain({ state: "uncertain", status: "uncertain" }).cause, "semantic");
  assert.equal(classifyUncertain({ kind: "error" }).cause, "infrastructure");
  assert.match(classifyUncertain({ kind: "error" }).reason, /not a Meta visual judgment/);
  assert.equal(classifyUncertain({ state: "correct", status: "correct", printGate: "pass" }).cause, "none");
});

test("trace correlation is the snapshot fingerprint and history stays bounded", async () => {
  const dataUrl = "data:image/jpeg;base64," + Buffer.from("fake-jpeg-bytes").toString("base64");
  const fp = await snapshotFingerprint(dataUrl);
  assert.match(fp, /^[a-f0-9]{64}$/);
  assert.equal(fp, await snapshotFingerprint(dataUrl));
  assert.ok(encodedByteSize(dataUrl) > 0);
  const store = new Map();
  global.sessionStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
  };
  global.window = global;
  for (let i = 0; i < 25; i++) {
    const trace = new InspectionTrace("external", "p1", "s1");
    trace.stage("FRAME_CAPTURED", "test");
    trace.save();
  }
  const { loadTraces } = require("../src/lib/ar/inspectionTrace.ts");
  assert.equal(loadTraces().length, 20);
  delete global.sessionStorage;
  delete global.window;
});
