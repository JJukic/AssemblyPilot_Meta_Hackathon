/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS harness transpiles TS modules. */
/* Visible hand ray: mocked XR input only — never proof of HoloLens tracking. */
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
const { uvToPanel, rayEndpoint, SelectDebouncer, effectiveHover } = require("../src/lib/ar/interaction.ts");
const placement = () => ({
  target_block_id: "yellow", instance: 1, origin: "tabletop_session", method: "manual_authoring",
  evidence: "measured", confirmed: true,
  dimensions: { x_mm: 16, y_mm: 9.6, z_mm: 32 },
  studs: { x: 2, z: 4, pitch_mm: 8, diameter_mm: 4.8, height_mm: 1.8 },
  position_m: [0.016, 0.0096, 0], rotation_deg: [0, 90, 0],
});

test("pure mapping: UV->panel pixels and ray endpoint are exact", () => {
  assert.deepEqual(uvToPanel({ x: 0.5, y: 0.5 }, 1024, 640), { x: 512, y: 320 });
  assert.deepEqual(uvToPanel({ x: 0, y: 1 }, 1024, 640), { x: 0, y: 0 });
  assert.deepEqual(rayEndpoint([0, 1.6, 0], [0, 0, -1], 0.85), [0, 1.6, -0.85]);
  assert.deepEqual(rayEndpoint([0, 0, 0], [1, 0, 0], null, 1.5), [1.5, 0, 0]);
  assert.equal(effectiveHover([null, "next"]), "next");
  assert.equal(effectiveHover([null, null]), null);
});

test("debouncer: one gesture per source per window, independent sources", () => {
  const d = new SelectDebouncer(300);
  assert.equal(d.tryAccept("right:tracked-pointer", 1000), true);
  assert.equal(d.tryAccept("right:tracked-pointer", 1100), false);
  assert.equal(d.tryAccept("left:tracked-pointer", 1100), true);
  assert.equal(d.tryAccept("right:tracked-pointer", 1400), true);
});

/* ---- Runtime with mocked XR input sources ---- */
let renderer;
class Renderer {
  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- Observe the fake GPU instance in lifecycle assertions.
    renderer = this;
    this.domElement = { remove() {} };
    this.xr = { enabled: false, setReferenceSpaceType() {}, getReferenceSpace: () => this.space,
      setSession: async (session) => { this.space = session.space; } };
  }
  setPixelRatio() {} setSize() {} setClearColor() {}
  setAnimationLoop(fn) { this.loop = fn; }
  dispose() { this.disposed = true; }
  render() {}
}
const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function (name, ...args) {
  return name === "three" ? { ...THREE, WebGLRenderer: Renderer } : originalLoad.call(this, name, ...args);
};
global.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({
  clearRect() {}, fillRect() {}, strokeRect() {}, drawImage() {},
  fillText() {}, measureText: (t) => ({ width: t.length * 10 }), beginPath() {}, arc() {}, stroke() {}, fill() {},
}) }) };
global.XRRigidTransform = class { constructor(p, o) { this.position = p; this.orientation = o; } };
const { SpatialSession, PANEL_BUTTONS, PANEL_W, PANEL_H } = require("../src/lib/ar/runtime.ts");
class Session extends EventTarget {
  constructor(sources = []) {
    super();
    this.space = new EventTarget();
    this.visibilityState = "visible";
    this.inputSources = sources;
  }
  async end() { this.dispatchEvent(new Event("end")); }
}
const matrix = (x) => new THREE.Matrix4().makeTranslation(x, 1.6, 0).toArray();

function aimPose(runtime, buttonId, from = new THREE.Vector3(0, 1.6, 0)) {
  const b = PANEL_BUTTONS.find((x) => x.id === buttonId);
  const localX = ((b.x + b.w / 2) / PANEL_W - 0.5) * 0.72;
  const localY = (0.5 - (b.y + b.h / 2) / PANEL_H) * 0.54; // PANEL_WORLD_H
  runtime.scene.updateMatrixWorld(true);
  const target = new THREE.Vector3(localX, localY, 0).applyMatrix4(runtime.panel.matrixWorld);
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, -1), target.clone().sub(from).normalize());
  return { transform: { matrix: new THREE.Matrix4().compose(from, q, new THREE.Vector3(1, 1, 1)).toArray() } };
}

async function setup(sources) {
  const actions = [];
  const session = new Session(sources);
  const runtime = new SpatialSession(session, { appendChild() {} }, () => {}, (a) => actions.push(a), () => {});
  await runtime.initialize();
  runtime.update({ placement: placement(), text: "Step 1 — Place", detail: "Not verified" });
  return { runtime, session, actions };
}
const headFrame = (runtime, pose) => ({
  getViewerPose: () => ({ transform: { matrix: matrix(0) } }),
  getPose: () => pose,
  getHitTestResults: () => [],
});

test("hand ray: cursor + hover track the exact button; select activates once; field stays fixed", async () => {
  const right = { handedness: "right", targetRayMode: "tracked-pointer", targetRaySpace: {} };
  const { runtime, actions } = await setup([right]);
  runtime.frame(0, headFrame(runtime, null)); // place panel
  runtime.confirming = true; // confirm the field: guided buttons replace the placement toolbar
  runtime.frame(0, headFrame(runtime, null));
  const pose = aimPose(runtime, "verify");
  const frame = headFrame(runtime, pose);
  runtime.frame(1, frame);
  assert.equal(runtime.interaction.hoveredButton, "verify");
  assert.equal(runtime.interaction.hasTrackedRay, true);
  assert.equal(runtime.interaction.rayIntersectsPanel, true);
  const visual = runtime.inputVisuals.get(right);
  assert.equal(visual.line.visible, true);
  assert.equal(visual.cursor.visible, true);
  // Cursor sits on the panel surface (within a few mm of the panel plane).
  runtime.scene.updateMatrixWorld(true);
  const panelPos = new THREE.Vector3().setFromMatrixPosition(runtime.panel.matrixWorld);
  assert.ok(Math.abs(visual.cursor.position.z - panelPos.z) < 0.05);

  // Confirm the field, then interact: origin must not move.
  runtime.confirming = true;
  runtime.frame(2, headFrame(runtime, pose));
  const originBefore = runtime.origin.matrix.elements.slice();
  runtime.onSelect({ inputSource: right, frame });
  runtime.onSelect({ inputSource: right, frame }); // duplicate gesture
  assert.deepEqual(actions, ["verify"]);
  assert.equal(runtime.interaction.lastAction, "verify");
  runtime.frame(3, headFrame(runtime, aimPose(runtime, "previous")));
  assert.deepEqual(runtime.origin.matrix.elements, originBefore, "hand interaction must not move the anchored field");
  assert.equal(runtime.interaction.hoveredButton, "previous");

  // Pointing away: hover + cursor disappear, select activates nothing.
  const away = { transform: { matrix: new THREE.Matrix4().compose(
    new THREE.Vector3(0, 1.6, 0),
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)),
    new THREE.Vector3(1, 1, 1)).toArray() } };
  // Debouncer window is per real time; a fresh source key avoids it here.
  const left = { handedness: "left", targetRayMode: "tracked-pointer", targetRaySpace: {} };
  runtime.session.inputSources = [left];
  runtime.frame(4, headFrame(runtime, away));
  assert.equal(runtime.interaction.hoveredButton, null);
  assert.equal(runtime.inputVisuals.get(left).cursor.visible, false);
  runtime.onSelect({ inputSource: left, frame: headFrame(runtime, away) });
  assert.deepEqual(actions, ["verify"]);
  assert.match(runtime.interaction.lastFailure, /did not intersect|outside any button/);

  // Tracking loss hides the ray instead of showing a stale position.
  runtime.frame(5, headFrame(runtime, null));
  assert.equal(runtime.inputVisuals.get(left).line.visible, false);
  assert.equal(runtime.interaction.hasTrackedRay, false);

  await runtime.end();
  assert.equal(runtime.inputVisuals.size, 0, "ray/cursor resources released on session end");
  assert.equal(renderer.disposed, true);
});

test("recentered panel: hover follows the moved panel, Exit AR stays reachable", async () => {
  const right = { handedness: "right", targetRayMode: "tracked-pointer", targetRaySpace: {} };
  const { runtime, actions } = await setup([right]);
  runtime.frame(0, headFrame(runtime, null));
  runtime.recenterPanel();
  runtime.frame(1, headFrame(runtime, aimPose(runtime, "exit")));
  assert.equal(runtime.interaction.hoveredButton, "exit");
  runtime.onSelect({ inputSource: right, frame: headFrame(runtime, aimPose(runtime, "exit")) });
  assert.deepEqual(actions, ["exit"]);
  await runtime.end();
});
