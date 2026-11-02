/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS harness transpiles TS modules. */
/* Capture preview identity, phases and honesty (pure). */
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
const { CapturePreviewStore, captureView, indicatorFor } = require("../src/lib/ar/capturePreview.ts");

const input = (over = {}) => ({
  projectId: "p", stepId: "s1", source: "hololens camera", intent: "inspect",
  capturedAt: new Date().toISOString(), width: 1280, height: 720,
  dataUrl: "data:image/jpeg;base64,EXACT", detail: "", ...over,
});

test("the preview record IS the submitted snapshot (same data URL), with project/step/source identity", () => {
  let changes = 0;
  const store = new CapturePreviewStore(() => changes++);
  const snapshot = input();
  const id = store.begin(snapshot);
  assert.equal(store.current.dataUrl, snapshot.dataUrl);
  assert.deepEqual([store.current.projectId, store.current.stepId, store.current.source], ["p", "s1", "hololens camera"]);
  store.update(id, { fingerprint: "ab".repeat(32) });
  assert.match(captureView(store.current).lines.join(" "), /SHA-256 abababababab/);
  assert.ok(changes >= 2);
});

test("no image is labelled as uploaded unless the upload started; 'sent' can never be revoked", () => {
  const store = new CapturePreviewStore();
  const id = store.begin(input());
  assert.equal(store.current.sent, false);
  assert.match(captureView(store.current).lines.join(" "), /Upload started: no/);
  store.finish(id, "rejected", "Rejected before upload: too dark", "not sent to Meta");
  const v = captureView(store.current);
  assert.match(v.status, /IMAGE REJECTED — NOT SENT TO META/);
  assert.match(v.title, /not sent/);
  assert.equal(v.sent, false);
  const id2 = store.begin(input());
  store.update(id2, { phase: "uploading", sent: true });
  store.update(id2, { sent: false });
  assert.equal(store.current.sent, true);
  assert.match(captureView(store.current).status, /SENT TO BACKEND/);
});

test("superseded or stale captures can never be updated (late async work cannot overwrite a newer capture)", () => {
  const store = new CapturePreviewStore();
  const a = store.begin(input());
  const b = store.begin(input({ dataUrl: "data:image/jpeg;base64,NEWER" }));
  assert.equal(store.update(a, { phase: "complete" }), false);
  assert.equal(store.finish(a, "complete", "", "✓"), false);
  assert.equal(store.current.id, b);
  assert.equal(store.wants(a), false);
  store.update(b, { phase: "stale" });
  assert.equal(store.finish(b, "complete", "", "✓"), false, "a discarded request never gets a result");
});

test("result stays bound to the capture that produced it; a step change clears both", () => {
  const store = new CapturePreviewStore();
  const a = store.begin(input());
  store.finish(a, "complete", "Meta response received", "✗ Incorrect");
  const b = store.begin(input());
  assert.equal(store.lastResult.id, a);
  assert.equal(store.byId(a).result, "✗ Incorrect");
  assert.equal(store.byId(b).result, null, "the new capture carries no old result");
  store.invalidate();
  assert.equal(store.current, null);
  assert.equal(store.lastResult, null);
  assert.equal(store.byId(a), null);
});

test("indicator reflects real phases only", () => {
  const store = new CapturePreviewStore();
  assert.equal(indicatorFor(null, true).label, "○ WATCHING");
  assert.equal(indicatorFor(null, false).label, "");
  const id = store.begin(input());
  assert.match(indicatorFor(store.current, true).label, /CAPTURED/);
  store.update(id, { phase: "uploading", sent: true });
  assert.match(indicatorFor(store.current, true).label, /INSPECTING/);
  store.finish(id, "failed", "TRANSPORT ERROR", "TRANSPORT ERROR");
  assert.match(indicatorFor(store.current, true).label, /ERROR/);
  assert.equal(captureView(store.current).isNew, true);
  assert.equal(captureView(store.current, Date.now() + 10_000).isNew, false);
});
