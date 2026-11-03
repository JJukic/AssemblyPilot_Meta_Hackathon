/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS harness transpiles the tested TypeScript modules. */
/* Mocked XR/GPU tests establish logic, never real stereoscopy or physical alignment. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    filename,
  );
const THREE = require("three");
const { ghost, mm } = require("../src/lib/ar/geometry.ts");
const { capabilities, validPlacement } = require("../src/lib/ar/data.ts");
const placement = () => ({
  target_block_id: "yellow",
  instance: 1,
  origin: "tabletop_session",
  method: "manual_authoring",
  evidence: "measured",
  confirmed: true,
  dimensions: { x_mm: 16, y_mm: 9.6, z_mm: 32 },
  studs: { x: 2, z: 4, pitch_mm: 8, diameter_mm: 4.8, height_mm: 1.8 },
  position_m: [0.016, 0.0096, 0],
  rotation_deg: [0, 90, 0],
});
test("metric box, stud count, bottom-centre, placement and rotation", () => {
  const g = ghost(placement());
  assert.equal(mm(1000), 1);
  assert.equal(g.children[0].geometry.parameters.width, 0.016);
  assert.equal(g.children[0].position.y, 0.0048);
  assert.equal(g.position.x, 0.016);
  assert.equal(g.rotation.y, Math.PI / 2);
  assert.equal(
    g.children.filter((o) => o.geometry?.type === "CylinderGeometry").length,
    8,
  );
});
test("reject unknown dimensions, invalid coordinates and false confirmations", () => {
  for (const update of [
    { dimensions: null },
    { position_m: [Infinity, 0, 0] },
    { confirmed: false },
    { rotation_deg: [0, 190, 0] },
    { evidence: "approximate" },
  ])
    assert.equal(validPlacement({ ...placement(), ...update }), false);
  assert.throws(() => ghost({ ...placement(), dimensions: null }));
});
test("secure context and unsupported XR checks never imply session success", async () => {
  global.window = { isSecureContext: false };
  Object.defineProperty(global, "navigator", { configurable: true, value: {} });
  assert.equal((await capabilities()).available, false);
  window.isSecureContext = true;
  assert.equal((await capabilities()).available, false);
  navigator.xr = {
    isSessionSupported: async (mode) => mode === "immersive-ar",
  };
  assert.equal((await capabilities()).available, true);
  navigator.xr.isSessionSupported = async () => {
    throw Error("denied");
  };
  assert.equal((await capabilities()).available, false);
});
let renderer;
class Renderer {
  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- Observe the fake GPU instance in lifecycle assertions.
    renderer = this;
    this.domElement = { remove() {} };
    this.xr = {
      enabled: false,
      setReferenceSpaceType: (type) => {
        assert.equal(type, "local");
      },
      getReferenceSpace: () => this.space,
      setSession: async (session) => {
        this.space = session.space;
      },
    };
  }
  setPixelRatio() {}
  setSize() {}
  setClearColor() {}
  setAnimationLoop(fn) {
    this.loop = fn;
  }
  dispose() {
    this.disposed = true;
  }
  render() {
    this.renders = (this.renders ?? 0) + 1;
  }
}
const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function (name, ...args) {
  return name === "three"
    ? { ...THREE, WebGLRenderer: Renderer }
    : originalLoad.call(this, name, ...args);
};
global.document = {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => ({
      clearRect() {},
      fillRect() {},
      strokeRect() {},
      drawImage(image, x, y, w, h) {
        (globalThis.__drawCalls ??= []).push({ image, x, y, w, h });
      },
      fillText(text) {
        (globalThis.__canvasTexts ??= []).push(String(text));
      },
      measureText: (t) => ({ width: t.length * 10 }),
    }),
  }),
};
global.XRRigidTransform = class {
  constructor(position, orientation) {
    this.position = position;
    this.orientation = orientation;
  }
};
const { SpatialSession } = require("../src/lib/ar/runtime.ts");
test("completion is Finish-only, last-verified-only and session-owned; field never moves", async () => {
  const { runtime, ended } = await setup();
  confirmField(runtime);
  let loads = 0;
  runtime.mascot.load = async () => {
    loads++;
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(1,2,1), new THREE.MeshBasicMaterial()));
    return { scene, animations: [] };
  };
  const info = { placement: placement(), text: "Final", detail: "", progress: { position: 1, total: 2, currentVerified: true } };
  runtime.update(info); runtime.showCompletion(); assert.equal(loads,0);
  runtime.update({ ...info, progress: {position:2,total:2,currentVerified:false} }); runtime.showCompletion(); assert.equal(loads,0);
  runtime.update({ ...info, progress: {position:2,total:2,currentVerified:true}, completion:true });
  assert.equal(loads,0, "polling completion never loads a GLB");
  const pose=runtime.origin.matrix.clone(); const field=runtime.fieldGroup; const target=runtime.target;
  runtime.showCompletion(); await Promise.resolve(); assert.equal(loads,1);
  assert.ok(runtime.origin.children.includes(runtime.mascot.transform));
  runtime.clearCompletion(); assert.equal(runtime.mascot.mixer,null);
  assert.equal(runtime.fieldGroup,field); assert.equal(runtime.target,target); assert.deepEqual(runtime.origin.matrix.elements,pose.elements);
  runtime.showCompletion(); await Promise.resolve();
  await runtime.end(); assert.equal(ended(),1); assert.equal(runtime.mascot.mixer,null); assert.equal(runtime.mascot.transform.parent,null);
});
test("failed completion load leaves XR alive and reports unavailable; late load after XR end is discarded", async () => {
  const { runtime, ended } = await setup(); confirmField(runtime);
  runtime.update({placement:null,text:"Final",detail:"",completion:true,guideLabel:"Assembly complete", progress:{position:2,total:2,currentVerified:true}});
  runtime.mascot.load=async()=>{throw Error('invalid GLB');};
  runtime.showCompletion(); await Promise.resolve();
  assert.equal(ended(),0); assert.equal(runtime.completionNotice,"Completion hologram unavailable");
  assert.equal(runtime.info.guideLabel,"Assembly complete");
  runtime.clearCompletion(); let resolve;
  runtime.mascot.load=()=>new Promise(r=>{resolve=r;}); runtime.showCompletion(); await runtime.end();
  const scene=new THREE.Group(); scene.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial()));
  resolve({scene,animations:[]}); await Promise.resolve(); assert.equal(runtime.mascot.transform.parent,null);
});
test("completion mascot stands BEHIND the confirmed field; Re-anchor keeps it hidden, then behind the NEW field; Restart and XR end remove it", async () => {
  const { runtime } = await setup(); confirmField(runtime);
  const clip = (name) => new THREE.AnimationClip(name, 0.5, []);
  runtime.mascot.load = async () => {
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshBasicMaterial()));
    return { scene, animations: [clip("Walking"), clip("Wave"), clip("Dance"), clip("Idle")] };
  };
  const done = { placement: placement(), text: "Final", detail: "", completion: true, progress: { position: 2, total: 2, currentVerified: true } };
  runtime.update(done);
  runtime.showCompletion(); for (let i = 0; i < 5; i++) await Promise.resolve();
  let t = 10;
  const run = (seconds, x = 0) => { for (let i = 0; i < seconds * 20; i++) runtime.frame((t += 50), frame(x)); };
  const fieldLocal = () => {
    runtime.origin.updateMatrixWorld(true);
    return runtime.origin.worldToLocal(runtime.mascot.transform.getWorldPosition(new THREE.Vector3()));
  };
  run(3);
  assert.equal(runtime.mascot.transform.parent, runtime.origin, "child of the confirmed field origin (not camera, not panel)");
  assert.ok(runtime.mascot.transform.visible);
  const local = fieldLocal();
  assert.ok(Math.abs(local.z + 0.45) < 1e-6 && Math.abs(local.x) < 1e-6 && Math.abs(local.y) < 1e-6, `behind the field: ${local.toArray()}`);
  assert.ok(!runtime.panel.children.includes(runtime.mascot.transform));
  const fieldBefore = runtime.origin.matrix.clone();
  const worldBefore = runtime.mascot.transform.getWorldPosition(new THREE.Vector3());
  // Re-anchor: the mascot stays loaded but is hidden while the field is unconfirmed …
  runtime.reset();
  run(0.5, 0.5);
  assert.ok(runtime.mascot.model, "kept through Re-anchor");
  assert.equal(runtime.mascot.transform.visible, false, "hidden until the field is confirmed again");
  // … and appears behind the NEWLY confirmed field (moved with the field transform).
  runtime.confirming = true; run(0.5, 0.5);
  assert.ok(runtime.mascot.transform.visible);
  assert.notDeepEqual(runtime.origin.matrix.elements, fieldBefore.elements, "a different field pose");
  const after = fieldLocal();
  assert.ok(Math.abs(after.z + 0.45) < 1e-6 && Math.abs(after.x) < 1e-6, `behind the new field: ${after.toArray()}`);
  assert.ok(runtime.mascot.transform.getWorldPosition(new THREE.Vector3()).distanceTo(worldBefore) > 0.1, "moved with the field");
  // A different field size recomputes the distance (never on the field).
  runtime.setFieldSize(0.8, 1.0);
  assert.ok(Math.abs(fieldLocal().z + 0.64) < 1e-6, "deep field → further back");
  // Restart Assembly (completion off) removes model and animations; nothing else changes.
  const pose = runtime.origin.matrix.clone();
  runtime.update({ ...done, completion: false });
  assert.equal(runtime.mascot.mixer, null);
  assert.equal(runtime.mascot.transform.parent, null);
  assert.deepEqual(runtime.origin.matrix.elements, pose.elements);
  await runtime.end();
});
class Session extends EventTarget {
  constructor() {
    super();
    this.space = new EventTarget();
    this.visibilityState = "visible";
  }
  async end() {
    this.dispatchEvent(new Event("end"));
  }
}
const matrix = (x) => new THREE.Matrix4().makeTranslation(x, 1.6, 0).toArray();
const frame = (x = 0) => ({
  getViewerPose: () => ({ transform: { matrix: matrix(x) } }),
});
/** Confirm the assembly field so the guided flow (not the placement toolbar) is shown. */
function confirmField(runtime) {
  runtime.frame(0, frame());
  runtime.confirming = true;
  runtime.frame(1, frame());
}
async function setup(session = new Session()) {
  const messages = [],
    actions = [];
  let ended = 0;
  const runtime = new SpatialSession(
    session,
    { appendChild() {} },
    (m) => messages.push(m),
    (a) => actions.push(a),
    () => ended++,
  );
  await runtime.initialize();
  runtime.update({
    placement: placement(),
    text: "Step 2 — Place yellow on blue",
    detail: "Not verified",
  });
  return { runtime, session, messages, actions, ended: () => ended };
}
test("mocked XR renderer lifecycle: origin stays fixed under head movement; a head-tracking dropout keeps the placement", async () => {
  const { runtime, session, ended } = await setup();
  assert.equal(renderer.xr.enabled, true);
  runtime.frame(0, frame());
  runtime.confirming = true;
  runtime.frame(1, frame());
  const origin = runtime.origin.matrix.clone();
  runtime.frame(2, frame(0.4));
  assert.deepEqual(runtime.origin.matrix.elements, origin.elements);
  // HoloLens regression: a missing viewer pose used to reset() the field.
  runtime.frame(3, { getViewerPose: () => null });
  assert.equal(runtime.selected, true, "placement survives a viewer-pose dropout");
  runtime.frame(4, frame(0.4));
  assert.equal(runtime.selected, true);
  assert.equal(runtime.origin.visible, true);
  assert.deepEqual(runtime.origin.matrix.elements, origin.elements, "no relocation after recovery");
  // Session-local (no native anchor) + reference reset: kept, marked LOST, never relocated.
  session.space.dispatchEvent(new Event("reset"));
  assert.equal(runtime.anchorState, "tracking_lost");
  runtime.frame(5, frame(0.2));
  assert.equal(runtime.origin.visible, true, "lost field stays visible (red), not silently deleted");
  assert.deepEqual(runtime.origin.matrix.elements, origin.elements);
  await runtime.end();
  assert.equal(ended(), 1);
  assert.equal(renderer.disposed, true);
});
test("optional hit test failure falls back and missing geometry renders nothing", async () => {
  const session = new Session();
  session.requestReferenceSpace = async () => ({});
  session.requestHitTestSource = async () => {
    throw Error("unsupported feature");
  };
  const { runtime, messages } = await setup(session);
  assert.ok(messages.some((m) => m.includes("No surface detection")));
  runtime.update({
    placement: null,
    text: "Unknown dimensions",
    detail: "No model",
  });
  runtime.frame(0, frame());
  assert.equal(runtime.target, null, "no exact block is drawn without dimensions");
  assert.equal(runtime.origin.visible, true, "the field preview itself never depends on step content");
  assert.equal(runtime.fieldDiagnostics.stepContentAvailable, false);
  await session.end();
});
test("anchor creation, lost anchor, rejected anchors, and late anchors after reset are bounded", async () => {
  const { runtime } = await setup();
  let resolve,
    deleted = 0;
  const f = frame();
  f.createAnchor = () =>
    new Promise((r) => {
      resolve = r;
    });
  runtime.frame(0, f);
  runtime.confirming = true;
  runtime.frame(1, f);
  runtime.reset();
  resolve({ delete: () => deleted++ });
  await Promise.resolve();
  assert.equal(deleted, 1);
  runtime.frame(2, frame());
  runtime.confirming = true;
  const anchored = { delete: () => deleted++, anchorSpace: {} };
  runtime.frame(3, { ...frame(), createAnchor: async () => anchored });
  await Promise.resolve();
  assert.equal(runtime.anchor, anchored);
  // Phase 7: a transient anchor-pose dropout holds the confirmed field in
  // place; only a sustained dropout loses it (explicitly, never relocated).
  runtime.frame(4, { ...frame(), getPose: () => null });
  assert.equal(runtime.selected, true);
  assert.equal(runtime.origin.visible, true);
  assert.equal(runtime.anchorState, "tracking_degraded");
  for (let i = 0; i < 50; i++) runtime.frame(4 + i, { ...frame(), getPose: () => null });
  assert.equal(runtime.anchorState, "tracking_lost");
  assert.equal(runtime.selected, true, "sustained loss is explicit but never deletes the anchor");
  assert.equal(deleted, 1);
  assert.equal(runtime.origin.visible, true);
  // The SAME anchor recovers by itself.
  runtime.frame(60, { ...frame(), getPose: () => ({ transform: { matrix: runtime.fixed.toArray() } }) });
  assert.equal(runtime.anchorState, "anchored");
  // Explicit re-anchor is the only path that discards it.
  runtime.reset();
  assert.equal(deleted, 2);
  runtime.frame(5, frame());
  runtime.confirming = true;
  runtime.frame(6, {
    ...frame(),
    createAnchor: () => {
      throw Error("unsupported");
    },
  });
  assert.equal(runtime.selected, true);
  await runtime.end();
});
test("horizontal hit-test surface selection and input-driven navigation do not verify anything", async () => {
  const { runtime, actions } = await setup();
  runtime.hit = { cancel() {} };
  const hit = {
    ...frame(),
    getHitTestResults: () => [
      {
        getPose: () => ({
          transform: {
            matrix: new THREE.Matrix4().makeTranslation(0, 0.8, -0.6).toArray(),
          },
        }),
      },
    ],
  };
  runtime.frame(0, hit);
  assert.equal(runtime.candidateValid, true);
  runtime.confirming = true;
  runtime.frame(1, hit);
  assert.equal(runtime.fixed.elements[13], 0.8);
  runtime.scene.updateMatrixWorld(true);
  const { PANEL_BUTTONS, PANEL_W, PANEL_H } = require("../src/lib/ar/runtime.ts");
  const verifyBtn = PANEL_BUTTONS.find((b) => b.id === "verify");
  // Convert the Verify button centre (canvas px, top-left origin) to panel-local metres.
  const localX = ((verifyBtn.x + verifyBtn.w / 2) / PANEL_W - 0.5) * 0.72;
  const localY = (0.5 - (verifyBtn.y + verifyBtn.h / 2) / PANEL_H) * 0.54; // PANEL_WORLD_H
  const q = new THREE.Quaternion();
  const aim = new THREE.Vector3(localX, localY, 0).applyMatrix4(
    runtime.panel.matrixWorld,
  );
  q.setFromUnitVectors(
    new THREE.Vector3(0, 0, -1),
    aim.sub(new THREE.Vector3(0, 1.6, 0)).normalize(),
  );
  runtime.onSelect({
    inputSource: { targetRaySpace: {} },
    frame: {
      getPose: () => ({
        transform: {
          matrix: new THREE.Matrix4()
            .compose(
              new THREE.Vector3(0, 1.6, 0),
              q,
              new THREE.Vector3(1, 1, 1),
            )
            .toArray(),
        },
      }),
    },
  });
  assert.deepEqual(actions, ["verify"]);
  await runtime.end();
});

test("HoloLens regression: visible-blurred (2D slate / permission prompt) keeps the anchored field; new session starts clean", async () => {
  const first = await setup();
  first.runtime.frame(0, frame());
  first.runtime.confirming = true;
  first.runtime.frame(1, frame());
  const pose = first.runtime.origin.matrix.clone();
  first.session.visibilityState = "visible-blurred";
  first.session.dispatchEvent(new Event("visibilitychange"));
  first.runtime.frame(2, frame(0.3));
  assert.equal(first.runtime.selected, true);
  assert.equal(first.runtime.origin.visible, true);
  assert.equal(first.runtime.fieldDiagnostics.fieldRendered, true);
  assert.equal(first.runtime.fieldDiagnostics.visibilityState, "visible-blurred");
  assert.deepEqual(first.runtime.origin.matrix.elements, pose.elements);
  first.session.visibilityState = "hidden";
  first.session.dispatchEvent(new Event("visibilitychange"));
  first.session.visibilityState = "visible";
  first.session.dispatchEvent(new Event("visibilitychange"));
  first.runtime.frame(3, frame());
  assert.equal(first.runtime.selected, true);
  assert.deepEqual(first.runtime.origin.matrix.elements, pose.elements);
  await first.runtime.end();
  const second = await setup();
  assert.equal(second.runtime.selected, false);
  assert.equal(second.runtime.anchor, null);
  await second.runtime.end();
});

test("phase6.1 reference bitmap replaces and closes previous; XR end cleans it up", async () => {
  const { runtime, ended } = await setup();
  let closedA = 0, closedB = 0;
  const a = { width: 800, height: 600, close: () => closedA++ };
  const b = { width: 400, height: 400, close: () => closedB++ };
  runtime.setReferenceImage(a);
  assert.equal(runtime.hasReferenceImage, true);
  runtime.setReferenceImage(b); // step switch: stale image disposed immediately
  assert.equal(closedA, 1);
  runtime.setReferenceImage(null);
  assert.equal(closedB, 1);
  assert.equal(runtime.hasReferenceImage, false);
  runtime.setReferenceImage(a);
  await runtime.end(); // session exit cleanup
  assert.equal(closedA, 2);
  assert.equal(ended(), 1);
  assert.equal(renderer.disposed, true);
});
test("phase6.1 large Exit button exists in panel layout and maps via panelButtonAt", async () => {
  const { PANEL_BUTTONS, panelButtonAt } = require("../src/lib/ar/runtime.ts");
  const exit = PANEL_BUTTONS.find((b) => b.id === "exit");
  assert.ok(exit && exit.w >= 200 && exit.h >= 80);
  assert.equal(panelButtonAt(exit.x + 5, exit.y + 5).id, "exit");
  assert.ok(PANEL_BUTTONS.find((b) => b.id === "verify"));
  assert.equal(panelButtonAt(10, 10), null);
});

test("phase6.2 XR panel renders the real result headline, issue and fix in result mode", async () => {
  const { runtime } = await setup();
  globalThis.__canvasTexts = [];
  runtime.update({
    placement: placement(),
    text: "Step 1 — Place the block",
    detail: "Not verified",
    resultHeadline: "✗ Incorrect — Correction Required",
    resultTone: "incorrect",
    resultLines: [
      "Step verified: No",
      "The assembly does not match the expected step.",
      "Issue 1 (wrong_color): The top block is red instead of blue.",
      "Expected: A blue block on top.",
      "Observed: A red block on top.",
      "Fix: Replace the red block with the blue block.",
      "Next: Fix the top block, then verify again.",
    ],
  });
  // Guide mode first: result must not leak into the instruction view.
  assert.ok(!globalThis.__canvasTexts.some((t) => t.includes("Replace the red block")));
  runtime.setViewMode("result");
  assert.equal(runtime.panelViewMode, "result");
  const drawn = globalThis.__canvasTexts.join("\n");
  assert.match(drawn, /Incorrect — Correction Required/);
  assert.match(drawn, /Replace the red block with the blue block/);
  assert.match(drawn, /A red block on top/);
  runtime.setViewMode("guide");
  assert.equal(runtime.panelViewMode, "guide");
  await runtime.end();
});

/* ---------- Spatial field lifecycle regression suite (HoloLens field-disappearance bug) ---------- */
const sceneHas = (runtime, name) => {
  let found = false;
  runtime.scene.traverse((o) => { if (o.name === name) found = true; });
  return found;
};
const hitFrame = (y = 0.8, x = 0) => ({
  ...frame(),
  getHitTestResults: () => [{ getPose: () => ({ transform: { matrix: new THREE.Matrix4().makeTranslation(x, y, -0.6).toArray() } }) }],
});
async function anchoredSetup() {
  const ctx = await setup();
  const anchor = { delete() { this.deleted = (this.deleted ?? 0) + 1; }, anchorSpace: {} };
  ctx.anchor = anchor;
  ctx.runtime.hit = { cancel() {} };
  ctx.runtime.frame(0, hitFrame());
  ctx.runtime.confirming = true;
  ctx.runtime.frame(1, { ...hitFrame(), createAnchor: async () => anchor });
  await Promise.resolve();
  await Promise.resolve();
  ctx.tracked = (head = 0) => ({ ...frame(head), getPose: () => ({ transform: { matrix: new THREE.Matrix4().makeTranslation(0, 0.8, -0.6).toArray() } }) });
  return ctx;
}

test("lifecycle 1-3: field created on entry, preview visible, confirmation anchors it", async () => {
  const { runtime } = await setup();
  assert.ok(sceneHas(runtime, "assembly-field"), "field mesh exists from session start");
  assert.equal(runtime.anchorState, "unplaced");
  runtime.hit = { cancel() {} };
  runtime.frame(0, hitFrame());
  assert.equal(runtime.anchorState, "awaiting_confirmation");
  assert.equal(runtime.origin.visible, true, "placement preview rendered");
  assert.equal(runtime.fieldDiagnostics.placementMode, "surface");
  runtime.confirmOrigin();
  runtime.frame(1, hitFrame());
  assert.equal(runtime.anchorState, "anchored");
  assert.equal(runtime.fieldDiagnostics.fieldRendered, true);
  assert.equal(runtime.fieldDiagnostics.transformValid, true);
  await runtime.end();
});

test("lifecycle 4: head movement never moves the anchored field", async () => {
  const { runtime, tracked } = await anchoredSetup();
  const pose = runtime.origin.matrix.clone();
  for (let i = 0; i < 20; i++) runtime.frame(2 + i, tracked(Math.sin(i) * 0.5));
  assert.deepEqual(runtime.origin.matrix.elements, pose.elements);
  await runtime.end();
});

test("lifecycle 5-7: autonomous start/pause/stop status updates and camera permission blur never touch the field", async () => {
  const { runtime, session, tracked, anchor } = await anchoredSetup();
  const pose = runtime.origin.matrix.clone();
  const fieldGroup = runtime.fieldGroup;
  for (const autoLabel of ["CAMERA STARTING — …", "MONITORING — Watching", "PAUSED — …", undefined]) {
    // Starting the camera on HoloLens can show a permission prompt => visible-blurred.
    session.visibilityState = autoLabel === "CAMERA STARTING — …" ? "visible-blurred" : "visible";
    session.dispatchEvent(new Event("visibilitychange"));
    runtime.update({ placement: placement(), text: "Step 1", detail: "", autoLabel, autoButton: "Pause" });
    runtime.frame(10, tracked(0.2));
    assert.equal(runtime.anchorState, "anchored");
    assert.equal(runtime.fieldDiagnostics.fieldRendered, true, `field rendered (${autoLabel})`);
    assert.equal(runtime.fieldGroup, fieldGroup, "field never rebuilt");
    assert.deepEqual(runtime.origin.matrix.elements, pose.elements);
  }
  assert.equal(anchor.deleted ?? 0, 0, "anchor never deleted by autonomous mode");
  await runtime.end();
});

test("lifecycle 8: step transition replaces only the step hologram, never the field or anchor", async () => {
  const { runtime, tracked, anchor } = await anchoredSetup();
  const pose = runtime.origin.matrix.clone();
  const fieldGroup = runtime.fieldGroup;
  const firstTarget = runtime.target;
  runtime.update({ placement: null, text: "loading", detail: "" }); // navigate() clears step content first
  runtime.frame(2, tracked());
  assert.equal(runtime.fieldDiagnostics.fieldRendered, true, "field stays while the next step loads");
  runtime.update({ placement: { ...placement(), position_m: [0.05, 0.0096, 0] }, text: "Step 2", detail: "" });
  runtime.frame(3, tracked());
  assert.notEqual(runtime.target, firstTarget);
  assert.equal(runtime.fieldGroup, fieldGroup);
  assert.deepEqual(runtime.origin.matrix.elements, pose.elements);
  assert.equal(anchor.deleted ?? 0, 0);
  // status-only updates do not churn the step hologram
  const target = runtime.target;
  runtime.update({ placement: { ...placement(), position_m: [0.05, 0.0096, 0] }, text: "Step 2", detail: "", autoLabel: "x" });
  assert.equal(runtime.target, target);
  await runtime.end();
});

test("lifecycle 9 + 11: Re-anchor after a placement shows a visible preview again and reconstructs the field", async () => {
  const { runtime, tracked, anchor } = await anchoredSetup();
  runtime.frame(2, tracked());
  runtime.reset();
  assert.equal(anchor.deleted, 1);
  assert.equal(runtime.anchorState, "reanchoring");
  runtime.frame(3, hitFrame(0.7, 0.1));
  assert.equal(runtime.origin.visible, true, "preview reappears");
  assert.equal(runtime.anchorState, "awaiting_confirmation");
  runtime.confirmOrigin();
  const second = { delete() {}, anchorSpace: {} };
  runtime.frame(4, { ...hitFrame(0.7, 0.1), createAnchor: async () => second });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(runtime.anchor, second);
  assert.equal(runtime.anchorState, "anchored");
  assert.equal(runtime.fieldDiagnostics.fieldRendered, true);
  assert.ok(Math.abs(runtime.origin.matrix.elements[13] - 0.7) < 1e-9, "new tabletop height adopted only after explicit confirm");
  await runtime.end();
});

test("lifecycle 9b: Re-anchor with surface detection but no surface hits still shows a gaze preview (no dead end)", async () => {
  const { runtime, tracked } = await anchoredSetup();
  runtime.frame(2, tracked());
  runtime.reset();
  const empty = { ...frame(), getHitTestResults: () => [] };
  for (let i = 0; i < 95; i++) runtime.frame(3 + i, empty);
  assert.equal(runtime.origin.visible, true);
  assert.equal(runtime.fieldDiagnostics.placementMode, "gaze");
  runtime.confirmOrigin();
  runtime.frame(200, empty);
  assert.equal(runtime.anchorState, "anchored");
  await runtime.end();
});

test("lifecycle 10: Re-anchor after tracking loss works and the old anchor is released", async () => {
  const { runtime, anchor } = await anchoredSetup();
  for (let i = 0; i < 60; i++) runtime.frame(2 + i, { ...frame(), getPose: () => null });
  assert.equal(runtime.anchorState, "tracking_lost");
  assert.match(runtime.fieldDiagnostics.lastEvent, /lost/);
  runtime.reset();
  assert.equal(anchor.deleted, 1);
  runtime.frame(70, hitFrame());
  runtime.confirmOrigin();
  runtime.frame(71, hitFrame());
  assert.equal(runtime.anchorState, "anchored");
  assert.equal(runtime.origin.visible, true);
  await runtime.end();
});

test("lifecycle 12: no unrelated scene disposal — panel, field and rays survive updates; end() disposes once", async () => {
  const { runtime, tracked } = await anchoredSetup();
  const panel = runtime.panel;
  for (let i = 0; i < 5; i++) {
    runtime.update({ placement: placement(), text: `t${i}`, detail: "", resultHeadline: "x", resultLines: ["a"] });
    runtime.setViewMode(i % 2 ? "guide" : "result");
    runtime.frame(2 + i, tracked());
  }
  assert.ok(runtime.scene.children.includes(panel));
  assert.ok(sceneHas(runtime, "assembly-field"));
  await runtime.end();
  assert.equal(runtime.fieldDiagnostics.xrSessionActive, false);
});

test("panel Auto button exists in the first row, keeps a large EXIT, and dispatches the auto action", () => {
  const { PANEL_BUTTONS, panelButtonAt } = require("../src/lib/ar/runtime.ts");
  const auto = PANEL_BUTTONS.find((b) => b.id === "auto");
  const exit = PANEL_BUTTONS.find((b) => b.id === "exit");
  assert.ok(auto && auto.y === exit.y);
  assert.equal(panelButtonAt(auto.x + 4, auto.y + 4).id, "auto");
  assert.ok(exit.w >= 200);
  assert.ok(PANEL_BUTTONS.every((b) => b.x + b.w <= 1024));
});

/* ---------- Inspection capture preview in the AR panel ---------- */
const { captureView, CapturePreviewStore } = require("../src/lib/ar/capturePreview.ts");
const rec = (store, over = {}) => store.begin({
  projectId: "p", stepId: "s1", source: "hololens camera", intent: "inspect",
  capturedAt: new Date().toISOString(), width: 1280, height: 720, dataUrl: "data:image/jpeg;base64,AA", detail: "", ...over,
});
const bitmap = (w, h) => ({ width: w, height: h, closed: 0, close() { this.closed++; } });

test("capture preview: Camera view draws the exact decoded capture, aspect preserved, never mirrored, distinct from the reference", async () => {
  const { runtime } = await setup();
  confirmField(runtime);
  const store = new CapturePreviewStore();
  const id = rec(store);
  const ref = bitmap(800, 800);
  runtime.update({ placement: placement(), text: "Step 1", detail: "", hasReference: true });
  runtime.setReferenceImage(ref);
  runtime.setCaptures(captureView(store.current), null, { label: "◉ CAPTURED", tone: "info" });
  const shot = bitmap(1280, 720);
  assert.equal(runtime.setCaptureBitmap(id, shot), true);
  globalThis.__drawCalls = [];
  globalThis.__canvasTexts = [];
  runtime.setViewMode("camera");
  const calls = globalThis.__drawCalls.filter((c) => c.image === shot);
  assert.equal(calls.length, 1, "the capture is drawn in Camera view");
  assert.ok(!globalThis.__drawCalls.some((c) => c.image === ref), "Camera view never shows the reference photo");
  const { w, h } = calls[0];
  assert.ok(w > 0 && h > 0, "positive width/height: no mirroring");
  assert.ok(Math.abs(w / h - 1280 / 720) < 0.01, "aspect ratio preserved");
  assert.ok(w >= 500, "large enough to judge a printed face");
  assert.ok(globalThis.__canvasTexts.some((t) => t.includes("◉ CAPTURED")), "indicator visible");
  globalThis.__drawCalls = [];
  runtime.setViewMode("guide");
  assert.ok(globalThis.__drawCalls.some((c) => c.image === ref), "Guide view still shows the reference");
  assert.ok(!globalThis.__drawCalls.some((c) => c.image === shot));
  await runtime.end();
  assert.equal(shot.closed, 1, "session end releases the capture bitmap");
});

test("capture preview: stale decodes are refused, replaced captures are released, at most two bitmaps kept", async () => {
  const { runtime } = await setup();
  const store = new CapturePreviewStore();
  const first = rec(store);
  store.finish(first, "complete", "Meta response received", "✗ Incorrect");
  runtime.setCaptures(captureView(store.current), captureView(store.lastResult), { label: "", tone: "idle" });
  const a = bitmap(1280, 720);
  runtime.setCaptureBitmap(first, a);
  const second = rec(store);
  runtime.setCaptures(captureView(store.current), captureView(store.lastResult), { label: "", tone: "idle" });
  assert.equal(a.closed, 0, "first capture still backs the displayed result");
  const third = rec(store);
  store.finish(third, "failed", "transport", "TRANSPORT ERROR");
  runtime.setCaptures(captureView(store.current), captureView(store.lastResult), { label: "", tone: "idle" });
  assert.equal(a.closed, 1, "no longer referenced: released");
  const late = bitmap(1280, 720);
  assert.equal(runtime.setCaptureBitmap(second, late), false, "a late decode of a superseded capture is refused");
  assert.ok(runtime.captureImageCount <= 2);
  await runtime.end();
});

test("capture preview: Result view pairs the result with ITS capture, not with a newer one", async () => {
  const { runtime } = await setup();
  const store = new CapturePreviewStore();
  const old = rec(store);
  store.finish(old, "complete", "", "✗ Incorrect");
  const newer = rec(store);
  runtime.update({ placement: placement(), text: "Step 1", detail: "", resultHeadline: "✗ Incorrect", resultTone: "incorrect", resultLines: ["Fix it"] });
  runtime.setCaptures(captureView(store.current), captureView(store.byId(old)), { label: "", tone: "idle" });
  const oldImg = bitmap(1280, 720), newImg = bitmap(1280, 720);
  runtime.setCaptureBitmap(old, oldImg);
  runtime.setCaptureBitmap(newer, newImg);
  globalThis.__drawCalls = [];
  runtime.setViewMode("result");
  assert.ok(globalThis.__drawCalls.some((c) => c.image === oldImg));
  assert.ok(!globalThis.__drawCalls.some((c) => c.image === newImg));
  await runtime.end();
});

test("capture preview never touches the anchored field; panel resize, Camera button and view toggling still work", async () => {
  const { runtime, tracked, anchor } = await anchoredSetup();
  runtime.frame(2, tracked());
  const pose = runtime.origin.matrix.clone();
  const field = runtime.fieldGroup;
  const store = new CapturePreviewStore();
  for (let i = 0; i < 5; i++) {
    const id = rec(store);
    runtime.setCaptures(captureView(store.current), null, { label: "◉ INSPECTING", tone: "info" });
    runtime.setCaptureBitmap(id, bitmap(1280, 720));
    runtime.setViewMode(i % 2 ? "camera" : "result");
    runtime.frame(3 + i, tracked(0.2));
  }
  assert.deepEqual(runtime.origin.matrix.elements, pose.elements);
  assert.equal(runtime.fieldGroup, field);
  assert.equal(runtime.fieldDiagnostics.fieldRendered, true);
  assert.equal(anchor.deleted ?? 0, 0);
  runtime.setPanelScale(1.2);
  assert.equal(runtime.currentPanelScale, 1.2);
  const { PANEL_BUTTONS, panelButtonAt } = require("../src/lib/ar/runtime.ts");
  const cam = PANEL_BUTTONS.find((b) => b.id === "camera");
  assert.ok(cam && cam.w >= 100);
  assert.equal(panelButtonAt(cam.x + 3, cam.y + 3).id, "camera");
  assert.ok(PANEL_BUTTONS.every((b) => b.x + b.w <= 1024));
  await runtime.end();
});

/* ---------- Guided HoloLens panel ---------- */
const { layoutButtons, PANEL_BUTTONS_TOP } = require("../src/lib/ar/runtime.ts");
const { deriveGuide, MARKER } = require("../src/lib/ar/guidedFlow.ts");
const guided = (state) => {
  const g = deriveGuide({ anchored: true, checking: false, serverVerified: state === "ok", manuallyConfirmed: false, isLastStep: false,
    summary: state === "wrong" ? { kind: "inspection", overall: { kind: "incorrect" } } : state === "partial" ? { kind: "inspection", overall: { kind: "uncertain" } } : null });
  return { placement: placement(), text: "Step 1", detail: "", guideLabel: g.label, guideMessage: g.message, guideTone: g.tone,
    shortInstruction: "Place the red 2×4 brick on the green marker.", primary: g.buttons, markerColor: g.marker, ghostTint: g.ghostTint,
    voiceLabel: "Voice: listening — DEBUG", anchorLabel: "AR FIELD ANCHORED · rendered DEBUG", stepLabel: "Step 1 of 3" };
};

test("guided panel: few large buttons, contextual primary actions, no voice-only or debug controls", () => {
  const ready = layoutButtons([{ id: "verify", label: "Check Step" }]);
  const ids = ready.map((b) => b.id);
  for (const removed of ["reference", "help", "next"]) assert.ok(!ids.includes(removed), removed);
  for (const kept of ["page", "page-prev", "recenter", "rotate-left", "rotate-right", "voice"]) assert.ok(ids.includes(kept), kept);
  assert.ok(ready.length <= 13);
  assert.ok(ready.filter((b) => b.primary).every((b) => b.h >= 96 && b.w >= 400), "primary buttons are large");
  assert.ok(ready.every((b) => b.h >= 76 && b.w >= (b.label.length <= 2 ? 64 : 100)), "gaze/hand-ray sized (icon buttons ≥ 64 px)");
  assert.ok(ready.every((b) => b.y >= PANEL_BUTTONS_TOP && b.x + b.w <= 1024 && b.y + b.h <= 768), "inside the panel, below the content");
  assert.ok(ready.every((b) => !(b.x + b.w > 960 && b.y + b.h > 704)), "clear of the resize corner");
  const partial = layoutButtons([{ id: "verify", label: "Check Again" }, { id: "confirm", label: "Confirm Position" }]);
  assert.deepEqual(partial.filter((b) => b.primary).map((b) => b.id), ["verify", "confirm"]);
});

test("guided panel: main view shows state, short instruction and message — and no debug text", async () => {
  const { runtime } = await setup();
  confirmField(runtime);
  globalThis.__canvasTexts = [];
  runtime.update(guided("wrong"));
  const texts = globalThis.__canvasTexts.join("\n");
  assert.match(texts, /Step 1 of 3/);
  assert.match(texts, /TRY AGAIN/);
  assert.match(texts, /red 2×4 brick/);
  assert.match(texts, /Adjust the brick/);
  assert.match(texts, /Check Again/);
  assert.ok(!/DEBUG/.test(texts), "voice/anchor debug rows are not drawn in the main view");
  await runtime.end();
});

test("guided hologram: transparent ghost + green target; red when wrong, yellow when partial; field pose untouched", async () => {
  const { runtime, tracked, anchor } = await anchoredSetup();
  runtime.frame(2, tracked());
  const pose = runtime.origin.matrix.clone();
  runtime.update(guided("ready"));
  assert.ok(sceneHas(runtime, "target-marker"));
  assert.equal(runtime.markerColorHex, MARKER.target);
  const body = runtime.target.getObjectByName("ghost-current").children[0].material;
  assert.equal(body.transparent, true);
  assert.equal(body.color.getHex(), 0x3ce6ff, "neutral transparent ghost while ready");
  runtime.update(guided("wrong"));
  assert.equal(runtime.markerColorHex, MARKER.wrong);
  assert.equal(body.color.getHex(), MARKER.wrong);
  runtime.update(guided("partial"));
  assert.equal(runtime.markerColorHex, MARKER.partial);
  runtime.update(guided("ok"));
  assert.equal(runtime.markerColorHex, MARKER.correct);
  assert.deepEqual(runtime.currentButtons.filter((b) => b.primary).map((b) => b.id), ["next"]);
  runtime.frame(3, tracked(0.2));
  assert.deepEqual(runtime.origin.matrix.elements, pose.elements);
  assert.equal(anchor.deleted ?? 0, 0);
  runtime.update({ ...guided("ready"), placement: null });
  assert.ok(!sceneHas(runtime, "target-marker"), "marker leaves with the step content");
  await runtime.end();
});

test("guided panel: Confirm Position and Next Step are real hand-ray buttons dispatching actions", async () => {
  const { runtime, actions } = await setup();
  confirmField(runtime);
  runtime.update(guided("partial"));
  runtime.frame(0, frame());
  runtime.scene.updateMatrixWorld(true);
  const { PANEL_W, PANEL_H } = require("../src/lib/ar/runtime.ts");
  const press = (id) => {
    const b = runtime.currentButtons.find((x) => x.id === id);
    const localX = ((b.x + b.w / 2) / PANEL_W - 0.5) * 0.72;
    const localY = (0.5 - (b.y + b.h / 2) / PANEL_H) * 0.54; // PANEL_WORLD_H
    const aim = new THREE.Vector3(localX, localY, 0).applyMatrix4(runtime.panel.matrixWorld);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), aim.sub(new THREE.Vector3(0, 1.6, 0)).normalize());
    runtime.onSelect({
      inputSource: { handedness: id, targetRaySpace: {} },
      frame: { getPose: () => ({ transform: { matrix: new THREE.Matrix4().compose(new THREE.Vector3(0, 1.6, 0), q, new THREE.Vector3(1, 1, 1)).toArray() } }) },
    });
  };
  press("confirm");
  runtime.update(guided("ok"));
  press("next");
  assert.deepEqual(actions, ["confirm", "next"]);
  await runtime.end();
});

/* ---------- Cumulative multi-block step hologram ---------- */
const brick = (over = {}) => ({ ...placement(), studs: null, dimensions: { x_mm: 31.8, y_mm: 9.6, z_mm: 15.8 }, rotation_deg: [0, 0, 0], ...over });
const named = (root, name) => { const out = []; root?.traverse((o) => { if (o.name === name) out.push(o); }); return out; };
const holoInfo = (hologram, extra = {}) => ({ placement: hologram.current[0] ?? null, hologram, text: "Step", detail: "", ...extra });

test("cumulative hologram: earlier steps dimmed/neutral without arrow, current blocks highlighted and state-coloured", async () => {
  const { runtime } = await setup();
  const hologram = {
    assembled: [brick({ position_m: [0, 0, 0] })],
    current: [brick({ target_block_id: "blue", position_m: [0, 0.0096, 0] }), brick({ instance: 2, position_m: [0.04, 0, 0] })],
  };
  runtime.update(holoInfo(hologram, { markerColor: MARKER.wrong, ghostTint: MARKER.wrong }));
  const assembled = named(runtime.target, "ghost-assembled");
  const current = named(runtime.target, "ghost-current");
  assert.equal(assembled.length, 1);
  assert.equal(current.length, 2);
  const dim = assembled[0].children[0].material;
  assert.equal(dim.color.getHex(), 0x9aa7b0, "already-assembled blocks stay neutral (never state-tinted)");
  assert.ok(dim.opacity < current[0].children[0].material.opacity, "dimmed vs highlighted");
  assert.ok(!assembled[0].children.some((c) => c.type === "ArrowHelper"), "no placement arrow on assembled blocks");
  assert.ok(current.every((g) => g.children[0].material.color.getHex() === MARKER.wrong), "current blocks show the correction colour");
  assert.equal(named(runtime.origin, "target-marker").length, 2, "one target marker per block of this step");
  assert.equal(runtime.markerColorHex, MARKER.wrong);
  // Y is the bottom face: the stacked blue block's root sits at 9.6 mm, its body centre half a body higher.
  assert.ok(Math.abs(current[0].position.y - 0.0096) < 1e-9);
  assert.ok(Math.abs(current[0].children[0].position.y - 0.0048) < 1e-9);
  runtime.update(holoInfo(hologram, { markerColor: MARKER.correct, ghostTint: MARKER.correct }));
  assert.equal(dim.color.getHex(), 0x9aa7b0);
  assert.equal(runtime.markerColorHex, MARKER.correct);
  await runtime.end();
});

test("step change: the previous step's geometry is removed before the next hologram appears", async () => {
  const { runtime } = await setup();
  runtime.update(holoInfo({ assembled: [], current: [brick(), brick({ instance: 2, position_m: [0.04, 0, 0] })] }));
  const first = runtime.target;
  runtime.update(holoInfo({ assembled: [], current: [] })); // navigate() clears step content first
  assert.equal(runtime.target, null);
  assert.equal(named(runtime.origin, "target-marker").length, 0);
  runtime.update(holoInfo({ assembled: [brick(), brick({ instance: 2, position_m: [0.04, 0, 0] })], current: [brick({ target_block_id: "blue", position_m: [0, 0.0096, 0] })] }));
  assert.notEqual(runtime.target, first);
  assert.equal(named(runtime.origin, "ghost-current").length, 1);
  assert.equal(named(runtime.origin, "ghost-assembled").length, 2);
  assert.equal(named(runtime.origin, "target-marker").length, 1, "no stale marker from the old step");
  await runtime.end();
});

test("hologram survives tracking loss and Re-anchor without moving; it is re-drawn at the newly confirmed origin", async () => {
  const { runtime, tracked } = await anchoredSetup();
  runtime.update(holoInfo({ assembled: [brick()], current: [brick({ target_block_id: "blue", position_m: [0, 0.0096, 0] })] }));
  runtime.frame(2, tracked());
  const group = runtime.target;
  for (let i = 0; i < 60; i++) runtime.frame(3 + i, { ...frame(), getPose: () => null });
  assert.equal(runtime.anchorState, "tracking_lost");
  assert.equal(runtime.target, group);
  assert.equal(runtime.origin.visible, true, "field + hologram held (red field), never silently deleted");
  assert.equal(group.visible, false, "step hologram hidden while its position is not trustworthy");
  runtime.reset();
  assert.equal(runtime.target, group, "Re-anchor keeps the step content, only the origin is re-placed");
  runtime.frame(80, hitFrame(0.7));
  runtime.confirmOrigin();
  runtime.frame(81, hitFrame(0.7));
  assert.equal(runtime.anchorState, "anchored");
  assert.equal(group.parent, runtime.origin);
  assert.ok(Math.abs(runtime.origin.matrix.elements[13] - 0.7) < 1e-9);
  await runtime.end();
});

test("a hologram never dispatches an action or verification", async () => {
  const { runtime, actions, tracked } = await anchoredSetup();
  for (let i = 0; i < 5; i++) {
    runtime.update(holoInfo({ assembled: [brick()], current: [brick({ target_block_id: "blue", position_m: [0, 0.0096 * (i + 1), 0] })] }, { markerColor: MARKER.correct, ghostTint: MARKER.correct }));
    runtime.frame(10 + i, tracked());
  }
  assert.deepEqual(actions, [], "drawing guidance never triggers verify/next or any other action");
  await runtime.end();
});

test("panel Stop auto: dispatched by hand ray, keeps XR, anchor and hologram; disappears once stopped", async () => {
  const { runtime, actions, tracked, anchor, ended } = await anchoredSetup();
  runtime.update({ placement: placement(), text: "Step", detail: "", autoActive: true, autoButton: "Pause" });
  runtime.frame(2, tracked());
  const pose = runtime.origin.matrix.clone();
  const target = runtime.target;
  const { PANEL_W, PANEL_H } = require("../src/lib/ar/runtime.ts");
  const b = runtime.currentButtons.find((x) => x.id === "auto-stop");
  assert.ok(b, "Stop auto is on the panel while Autonomous runs");
  assert.notEqual(b.x, runtime.currentButtons.find((x) => x.id === "auto").x, "Stop and Pause are distinct controls");
  runtime.scene.updateMatrixWorld(true);
  const aim = new THREE.Vector3(((b.x + b.w / 2) / PANEL_W - 0.5) * 0.72, (0.5 - (b.y + b.h / 2) / PANEL_H) * 0.54, 0).applyMatrix4(runtime.panel.matrixWorld);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), aim.sub(new THREE.Vector3(0, 1.6, 0)).normalize());
  runtime.onSelect({ inputSource: { handedness: "right", targetRaySpace: {} }, frame: { getPose: () => ({ transform: { matrix: new THREE.Matrix4().compose(new THREE.Vector3(0, 1.6, 0), q, new THREE.Vector3(1, 1, 1)).toArray() } }) } });
  assert.deepEqual(actions, ["auto-stop"]);
  runtime.update({ placement: placement(), text: "Step", detail: "", autoActive: false, autoButton: "Auto ▶" });
  runtime.frame(3, tracked(0.2));
  assert.ok(!runtime.currentButtons.some((x) => x.id === "auto-stop"));
  assert.deepEqual(runtime.origin.matrix.elements, pose.elements, "anchored field unchanged");
  assert.equal(runtime.target, target, "hologram unchanged");
  assert.equal(runtime.fieldDiagnostics.fieldRendered, true);
  assert.equal(anchor.deleted ?? 0, 0);
  assert.equal(ended(), 0, "XR session still active");
  await runtime.end();
});
