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
      fillText() {},
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
test("mocked XR renderer lifecycle: manual local origin stays fixed under head movement; tracking loss requires confirmation", async () => {
  const { runtime, session, ended } = await setup();
  assert.equal(renderer.xr.enabled, true);
  runtime.frame(0, frame());
  runtime.confirming = true;
  runtime.frame(1, frame());
  const origin = runtime.origin.matrix.clone();
  runtime.frame(2, frame(0.4));
  assert.deepEqual(runtime.origin.matrix.elements, origin.elements);
  runtime.frame(3, { getViewerPose: () => null });
  assert.equal(runtime.origin.visible, false);
  assert.equal(runtime.selected, false);
  runtime.frame(4, frame(0.4));
  assert.equal(runtime.selected, false);
  session.space.dispatchEvent(new Event("reset"));
  assert.equal(runtime.candidateValid, false);
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
  assert.equal(runtime.origin.visible, false);
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
  runtime.frame(4, { ...frame(), getPose: () => null });
  assert.equal(runtime.selected, false);
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
  const q = new THREE.Quaternion();
  const aim = new THREE.Vector3(0.08, -0.032, 0).applyMatrix4(
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

test("visibility loss hides targets and a new session starts with no old origin", async () => {
  const first = await setup();
  first.runtime.frame(0, frame());
  first.runtime.confirming = true;
  first.runtime.frame(1, frame());
  first.session.visibilityState = "visible-blurred";
  first.session.dispatchEvent(new Event("visibilitychange"));
  first.runtime.frame(2, frame());
  assert.equal(first.runtime.origin.visible, false);
  assert.equal(first.runtime.selected, false);
  await first.runtime.end();
  const second = await setup();
  assert.equal(second.runtime.selected, false);
  assert.equal(second.runtime.anchor, null);
  await second.runtime.end();
});
