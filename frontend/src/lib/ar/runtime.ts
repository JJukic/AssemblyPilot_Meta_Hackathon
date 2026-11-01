import * as THREE from "three";
import { disposeObject, ghost } from "./geometry";
import type { Placement } from "./data";

export type Action = "previous" | "next" | "verify";
export interface Guidance {
  placement: Placement | null;
  text: string;
  detail: string;
}
const labels = [
  "Previous",
  "Next",
  "Verify Step",
  "Re-anchor",
  "Confirm origin",
  "Rotate -",
  "Rotate +",
  "Recenter panel",
  "Nearer",
  "Farther",
  "Lower",
  "Higher",
];
/** Real WebXR only: Three's XR manager renders each XRView with its tracked pose/projection. */
export class SpatialSession {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera();
  private origin = new THREE.Group();
  private target: THREE.Group | null = null;
  private panel: THREE.Mesh;
  private canvas = document.createElement("canvas");
  private texture: THREE.CanvasTexture;
  private reference: XRReferenceSpace | null = null;
  private hit: XRHitTestSource | null = null;
  private anchor: XRAnchor | null = null;
  private candidate = new THREE.Matrix4();
  private fixed = new THREE.Matrix4();
  private selected = false;
  private confirming = false;
  private tracking = false;
  private candidateValid = false;
  private epoch = 0;
  private yaw = 0;
  private distance = 0.65;
  private height = -0.25;
  private panelPlaced = false;
  private ended = false;
  private message =
    "Position the preview on your real table, then Confirm origin.";
  private info: Guidance = { placement: null, text: "", detail: "" };
  private lastStatus = "";
  private reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.035, 0.04, 24).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x00ffff, side: THREE.DoubleSide }),
  );
  constructor(
    private session: XRSession,
    host: HTMLElement,
    private status: (s: string) => void,
    private action: (a: Action) => void,
    private done: () => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "low-power",
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(1024, 768);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType("local");
    host.appendChild(this.renderer.domElement);
    this.canvas.width = 1024;
    this.canvas.height = 512;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.panel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.64, 0.32),
      new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: false,
      }),
    );
    this.panel.renderOrder = 10;
    this.scene.add(this.origin, this.panel, this.reticle);
    session.addEventListener("end", this.onEnd);
    session.addEventListener("select", this.onSelect);
    session.addEventListener("visibilitychange", this.onVisibility);
  }
  async initialize() {
    try {
      await this.renderer.xr.setSession(this.session);
      this.reference = this.renderer.xr.getReferenceSpace();
      if (!this.reference) throw new Error("No local tracked reference space");
      this.reference.addEventListener("reset", this.onReset);
      try {
        if (this.session.requestHitTestSource) {
          const viewer = await this.session.requestReferenceSpace("viewer");
          const hit = await this.session.requestHitTestSource({
            space: viewer,
          });
          if (this.ended) {
            hit?.cancel();
            throw new Error("XR session ended during initialization");
          }
          this.hit = hit ?? null;
        }
      } catch {
        /* Optional feature: use explicitly confirmed manual placement. */
      }
      if (this.ended) throw new Error("XR session ended during initialization");
      this.message = this.hit
        ? "Surface detection available. Confirm that the cyan ring is on your tabletop."
        : "No surface detection. Manually align the preview with your table; Nearer/Farther/Lower/Higher adjust it.";
      this.draw();
      this.renderer.setAnimationLoop(this.frame);
    } catch (cause) {
      await this.end();
      throw cause;
    }
  }
  update(info: Guidance) {
    this.info = info;
    if (this.target) {
      this.origin.remove(this.target);
      disposeObject(this.target);
      this.target = null;
    }
    if (info.placement) {
      this.target = ghost(info.placement);
      this.origin.add(this.target);
    }
    this.draw();
  }
  private draw() {
    const c = this.canvas.getContext("2d")!;
    c.clearRect(0, 0, 1024, 512);
    c.fillStyle = "rgba(5,18,28,.94)";
    c.fillRect(0, 0, 1024, 512);
    c.fillStyle = "#bffaff";
    c.font = "bold 32px sans-serif";
    const words = this.info.text.split(/\s+/);
    let line = "",
      y = 40;
    for (const word of words) {
      if (c.measureText(line + word).width > 960) {
        c.fillText(line, 20, y);
        y += 38;
        line = "";
        if (y > 116) break;
      }
      line += word + " ";
    }
    c.fillText(line, 20, y);
    c.font = "23px sans-serif";
    c.fillStyle = "#ffffff";
    c.fillText(this.info.detail.slice(0, 88), 20, 165);
    c.fillStyle = "#83e8eb";
    c.fillText(this.message.slice(0, 92), 20, 203);
    c.font = "20px sans-serif";
    c.fillText(
      "Guidance only. Pinch/select buttons; inspection never advances from a hologram.",
      20,
      239,
    );
    labels.forEach((label, i) => {
      const x = (i % 4) * 256,
        y = 266 + Math.floor(i / 4) * 82;
      c.fillStyle = "#183f54";
      c.fillRect(x + 4, y, 248, 74);
      c.fillStyle = "#ffffff";
      c.font = "23px sans-serif";
      c.fillText(label, x + 14, y + 45);
    });
    this.texture.needsUpdate = true;
    const status = this.message;
    if (this.lastStatus !== status) {
      this.lastStatus = status;
      this.status(status);
    }
  }
  private onVisibility = () => {
    if (this.session.visibilityState !== "visible") this.loseTracking();
  };
  private onReset = () => this.reset();
  private loseTracking() {
    if (this.tracking) {
      this.tracking = false;
      this.reset();
      this.message =
        "Tracking lost. Hologram hidden. Re-align and confirm the origin after recovery.";
      this.draw();
    }
    this.origin.visible = false;
    this.reticle.visible = false;
  }
  reset() {
    this.epoch++;
    this.anchor?.delete();
    this.anchor = null;
    this.selected = false;
    this.confirming = false;
    this.candidateValid = false;
    this.panelPlaced = false;
    this.origin.visible = false;
    this.reticle.visible = false;
    this.message =
      "Re-anchor: align with the same physical assembly origin and Confirm origin.";
    this.draw();
  }
  private onSelect = (event: XRInputSourceEvent) => {
    if (!this.reference || !this.tracking) return;
    const pose = event.frame.getPose(
      event.inputSource.targetRaySpace,
      this.reference,
    );
    if (!pose) return;
    const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
    const ray = new THREE.Raycaster(
      new THREE.Vector3().setFromMatrixPosition(m),
      new THREE.Vector3(0, 0, -1).transformDirection(m),
    );
    const hit = ray.intersectObject(this.panel)[0];
    if (!hit?.uv) return;
    const y = (1 - hit.uv.y) * 512,
      x = hit.uv.x * 1024;
    if (y < 266) return;
    const index = Math.floor((y - 266) / 82) * 4 + Math.floor(x / 256);
    if (index <= 2) {
      this.action((["previous", "next", "verify"] as Action[])[index]);
      return;
    }
    if (index === 3) this.reset();
    if (index === 4 && this.candidateValid && !this.selected)
      this.confirming = true;
    if (index === 5 || index === 6) {
      this.yaw += index === 5 ? -0.1 : 0.1;
    }
    if (index === 7) this.panelPlaced = false;
    if (index >= 8) {
      this.hit?.cancel();
      this.hit = null;
      this.reset();
      if (index === 8) this.distance = Math.max(0.2, this.distance - 0.05);
      if (index === 9) this.distance = Math.min(1.5, this.distance + 0.05);
      if (index === 10) this.height -= 0.025;
      if (index === 11) this.height += 0.025;
      this.height = THREE.MathUtils.clamp(this.height, -1.5, 0.2);
    }
  };
  private frame = (_time: number, frame?: XRFrame) => {
    if (!frame || !this.reference || this.ended) return;
    const pose = frame.getViewerPose(this.reference);
    if (!pose || this.session.visibilityState !== "visible") {
      this.loseTracking();
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.tracking = true;
    const head = new THREE.Matrix4().fromArray(pose.transform.matrix);
    if (!this.panelPlaced) {
      this.panel.matrixAutoUpdate = false;
      this.panel.matrix
        .copy(head)
        .multiply(new THREE.Matrix4().makeTranslation(0, 0.12, -0.85));
      this.panelPlaced = true;
    }
    if (this.selected && this.anchor) {
      const tracked = frame.getPose(this.anchor.anchorSpace, this.reference);
      if (!tracked) {
        this.loseTracking();
        this.renderer.render(this.scene, this.camera);
        return;
      }
      this.fixed.fromArray(tracked.transform.matrix);
    }
    if (!this.selected) {
      this.candidateValid = false;
      const hit =
        this.hit &&
        frame.getHitTestResults(this.hit)[0]?.getPose(this.reference);
      if (hit) {
        const matrix = new THREE.Matrix4().fromArray(hit.transform.matrix),
          position = new THREE.Vector3().setFromMatrixPosition(matrix);
        const viewer = new THREE.Vector3().setFromMatrixPosition(head);
        if (
          new THREE.Vector3(0, 1, 0).transformDirection(matrix).y > 0.9 &&
          position.y < viewer.y - 0.1 &&
          position.distanceTo(viewer) < 2
        ) {
          this.candidate.copy(matrix);
          this.candidateValid = true;
        }
      } else if (!this.hit) {
        const position = new THREE.Vector3(0, 0, -this.distance).applyMatrix4(
          head,
        );
        position.y += this.height;
        this.candidate.makeTranslation(position.x, position.y, position.z);
        this.candidateValid = true;
      }
      if (this.confirming && this.candidateValid) {
        this.confirming = false;
        this.selected = true;
        this.fixed.copy(this.candidate);
        const epoch = ++this.epoch;
        this.message =
          "Origin confirmed in local tracking space (session only; drift is possible).";
        this.draw();
        if (frame.createAnchor) {
          const p = new THREE.Vector3(),
            q = new THREE.Quaternion(),
            scale = new THREE.Vector3();
          this.fixed.decompose(p, q, scale);
          try {
            void frame
              .createAnchor(new XRRigidTransform(p, q), this.reference)
              .then((anchor) => {
                if (this.ended || epoch !== this.epoch) {
                  anchor.delete();
                  return;
                }
                this.anchor = anchor;
                this.message =
                  "Spatial anchor active for this session. Re-anchor if drift is visible.";
                this.draw();
              })
              .catch(() => {
                if (!this.ended && epoch === this.epoch) {
                  this.message =
                    "Anchor API failed; using confirmed local tracking space. Re-anchor if drift is visible.";
                  this.draw();
                }
              });
          } catch {
            this.message =
              "Anchor API unavailable; confirmed local tracking space only.";
            this.draw();
          }
        }
      }
    }
    this.origin.matrixAutoUpdate = false;
    this.origin.matrix
      .copy(this.selected ? this.fixed : this.candidate)
      .multiply(new THREE.Matrix4().makeRotationY(this.yaw));
    this.origin.visible =
      !!this.target && (this.selected || this.candidateValid);
    this.reticle.visible = !this.selected && this.candidateValid;
    this.reticle.matrixAutoUpdate = false;
    this.reticle.matrix.copy(this.candidate);
    this.renderer.render(this.scene, this.camera);
  };
  private onEnd = () => {
    if (this.ended) return;
    this.ended = true;
    this.epoch++;
    this.renderer.setAnimationLoop(null);
    this.reference?.removeEventListener("reset", this.onReset);
    this.hit?.cancel();
    this.anchor?.delete();
    this.session.removeEventListener("select", this.onSelect);
    this.session.removeEventListener("visibilitychange", this.onVisibility);
    this.session.removeEventListener("end", this.onEnd);
    disposeObject(this.scene);
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.done();
  };
  async end() {
    try {
      await this.session.end();
    } finally {
      this.onEnd();
    }
  }
}
