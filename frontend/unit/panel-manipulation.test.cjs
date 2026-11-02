/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS harness transpiles TS modules. */
/* Draggable/resizable AR panel with mocked XR inputs — not HoloLens proof. */
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
const { panelRegionAt, clampPanelScale, ManipulationMachine } = require("../src/lib/ar/panel-manipulation.ts");

test("regions: title bar drags, lower-right resizes, buttons stay buttons", () => {
  assert.equal(panelRegionAt(500, 20, 1024, 640), "drag");
  assert.equal(panelRegionAt(1000, 620, 1024, 640), "resize");
  assert.equal(panelRegionAt(500, 500, 1024, 640), "panel");
  assert.equal(panelRegionAt(-5, 20, 1024, 640), null);
  assert.equal(clampPanelScale(99), 1.4);
  assert.equal(clampPanelScale(0.01), 0.65);
  assert.equal(clampPanelScale(0.85), 0.85);
});

test("machine: still pinch is a click, moved pinch suppresses it, cancel is safe", () => {
  const m = new ManipulationMachine(0.012);
  m.hover("drag", false);
  assert.equal(m.state, "hovering_drag_handle");
  assert.equal(m.grab("drag", [0, 0, 0]), true);
  m.move([0.005, 0, 0]);
  assert.equal(m.release(), false, "below-threshold pinch remains clickable");
  m.grab("resize", [0, 0, 0]);
  m.move([0.05, 0, 0]);
  assert.equal(m.release(), true, "moved pinch must not click");
  m.grab("drag", [0, 0, 0]);
  m.cancel();
  assert.equal(m.state, "idle");
  assert.equal(m.grab("panel", [0, 0, 0]), false);
});

/* ---- Runtime harness (mocked XR) ---- */
let renderer;
class Renderer {
  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- Observe the fake GPU instance.
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
const { SpatialSession, PANEL_W, PANEL_H } = require("../src/lib/ar/runtime.ts");
class Session extends EventTarget {
  constructor(sources = []) {
    super();
    this.space = new EventTarget();
    this.visibilityState = "visible";
    this.inputSources = sources;
  }
  async end() { this.dispatchEvent(new Event("end")); }
}
const placement = () => ({
  target_block_id: "yellow", instance: 1, origin: "tabletop_session", method: "manual_authoring",
  evidence: "measured", confirmed: true,
  dimensions: { x_mm: 16, y_mm: 9.6, z_mm: 32 },
  studs: { x: 2, z: 4, pitch_mm: 8, diameter_mm: 4.8, height_mm: 1.8 },
  position_m: [0.016, 0.0096, 0], rotation_deg: [0, 90, 0],
});
const headMatrix = () => new THREE.Matrix4().makeTranslation(0, 1.6, 0).toArray();

function poseAimingAt(worldPoint, from = new THREE.Vector3(0, 1.6, 0)) {
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, -1), worldPoint.clone().sub(from).normalize());
  return { transform: { matrix: new THREE.Matrix4().compose(from, q, new THREE.Vector3(1, 1, 1)).toArray() } };
}
function panelPoint(runtime, px, py) {
  const localX = (px / PANEL_W - 0.5) * 0.72;
  const localY = (0.5 - py / PANEL_H) * 0.45;
  runtime.scene.updateMatrixWorld(true);
  return new THREE.Vector3(localX, localY, 0).applyMatrix4(runtime.panel.matrixWorld);
}
const frameWith = (pose) => ({
  getViewerPose: () => ({ transform: { matrix: headMatrix() } }),
  getPose: () => pose,
  getHitTestResults: () => [],
});

async function setup() {
  const actions = [];
  const right = { handedness: "right", targetRayMode: "tracked-pointer", targetRaySpace: {} };
  const session = new Session([right]);
  const runtime = new SpatialSession(session, { appendChild() {} }, () => {}, (a) => actions.push(a), () => {});
  await runtime.initialize();
  runtime.update({ placement: placement(), text: "Step 1 — Place", detail: "Not verified" });
  runtime.frame(0, frameWith(null));
  return { runtime, session, actions, right };
}

test("drag: grab title, move without jump, release preserves, field untouched, no button fires", async () => {
  const { runtime, actions, right } = await setup();
  // Confirm the assembly field first.
  runtime.confirming = true;
  runtime.frame(1, frameWith(null));
  const originBefore = runtime.origin.matrix.elements.slice();
  const panelBefore = runtime.panelPos.clone();

  const grabPose = poseAimingAt(panelPoint(runtime, 500, 28));
  runtime.frame(2, frameWith(grabPose));
  assert.equal(runtime.manipulation.state, "hovering_drag_handle");
  runtime.onSelectStart({ inputSource: right, frame: frameWith(grabPose) });
  assert.equal(runtime.manipulation.state, "dragging");
  assert.deepEqual(runtime.panelPos.toArray(), panelBefore.toArray(), "no jump when the grab begins");

  const movedPanelPoint = panelPoint(runtime, 500, 28).add(new THREE.Vector3(-0.2, 0.05, 0));
  runtime.frame(3, frameWith(poseAimingAt(movedPanelPoint)));
  assert.ok(runtime.panelPos.x < panelBefore.x - 0.1, "panel follows the hand");
  runtime.onSelect({ inputSource: right, frame: frameWith(grabPose) });
  assert.deepEqual(actions, [], "a drag must never activate a button");
  runtime.onSelectEnd({ inputSource: right });
  const dropped = runtime.panelPos.clone();
  runtime.frame(4, frameWith(null));
  assert.deepEqual(runtime.panelPos.toArray(), dropped.toArray(), "release preserves the new position");
  assert.deepEqual(runtime.origin.matrix.elements, originBefore, "anchored field never moves");

  // Step change + result arrival keep the dropped position.
  runtime.update({ placement: placement(), text: "Step 2 — Next", detail: "Verified" });
  assert.deepEqual(runtime.panelPos.toArray(), dropped.toArray());
  await runtime.end();
});

test("resize: aspect preserved, clamped, hit-testing still exact afterwards", async () => {
  const { runtime, actions, right } = await setup();
  assert.equal(runtime.currentPanelScale, 0.85);
  const grabPose = poseAimingAt(panelPoint(runtime, 995, 615));
  runtime.frame(1, frameWith(grabPose));
  assert.equal(runtime.manipulation.state, "hovering_resize_handle");
  runtime.onSelectStart({ inputSource: right, frame: frameWith(grabPose) });
  assert.equal(runtime.manipulation.state, "resizing");
  const center = runtime.panelPos.clone();
  const outward = panelPoint(runtime, 995, 615).sub(center).multiplyScalar(1.5).add(center);
  runtime.frame(2, frameWith(poseAimingAt(outward)));
  assert.ok(runtime.currentPanelScale > 0.9, "moving outward enlarges the panel");
  runtime.scene.updateMatrixWorld(true);
  const sx = new THREE.Vector3().setFromMatrixColumn(runtime.panel.matrixWorld, 0).length();
  const sy = new THREE.Vector3().setFromMatrixColumn(runtime.panel.matrixWorld, 1).length();
  assert.ok(Math.abs(sx - sy) < 1e-6, "aspect ratio preserved (uniform XY scale)");
  runtime.onSelect({ inputSource: right, frame: frameWith(grabPose) });
  assert.deepEqual(actions, [], "a resize must never activate a button");
  runtime.onSelectEnd({ inputSource: right });

  runtime.setPanelScale(99);
  assert.equal(runtime.currentPanelScale, 1.4);
  runtime.setPanelScale(0.01);
  assert.equal(runtime.currentPanelScale, 0.65);
  runtime.resetPanelSize();
  assert.equal(runtime.currentPanelScale, 0.85);

  // Buttons still hit-test exactly at the resized scale (fresh hand = new debounce key).
  const left = { handedness: "left", targetRayMode: "tracked-pointer", targetRaySpace: {} };
  runtime.session.inputSources = [left];
  const { PANEL_BUTTONS } = require("../src/lib/ar/runtime.ts");
  const check = PANEL_BUTTONS.find((b) => b.id === "verify");
  const pose = poseAimingAt(panelPoint(runtime, check.x + check.w / 2, check.y + check.h / 2));
  runtime.frame(3, frameWith(pose));
  assert.equal(runtime.interaction.hoveredButton, "verify");
  runtime.onSelect({ inputSource: left, frame: frameWith(pose) });
  assert.deepEqual(actions, ["verify"]);

  // Recenter keeps the scale and only moves the panel.
  runtime.recenterPanel();
  runtime.frame(4, frameWith(null));
  assert.equal(runtime.currentPanelScale, 0.85);
  await runtime.end();
  assert.equal(renderer.disposed, true);
});

test("tracking loss mid-drag cancels without teleporting the panel", async () => {
  const { runtime, right } = await setup();
  const grabPose = poseAimingAt(panelPoint(runtime, 500, 28));
  runtime.onSelectStart({ inputSource: right, frame: frameWith(grabPose) });
  assert.equal(runtime.manipulation.state, "dragging");
  const atGrab = runtime.panelPos.clone();
  runtime.frame(1, frameWith(null)); // pose lost
  assert.equal(runtime.manipulation.state, "idle");
  assert.deepEqual(runtime.panelPos.toArray(), atGrab.toArray());
  await runtime.end();
});
