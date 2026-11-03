/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS harness transpiles TS modules. */
/* AR result panel: layout, image size, no technical frame text, result types (mocked XR/canvas — not HoloLens proof). */
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
const THREE = require("three");

/* Canvas recorder: every text with its position, every image draw. */
const ops = { texts: [], images: [] };
class Renderer {
  constructor() {
    this.domElement = { remove() {} };
    this.xr = { enabled: false, setReferenceSpaceType() {}, getReferenceSpace: () => this.space,
      setSession: async (session) => { this.space = session.space; } };
  }
  setPixelRatio() {} setSize() {} setClearColor() {}
  setAnimationLoop(fn) { this.loop = fn; }
  dispose() {}
  render() {}
}
const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function (name, ...args) {
  return name === "three" ? { ...THREE, WebGLRenderer: Renderer } : originalLoad.call(this, name, ...args);
};
global.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({
  clearRect() {}, fillRect() {}, strokeRect() {},
  drawImage(img, x, y, w, h) { ops.images.push({ img, x, y, w, h }); },
  fillText(t, x, y) { ops.texts.push({ t: String(t), x, y }); },
  measureText: (t) => ({ width: String(t).length * 11 }), beginPath() {}, arc() {}, stroke() {}, fill() {},
}) }) };
global.XRRigidTransform = class { constructor(p, o) { this.position = p; this.orientation = o; } };
const { SpatialSession, resultLayout, resultRows, guideLayout, progressSegments, layoutButtons, PANEL_BUTTONS_TOP } = require("../src/lib/ar/runtime.ts");
const { resultLines, resultHeadline } = require("../src/lib/ar/inspectionResult.ts");
const { captureView } = require("../src/lib/ar/capturePreview.ts");
const { deriveGuide } = require("../src/lib/ar/guidedFlow.ts");

class Session extends EventTarget {
  constructor() { super(); this.space = new EventTarget(); this.visibilityState = "visible"; this.inputSources = []; }
  async end() { this.dispatchEvent(new Event("end")); }
}
const placement = () => ({
  target_block_id: "yellow", instance: 1, origin: "tabletop_session", method: "manual_authoring",
  evidence: "measured", confirmed: true,
  dimensions: { x_mm: 16, y_mm: 9.6, z_mm: 32 },
  studs: { x: 2, z: 4, pitch_mm: 8, diameter_mm: 4.8, height_mm: 1.8 },
  position_m: [0.016, 0.0096, 0], rotation_deg: [0, 90, 0],
});
const frameWith = (pose) => ({
  getViewerPose: () => ({ transform: { matrix: new THREE.Matrix4().makeTranslation(0, 1.6, 0).toArray() } }),
  getPose: () => pose,
  getHitTestResults: () => [],
});
async function setup() {
  const runtime = new SpatialSession(new Session(), { appendChild() {} }, () => {}, () => {}, () => {});
  await runtime.initialize();
  runtime.update({ placement: placement(), text: "Step 2", detail: "" });
  runtime.frame(0, frameWith(null));
  runtime.confirming = true; // the assembly field is confirmed (guided buttons instead of placement controls)
  runtime.frame(1, frameWith(null));
  ops.texts = [];
  ops.images = [];
  return runtime;
}
/* The capture record of the inspected image (same as the AR page builds it). */
const record = (over = {}) => ({
  id: 7, projectId: "p", stepId: "s1", source: "hololens camera", intent: "inspect",
  capturedAt: new Date(Date.now() - 30_000).toISOString(), width: 1280, height: 720,
  dataUrl: "data:image/jpeg;base64,AA", fingerprint: "ab".repeat(32), phase: "complete", detail: "Meta response received",
  sent: true, result: "? Uncertain", ...over,
});
const trace = {
  metaCalled: true, metaModel: "muse-spark-1.3", metaAttempts: 1, metaLatencyMs: 4200,
  width: 1280, height: 720, frameFresh: true, cameraSource: "hololens",
  uncertainReason: "The printed side is not visible from this angle.", uncertainCause: "evidence",
};
const summary = (over = {}) => ({
  kind: "inspection", projectId: "p", stepId: "s1", status: "uncertain", state: "uncertain",
  verificationStatus: null, explanation: "The brick position could not be confirmed.", nextAction: "Show the printed side.",
  issues: [{ type: "orientation", description: "Printed side not visible", expected: "Print “Involve Me” facing you", observed: "Plain side", suggested_fix: "Rotate the brick 180°" }],
  correctionPlan: [], activeVision: null, errorMessage: null, trace,
  overall: { kind: "uncertain", printGate: "uncertain", expectedPrint: "Involve Me", observedPrint: "not read", printAction: "Turn the printed side towards the camera." },
  ...over,
});
function show(runtime, s, opts = {}) {
  const head = resultHeadline(s, false);
  const g = deriveGuide({ anchored: true, checking: false, serverVerified: false, manuallyConfirmed: false, isLastStep: false,
    summary: { kind: s.kind, overall: s.overall } });
  runtime.update({
    placement: placement(), text: "Step 2 — Place the yellow brick", stepLabel: "Step 2 of 5", detail: "",
    resultHeadline: head.text, resultTone: head.tone, resultLines: resultLines(s, false), primary: g.buttons, ...opts,
  });
  runtime.setViewMode("result");
}
const drawn = () => ops.texts.map((o) => o.t).join("\n");

test("result view: no technical frame metadata; the domain result stays visible", async () => {
  const runtime = await setup();
  runtime.setCaptures(captureView(record()), captureView(record()), { label: "", tone: "idle" });
  runtime.setCaptureBitmap(7, { width: 1280, height: 720 });
  ops.texts = [];
  show(runtime, summary());
  const t = drawn();
  for (const banned of [/CAPTURED FRAME/i, /\bFrame\b/, /fresh YES/i, /via hololens/i, /1280\s*[x×]\s*720/, /Meta called/i,
    /muse-spark/, /attempt\(s\)/, /\d\d:\d\d:\d\d/, /SHA-256/, /\(sent\)/, /Uncertain cause \(/])
    assert.doesNotMatch(t, banned, `main result view must not show ${banned}`);
  assert.match(t, /\? Uncertain — Another View Needed/, "result status");
  assert.match(t, /Why uncertain:/);
  assert.match(t, /printed side is not visible/, "explanation of the uncertainty");
  assert.match(t, /Problem:/);
  assert.match(t, /Expected:/);
  assert.match(t, /Observed:/);
  assert.match(t, /Check Again/);
  assert.match(t, /Confirm Position/);
  assert.match(t, /Step 2 of 5/, "current assembly step");
  await runtime.end();
});

test("captured image: larger than before, aspect preserved, inside the content area (landscape and portrait)", async () => {
  const L = resultLayout(true);
  const old = { w: 340, h: 270 };
  assert.ok(L.image.w * L.image.h >= 1.4 * old.w * old.h, "at least 40 % more image area");
  assert.ok(L.image.x >= L.text.x + L.text.w + 12, "clear of the text column");
  assert.ok(L.image.y >= 64 + 8, "below the title bar");
  assert.ok(L.image.y + L.image.h <= 448 - 24, "clear of the page indicator and voice line");
  assert.ok(L.image.y + L.image.h < PANEL_BUTTONS_TOP && L.image.x + L.image.w <= 1024 - 16);
  const runtime = await setup();
  for (const [w, h] of [[1280, 720], [720, 1280], [640, 480]]) {
    runtime.setCaptures(captureView(record()), captureView(record()), { label: "", tone: "idle" });
    runtime.setCaptureBitmap(7, { width: w, height: h });
    ops.images = [];
    show(runtime, summary());
    const img = ops.images.at(-1);
    assert.ok(img, `image drawn for ${w}×${h}`);
    assert.ok(Math.abs(img.w / img.h - w / h) < 0.02, `aspect kept for ${w}×${h}`);
    assert.ok(img.x >= L.image.x && img.y >= L.image.y && img.x + img.w <= L.image.x + L.image.w && img.y + img.h <= L.image.y + L.image.h,
      `fully inside the image box for ${w}×${h}`);
    assert.ok(img.w === L.image.w - 8 || img.h === L.image.h - 8, "fills the box on one axis");
  }
  await runtime.end();
});

test("long results never overflow: text stays in its column and above the buttons; pagination still works", async () => {
  const runtime = await setup();
  runtime.setCaptures(captureView(record()), captureView(record()), { label: "", tone: "idle" });
  const long = summary({
    explanation: "The ".concat("very long explanation of the observed assembly state ".repeat(30)),
    issues: Array.from({ length: 6 }, (_, i) => ({ type: "position", description: `Issue ${i} ${"detail ".repeat(20)}`, expected: "a", observed: "b", suggested_fix: "c" })),
  });
  ops.texts = [];
  show(runtime, long, { resultHeadline: "✗ Incorrect — the yellow brick is rotated and its printed side faces away from the camera view", resultTone: "incorrect" });
  const L = resultLayout(true);
  const body = ops.texts.filter((o) => o.y > 74 && o.y < PANEL_BUTTONS_TOP && o.x < L.image.x);
  assert.ok(body.length > 5);
  for (const o of body) {
    assert.ok(o.y <= 448, `"${o.t}" above the buttons`);
    if (!/^Text page/.test(o.t)) assert.ok(o.x + o.t.length * 11 <= L.image.x + 4, `"${o.t}" stays left of the image`);
  }
  assert.match(drawn().replace(/\n/g, " "), /faces away from the camera view/, "long headline wraps, never cut");
  assert.ok(runtime.textPage.count > 1, "paginated");
  runtime.turnPage(1);
  assert.equal(runtime.textPage.page, 1, "More Text pages forward");
  runtime.turnPage(-1);
  assert.equal(runtime.textPage.page, 0, "Previous Text pages back");
  await runtime.end();
});

test("result types: consistent headline, tone and main action", () => {
  const g = (overall, kind = "inspection") => deriveGuide({ anchored: true, checking: false, serverVerified: overall === "verified",
    manuallyConfirmed: false, isLastStep: false, summary: { kind, overall: overall ? { kind: overall } : null } });
  assert.deepEqual(g("uncertain").buttons.map((b) => b.label), ["Check Again", "Confirm Position"]);
  assert.deepEqual(g("verified").buttons.map((b) => b.label), ["Next Step ▶"]);
  assert.deepEqual(g(null, "error").buttons.map((b) => b.label)[0], "Check Again", "error: Check Again is the main action");
  assert.equal(resultHeadline(summary(), false).tone, "uncertain");
  assert.equal(resultHeadline(summary({ kind: "inspecting" }), false).text, "Inspecting by Meta…");
  assert.equal(resultHeadline(summary({ kind: "inspecting" }), false).tone, "inspecting");
  assert.equal(resultHeadline(summary({ kind: "error", errorMessage: "Network down" }), false).text, "Inspection Failed");
  assert.match(resultLines(summary({ kind: "error", errorMessage: "Network down" }), false).join(" "), /Error: Network down/, "existing error message kept");
  // Main action is the first, widest and the only "main" button.
  const two = layoutButtons([{ id: "verify", label: "Check Again" }, { id: "confirm", label: "Confirm Position" }]);
  const [main, second] = two.filter((b) => b.primary);
  assert.equal(main.id, "verify");
  assert.equal(main.main, true);
  assert.ok(!second.main && main.w > second.w, "Check Again is more prominent than Confirm Position");
  assert.ok(two.filter((b) => !b.primary).every((b) => !b.main && b.h < main.h), "secondary controls are smaller");
});

test("panel rows: labels are highlighted separately and wrapped lines keep their text", () => {
  const rows = resultRows(["Expected: Print “Involve Me” facing you", "Plain sentence without a label that is long enough to wrap twice here"], 30);
  assert.equal(rows[0].label, "Expected");
  assert.match(rows[0].text, /^Print/);
  assert.ok(rows.slice(1).every((r) => r.label === null));
  assert.equal(rows.map((r) => (r.label ? `${r.label}: ${r.text}` : r.text)).join(" ").replace(/\s+/g, " "),
    "Expected: Print “Involve Me” facing you Plain sentence without a label that is long enough to wrap twice here");
});

test("in-progress Meta inspection is shown as 'Inspecting by Meta…' in the panel; result then replaces it", async () => {
  const runtime = await setup();
  ops.texts = [];
  show(runtime, summary({ kind: "inspecting", state: "inspecting", overall: null, trace: null }), { primary: [] });
  assert.match(drawn(), /Inspecting by Meta…/);
  ops.texts = [];
  show(runtime, summary());
  assert.doesNotMatch(drawn(), /Inspecting by Meta…/);
  assert.match(drawn(), /Uncertain — Another View Needed/);
  await runtime.end();
});

test("instruction photo: moderately larger, aspect preserved, never under its caption, text column clear", async () => {
  const G = guideLayout(true);
  const old = { w: 358, h: 300 };
  const ratio = (G.photo.w * G.photo.h) / (old.w * old.h);
  assert.ok(ratio >= 1.15 && ratio <= 1.4, `moderate enlargement (×${ratio.toFixed(2)})`);
  assert.ok(G.photo.x >= G.banner.x + G.textW + 12, "clear of the instruction column");
  assert.ok(G.photo.y + G.photo.h <= 448 - 24 && G.photo.x + G.photo.w <= 1024 - 16, "inside the content area, above the buttons");
  const runtime = await setup();
  runtime.update({ placement: placement(), text: "Step 3 — Place", stepLabel: "Step 3 of 4", detail: "", hasReference: true,
    instruction: "Place the yellow 2×4 brick ".repeat(40), shortInstruction: "Place the yellow 2×4 brick on the green marker.",
    guideLabel: "Ready", guideMessage: "Place the brick, then select Check Step.", primary: [{ id: "verify", label: "Check Step" }] });
  runtime.setShowReference(true);
  for (const [w, h] of [[1600, 900], [900, 1600], [1024, 768]]) {
    ops.images = [];
    ops.texts = [];
    runtime.setReferenceImage({ width: w, height: h, close() {} });
    runtime.setViewMode("guide");
    const img = ops.images.at(-1);
    assert.ok(img, `photo drawn for ${w}×${h}`);
    assert.ok(Math.abs(img.w / img.h - w / h) < 0.02, `aspect kept for ${w}×${h}`);
    assert.ok(img.x >= G.photo.x && img.x + img.w <= G.photo.x + G.photo.w, "horizontally inside the box");
    assert.ok(img.y >= G.photo.y && img.y + img.h <= G.photo.y + G.photo.h - G.captionH, "never under the caption");
    assert.ok(img.w === G.photo.w - 8 || img.h === G.photo.h - 8 - G.captionH, "fills the box on one axis (fully visible)");
    const left = ops.texts.filter((o) => o.y > 74 && o.y < PANEL_BUTTONS_TOP && o.x < G.photo.x && !/^Text page/.test(o.t));
    for (const o of left) assert.ok(o.x + o.t.length * 11 <= G.photo.x + 4, `"${o.t}" left of the photo`);
    assert.ok(ops.texts.some((o) => o.t === "Expected result"), "caption");
  }
  assert.ok(runtime.textPage.count > 1, "long instructions paginate beside the photo");
  await runtime.end();
});

test("progress bar segments: done / current / upcoming, current turns done once verified", () => {
  assert.deepEqual(progressSegments({ position: 3, total: 4, currentVerified: false }), ["done", "done", "current", "todo"]);
  assert.deepEqual(progressSegments({ position: 4, total: 4, currentVerified: true }), ["done", "done", "done", "done"]);
  assert.equal(progressSegments({ position: 1, total: 500, currentVerified: false }).length, 60, "bounded for very long builds");
});

test("Finish: drawn as the main green action on the verified last step; Assembly complete afterwards", async () => {
  const runtime = await setup();
  const g = deriveGuide({ anchored: true, checking: false, serverVerified: true, manuallyConfirmed: false, isLastStep: true, summary: null });
  ops.texts = [];
  runtime.update({ placement: placement(), text: "Step 4", stepLabel: "Step 4 of 4", detail: "", guideLabel: g.label, guideMessage: g.message,
    guideTone: g.tone, primary: g.buttons, progress: { position: 4, total: 4, currentVerified: true } });
  runtime.setViewMode("guide");
  assert.match(drawn(), /Finish/);
  assert.doesNotMatch(drawn(), /Next Step/);
  const finish = layoutButtons(g.buttons).find((b) => b.id === "finish");
  assert.ok(finish && finish.primary && finish.main && finish.w >= 400 && finish.h >= 96, "large main action");
  const doneView = deriveGuide({ anchored: true, checking: false, serverVerified: true, manuallyConfirmed: false, isLastStep: true, finished: true, summary: null });
  ops.texts = [];
  runtime.update({ placement: placement(), text: "Step 4", stepLabel: "Step 4 of 4", detail: "", guideLabel: doneView.label,
    guideMessage: doneView.message, guideTone: doneView.tone, primary: doneView.buttons });
  runtime.setViewMode("guide");
  assert.match(drawn(), /ASSEMBLY COMPLETE/);
  assert.doesNotMatch(drawn(), /\bFinish\b/, "no Finish button after completion");
  await runtime.end();
});

test("Finish handler contract: last step only, re-reads server progress, never moves the cursor or writes progress", () => {
  const src = fs.readFileSync(require.resolve("../src/components/ar/ARWorkspace.tsx"), "utf8");
  const fn = src.slice(src.indexOf("async function finishAssembly"), src.indexOf("/** Visible manual fallback (Confirm Position)"));
  assert.ok(fn.length > 100, "finishAssembly exists");
  assert.match(fn, /index !== project\.steps\.length - 1/, "rejected unless on the last step");
  assert.match(fn, /await getProgress\(projectId\)/, "server progress is re-read");
  assert.match(fn, /status !== "verified"[\s\S]*not verified yet/, "requires backend verification of the last step");
  assert.match(fn, /viewRef\.current\.step_id !== stepId/, "a step change meanwhile finishes nothing");
  assert.match(fn, /coordinatorRef\.current\.busy/, "not while an inspection runs");
  assert.doesNotMatch(fn, /navigate\(|setView\(|moveCursor\(|verifySnapshot\(|inspectSnapshot\(/, "no step move, no new Meta call");
  assert.match(src, /case "finish":\s*return finishAssembly\(\);/, "the panel/2D Finish button dispatches it");
});
