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
  fillText(t) { (globalThis.__canvasTexts ??= []).push(String(t)); },
  measureText: (t) => ({ width: t.length * 10 }), beginPath() {}, arc() {}, stroke() {}, fill() {},
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
  const localY = (0.5 - py / PANEL_H) * 0.54; // PANEL_WORLD_H
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
  const { runtime, actions, right } = await anchored();
  assert.equal(runtime.currentPanelScale, 0.85);
  const grabPose = poseAimingAt(panelPoint(runtime, 995, 740));
  runtime.frame(1, frameWith(grabPose));
  assert.equal(runtime.manipulation.state, "hovering_resize_handle");
  runtime.onSelectStart({ inputSource: right, frame: frameWith(grabPose) });
  assert.equal(runtime.manipulation.state, "resizing");
  const center = runtime.panelPos.clone();
  const outward = panelPoint(runtime, 995, 740).sub(center).multiplyScalar(1.5).add(center);
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

/* ---------- HoloLens-style window manipulation (move in depth, rotate, tilt, reset) ---------- */
const { PANEL_PUSH_GAIN, PANEL_ROTATE_GAIN, PANEL_MAX_TILT, PANEL_ROTATE_STEP, layoutButtons } = require("../src/lib/ar/runtime.ts");
const { ROTATE_FROM_RIGHT, ROTATE_W } = require("../src/lib/ar/panel-manipulation.ts");
const poseWithDir = (from, dir) => {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir.clone().normalize());
  return { transform: { matrix: new THREE.Matrix4().compose(from, q, new THREE.Vector3(1, 1, 1)).toArray() } };
};
const dirOf = (pose) => new THREE.Vector3(0, 0, -1).transformDirection(new THREE.Matrix4().fromArray(pose.transform.matrix));
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const ROT_X = PANEL_W - ROTATE_FROM_RIGHT + ROTATE_W / 2;
async function anchored() {
  const ctx = await setup();
  ctx.runtime.confirming = true;
  ctx.runtime.frame(1, frameWith(null));
  ctx.field = ctx.runtime.origin.matrix.elements.slice();
  return ctx;
}

test("move: pushing the hand along the ray moves the panel farther, pulling brings it closer; release keeps it", async () => {
  const { runtime, right, actions, field } = await anchored();
  const head = new THREE.Vector3(0, 1.6, 0);
  const grab = poseAimingAt(panelPoint(runtime, 500, 30));
  runtime.frame(2, frameWith(grab));
  runtime.onSelectStart({ inputSource: right, frame: frameWith(grab) });
  const before = runtime.panelPos.distanceTo(head);
  const dir = dirOf(grab);
  const pushed = poseWithDir(head.clone().addScaledVector(dir, 0.1), dir); // hand 10 cm forward
  runtime.frame(3, frameWith(pushed));
  assert.ok(near(runtime.panelPos.distanceTo(head), before + 0.1 + 0.1 * PANEL_PUSH_GAIN, 0.02), "farther");
  const pulled = poseWithDir(head.clone().addScaledVector(dir, -0.05), dir);
  runtime.frame(4, frameWith(pulled));
  assert.ok(runtime.panelPos.distanceTo(head) < before, "closer");
  runtime.onSelectEnd({ inputSource: right });
  const dropped = runtime.panelPos.toArray();
  runtime.frame(5, frameWith(null));
  assert.deepEqual(runtime.panelPos.toArray(), dropped, "stays where released (no snap back, no head follow)");
  assert.deepEqual(runtime.origin.matrix.elements, field, "tabletop field untouched");
  assert.deepEqual(actions, []);
  await runtime.end();
});

test("rotate handle: horizontal hand motion turns (yaw), vertical tilts (pitch, clamped); position fixed; no click fires", async () => {
  const { runtime, right, actions, field } = await anchored();
  const head = new THREE.Vector3(0, 1.6, 0);
  const grab = poseAimingAt(panelPoint(runtime, ROT_X, 30));
  runtime.frame(2, frameWith(grab));
  assert.equal(runtime.manipulation.state, "hovering_rotate_handle");
  runtime.onSelectStart({ inputSource: right, frame: frameWith(grab) });
  assert.equal(runtime.manipulation.state, "rotating");
  const pos = runtime.panelPos.toArray();
  const { yaw: yaw0, pitch: pitch0 } = runtime.panelPose;
  const turned = dirOf(grab).applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(10));
  runtime.frame(3, frameWith(poseWithDir(head, turned)));
  assert.ok(near(runtime.panelPose.yaw - yaw0, THREE.MathUtils.degToRad(10) * PANEL_ROTATE_GAIN, 1e-3), "yaw follows the hand");
  assert.ok(near(runtime.panelPose.pitch, pitch0, 1e-3), "turning does not tilt");
  assert.deepEqual(runtime.panelPos.toArray(), pos, "rotation keeps the panel in place");
  const up = new THREE.Vector3(turned.x, turned.y + 2, turned.z); // aim far up
  runtime.frame(4, frameWith(poseWithDir(head, up)));
  assert.ok(near(runtime.panelPose.pitch, PANEL_MAX_TILT, 1e-6), "tilt is clamped");
  runtime.onSelect({ inputSource: right, frame: frameWith(grab) });
  assert.deepEqual(actions, [], "a rotation gesture never activates a button");
  runtime.onSelectEnd({ inputSource: right });
  const after = runtime.panelPose;
  runtime.frame(5, frameWith(null));
  assert.deepEqual(runtime.panelPose, after, "orientation persists after release");
  assert.deepEqual(runtime.origin.matrix.elements, field);
  await runtime.end();
});

test("tracking loss mid-rotation keeps the last orientation and ends the gesture", async () => {
  const { runtime, right } = await anchored();
  const head = new THREE.Vector3(0, 1.6, 0);
  const grab = poseAimingAt(panelPoint(runtime, ROT_X, 30));
  runtime.frame(2, frameWith(grab));
  runtime.onSelectStart({ inputSource: right, frame: frameWith(grab) });
  runtime.frame(3, frameWith(poseWithDir(head, dirOf(grab).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.2))));
  const held = runtime.panelPose;
  runtime.frame(4, frameWith(null));
  assert.equal(runtime.manipulation.state, "idle");
  assert.deepEqual(runtime.panelPose, held);
  await runtime.end();
});

test("air-tap fallback: Rotate buttons turn the panel 15°; Reset Panel Position restores an upright panel in front of the user", async () => {
  const { runtime, field } = await anchored();
  const yaw0 = runtime.panelPose.yaw;
  runtime.rotatePanelBy(PANEL_ROTATE_STEP, 0);
  assert.ok(near(runtime.panelPose.yaw - yaw0, Math.PI / 12, 1e-9));
  runtime.rotatePanelBy(0, 5); // huge tilt request is clamped
  assert.ok(near(runtime.panelPose.pitch, PANEL_MAX_TILT, 1e-9));
  runtime.panelPos.set(2, 0.5, 1);
  runtime.recenterPanel();
  runtime.frame(9, frameWith(null));
  const pose = runtime.panelPose;
  assert.ok(near(pose.pitch, 0, 1e-9) && near(pose.yaw, 0, 1e-9), "upright and facing the user");
  assert.ok(near(pose.position[0], 0, 1e-9) && near(pose.position[1], 1.55, 1e-9) && near(pose.position[2], -0.85, 1e-9));
  assert.deepEqual(runtime.origin.matrix.elements, field, "reset never touches the field");
  await runtime.end();
});

test("panel transform is independent: step changes, Result/Guide/Camera switching, Autonomous status and Re-anchor never move it", async () => {
  const { runtime, field } = await anchored();
  runtime.rotatePanelBy(0.4, 0.2);
  runtime.panelPos.set(0.3, 1.4, -0.7);
  runtime.rotatePanelBy(0, 0);
  const pose = runtime.panelPose;
  runtime.update({ placement: { ...placement(), position_m: [0.05, 0, 0] }, text: "Step 2", detail: "", autoActive: true, autoLabel: "MONITORING", resultHeadline: "✗ Incorrect", resultLines: ["a"] });
  for (const mode of ["result", "camera", "guide"]) runtime.setViewMode(mode);
  runtime.turnPage(1);
  assert.deepEqual(runtime.panelPose, pose);
  runtime.reset(); // re-anchor the tabletop field
  runtime.frame(3, frameWith(null));
  assert.deepEqual(runtime.panelPose, pose, "re-anchoring the field never moves the panel");
  assert.notDeepEqual(runtime.origin.matrix.elements, null);
  assert.ok(field.length === 16);
  await runtime.end();
});

test("long instructions and results are paginated — every word reachable, nothing silently cut", async () => {
  globalThis.__canvasTexts = [];
  const { runtime } = await anchored();
  const words = Array.from({ length: 260 }, (_, i) => `word${i}`);
  runtime.update({ placement: placement(), text: "Step 1", detail: "", instruction: words.join(" "), shortInstruction: "Place the brick.", guideLabel: "Ready" });
  assert.ok(runtime.textPage.count > 1, "long instruction spans several pages");
  const seen = new Set();
  const collect = () => globalThis.__canvasTexts.join(" ").split(/\s+/).forEach((w) => seen.add(w.replace(/^Instructions:/, "")));
  for (let i = 0; i < runtime.textPage.count; i++) {
    globalThis.__canvasTexts = [];
    if (i) runtime.turnPage(1); else runtime.setViewMode("guide");
    collect();
  }
  assert.ok(words.every((w) => seen.has(w)), "all words appear across the pages");
  runtime.turnPage(1);
  assert.equal(runtime.textPage.page, runtime.textPage.count - 1, "More Text stops at the last page");
  runtime.turnPage(-1);
  assert.equal(runtime.textPage.page, runtime.textPage.count - 2, "Previous Text goes back");
  // Result view: long headline wraps (not cut) and lines paginate independently of the guide page.
  globalThis.__canvasTexts = [];
  const headline = "✗ Incorrect — the yellow brick is rotated and its printed side faces away from the camera view";
  runtime.update({ placement: placement(), text: "Step 1", detail: "", instruction: words.join(" "), resultHeadline: headline, resultTone: "incorrect",
    resultLines: Array.from({ length: 30 }, (_, i) => `Result line ${i} with expected versus observed detail.`) });
  runtime.setViewMode("result");
  assert.ok(globalThis.__canvasTexts.join(" ").includes("faces away from the camera view"), "headline fully shown");
  assert.equal(runtime.textPage.page, 0);
  assert.ok(runtime.textPage.count > 1);
  await runtime.end();
});

test("layout: Move/Rotate handles are separate from buttons; every control fits and stays clear of the resize corner", () => {
  const { panelRegionAt } = require("../src/lib/ar/panel-manipulation.ts");
  assert.equal(panelRegionAt(100, 30, PANEL_W, PANEL_H), "drag");
  assert.equal(panelRegionAt(ROT_X, 30, PANEL_W, PANEL_H), "rotate");
  assert.equal(panelRegionAt(1000, 760, PANEL_W, PANEL_H), "resize");
  for (const auto of [false, true]) {
    const buttons = layoutButtons([{ id: "verify", label: "Check Step" }, { id: "confirm", label: "Confirm Position" }], { autoActive: auto });
    for (const b of buttons) {
      assert.ok(b.y >= 64 && b.y + b.h <= PANEL_H && b.x + b.w <= PANEL_W, b.id);
      assert.equal(panelRegionAt(b.x + b.w / 2, b.y + b.h / 2, PANEL_W, PANEL_H), "panel", `${b.id} is a plain button region`);
    }
  }
});

/* ---------- Initial assembly-field rotation (mocked XR; not proof of HoloLens tracking) ---------- */
const yawOf = (m) => {
  const e = new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().fromArray(m), "YXZ");
  return (e.y * 180) / Math.PI;
};
const hitWith = (pose, hitMatrix) => ({
  ...frameWith(pose),
  getHitTestResults: () => [{ getPose: () => ({ transform: { matrix: hitMatrix } }) }],
});
const flatHit = () => new THREE.Matrix4().makeTranslation(0, 0.8, -0.6).toArray();
/** A hit pose whose frame is rotated 70° about Y (as surface hit-tests often are). */
const turnedHit = () => new THREE.Matrix4().makeRotationY(1.22).setPosition(0, 0.8, -0.6).toArray();
const press = (runtime, right, id) => {
  const b = runtime.buttons.find((x) => x.id === id);
  assert.ok(b, `button ${id} visible`);
  const pose = poseAimingAt(panelPoint(runtime, b.x + b.w / 2, b.y + b.h / 2));
  const f = frameWith(pose);
  runtime.frame(10, f);
  runtime.debouncer = { tryAccept: () => true };
  runtime.onSelect({ inputSource: right, frame: f });
};
async function placing() {
  const ctx = await setup();
  ctx.runtime.hit = { cancel() {} };
  ctx.runtime.frame(1, hitWith(null, flatHit()));
  return ctx;
}

test("field rotation: placement toolbar rotates the whole field before confirm; confirm keeps it and hides the toolbar", async () => {
  const { runtime, right, actions } = await placing();
  assert.equal(runtime.fieldPlacing, true);
  const ids = runtime.buttons.map((b) => b.id);
  for (const id of ["confirm-field", "field-rotate-reset", "field-left-5", "field-left-1", "field-right-1", "field-right-5"]) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes("verify"), "no Check Step before the field exists");
  const start = runtime.fieldYawDeg;
  press(runtime, right, "field-left-5");
  press(runtime, right, "field-left-1");
  assert.ok(Math.abs(runtime.fieldYawDeg - (start + 6)) < 0.05, "fine steps: 5° + 1°");
  runtime.frame(11, hitWith(null, flatHit()));
  assert.ok(Math.abs(yawOf(runtime.origin.matrix.elements) - runtime.fieldYawDeg) < 0.05, "live preview uses the yaw");
  press(runtime, right, "field-right-5");
  press(runtime, right, "field-rotate-reset");
  assert.equal(runtime.fieldYawDeg, start, "Reset Rotation returns to the default (facing the user)");
  press(runtime, right, "field-left-5");
  press(runtime, right, "confirm-field");
  runtime.frame(12, hitWith(null, flatHit()));
  assert.equal(runtime.fieldPlacing, false);
  assert.equal(runtime.anchorState, "anchored");
  assert.ok(Math.abs(yawOf(runtime.origin.matrix.elements) - (start + 5)) < 0.05, "confirmed field keeps the chosen rotation");
  assert.ok(!runtime.buttons.some((b) => b.id.startsWith("field-") || b.id === "confirm-field"), "placement controls hidden");
  assert.ok(runtime.buttons.some((b) => b.id === "verify"), "guided flow takes over");
  // Locked after confirm.
  assert.equal(runtime.rotateField(0.5), false);
  assert.ok(Math.abs(runtime.fieldYawDeg - (start + 5)) < 0.05);
  assert.ok(!actions.includes("verify"), "rotation/confirm never starts a check");
});

test("field rotation: hit-test frame rotation is ignored; blocks keep their relative transforms", async () => {
  const { runtime } = await setup();
  runtime.hit = { cancel() {} };
  runtime.frame(1, hitWith(null, flatHit()));
  const yaw = runtime.fieldYawDeg;
  const field = runtime.origin.children.find((o) => o.name === "assembly-field");
  const local = field.matrix.elements.slice();
  runtime.frame(2, hitWith(null, turnedHit()));
  assert.equal(runtime.fieldYawDeg, yaw, "the surface frame never turns the field");
  assert.ok(Math.abs(yawOf(runtime.origin.matrix.elements) - yaw) < 0.05);
  runtime.rotateField(Math.PI / 4);
  runtime.frame(3, hitWith(null, flatHit()));
  assert.deepEqual(field.matrix.elements, local, "children are untouched — only the parent field transform turns");
  // Step switch keeps the field orientation.
  runtime.update({ placement: { ...placement(), target_block_id: "b2", position_m: [0.04, 0.0096, 0.02] }, text: "Step 2", detail: "" });
  runtime.frame(4, hitWith(null, flatHit()));
  assert.ok(Math.abs(runtime.fieldYawDeg - (yaw + 45)) < 0.05, "step change keeps the yaw");
});

test("field rotation: direct hand dial turns the field, never the panel; panel manipulation never turns the field", async () => {
  const { runtime, right, actions } = await placing();
  const yaw0 = runtime.fieldYawDeg;
  const panelQ = runtime.panel.quaternion.toArray();
  const panelP = runtime.panelPos.toArray();
  const { FIELD_DIAL } = require("../src/lib/ar/runtime.ts");
  const start = poseAimingAt(panelPoint(runtime, FIELD_DIAL.x + FIELD_DIAL.w / 2, FIELD_DIAL.y + FIELD_DIAL.h / 2));
  runtime.frame(2, hitWith(start, flatHit()));
  runtime.onSelectStart({ inputSource: right, frame: hitWith(start, flatHit()) });
  const sweep = poseAimingAt(panelPoint(runtime, FIELD_DIAL.x + FIELD_DIAL.w / 2 + 200, FIELD_DIAL.y + FIELD_DIAL.h / 2));
  runtime.frame(3, hitWith(sweep, flatHit()));
  runtime.onSelectEnd({ inputSource: right, frame: hitWith(sweep, flatHit()) });
  runtime.onSelect({ inputSource: right, frame: hitWith(sweep, flatHit()) });
  assert.ok(Math.abs(runtime.fieldYawDeg - yaw0) > 1, "hand sweep rotated the field");
  assert.deepEqual(runtime.panel.quaternion.toArray(), panelQ, "panel orientation untouched by the field dial");
  assert.deepEqual(runtime.panelPos.toArray(), panelP, "panel position untouched by the field dial");
  assert.equal(runtime.fieldPlacing, true, "dial release never confirms the field");
  assert.ok(!actions.includes("verify"));
  // Panel rotate handle: field yaw unchanged.
  const yaw1 = runtime.fieldYawDeg;
  runtime.rotatePanelBy(0.4, 0);
  press(runtime, right, "rotate-left");
  assert.equal(runtime.fieldYawDeg, yaw1, "panel rotation never turns the field");
});

test("field rotation: Re-anchor allows a different orientation; tracking loss keeps the rotation", async () => {
  const { runtime, right } = await placing();
  runtime.rotateField(Math.PI / 6);
  runtime.confirmOrigin();
  runtime.frame(2, hitWith(null, flatHit()));
  const first = runtime.fieldYawDeg;
  assert.equal(runtime.fieldPlacing, false);
  // Tracking loss / recovery on the anchored field: rotation unchanged.
  runtime.frame(3, { getViewerPose: () => null, getPose: () => null, getHitTestResults: () => [] });
  runtime.frame(4, hitWith(null, flatHit()));
  assert.equal(runtime.fieldYawDeg, first);
  assert.ok(Math.abs(yawOf(runtime.origin.matrix.elements) - first) < 0.05);
  // Re-anchor: placement controls are back, the previous rotation is the starting point.
  press(runtime, right, "reanchor");
  assert.equal(runtime.fieldPlacing, true);
  assert.equal(runtime.fieldYawDeg, first, "re-anchor keeps the orientation as the starting point");
  assert.ok(runtime.buttons.some((b) => b.id === "confirm-field"));
  runtime.frame(5, hitWith(null, flatHit()));
  runtime.rotateField(-Math.PI / 3);
  runtime.confirmOrigin();
  runtime.frame(6, hitWith(null, flatHit()));
  assert.equal(runtime.fieldPlacing, false);
  assert.ok(Math.abs(runtime.fieldYawDeg - (first - 60)) < 0.05, "new orientation confirmed");
});

test("autonomous context while the panel is manipulated: field stays anchored, in-view state and field transform unchanged", async () => {
  const { runtime, right, actions } = await anchored();
  const field = runtime.origin.matrix.elements.slice();
  const ctx = () => ({ anchorState: runtime.anchorState, fieldInView: runtime.fieldInView });
  const before = ctx();
  assert.equal(before.anchorState, "anchored");
  const grab = poseAimingAt(panelPoint(runtime, 500, 30));
  runtime.frame(2, frameWith(grab));
  runtime.onSelectStart({ inputSource: right, frame: frameWith(grab) });
  for (let i = 0; i < 10; i++) {
    const p = poseAimingAt(panelPoint(runtime, 500 + i * 10, 30).add(new THREE.Vector3(0.01 * i, 0, 0)));
    runtime.frame(3 + i, frameWith(p));
    assert.deepEqual(ctx(), before, "autonomous inputs unchanged during the drag");
  }
  runtime.onSelectEnd({ inputSource: right, frame: frameWith(grab) });
  runtime.rotatePanelBy(0.3, 0.1);
  runtime.frame(20, frameWith(null));
  assert.deepEqual(ctx(), before);
  assert.deepEqual(runtime.origin.matrix.elements, field, "field transform untouched");
  assert.ok(!actions.includes("verify"), "manipulation never triggers a check");
});
