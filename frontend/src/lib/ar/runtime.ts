import * as THREE from "three";
import { disposeObject, ghost } from "./geometry";
import type { Placement } from "./data";
import { fitRect } from "./reference";
import { paginate, verificationLabel, wrapText, type VerificationStatus } from "./panel";
import { AnchorTracker, DEFAULT_FIELD, fieldCorners, type AssemblyFieldConfig } from "./field";

export type Action =
  | "previous"
  | "next"
  | "verify"
  | "exit"
  | "reanchor"
  | "recenter"
  | "reference"
  | "page"
  | "help"
  | "voice"
  | "result";
export interface Guidance {
  placement: Placement | null;
  text: string;
  detail: string;
  stepLabel?: string;
  title?: string;
  instruction?: string;
  blockLabel?: string;
  verification?: VerificationStatus;
  hasReference?: boolean;
  voiceLabel?: string;
  voiceDetail?: string;
  anchorLabel?: string;
  autoLabel?: string;
  lastCommand?: string;
  diagnostic?: string;
  resultHeadline?: string;
  resultTone?: string;
  resultLines?: string[];
  resultErrorsOnly?: boolean;
}

export const PANEL_W = 1024;
export const PANEL_H = 640;
export interface PanelButton {
  id: Action;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  danger?: boolean;
}
function row(ids: [Action, string][], y: number, dangerLast = false): PanelButton[] {
  const gap = 8;
  const w = Math.floor((PANEL_W - gap * (ids.length + 1)) / ids.length);
  return ids.map(([id, label], i) => ({
    id,
    label,
    x: gap + i * (w + gap),
    y,
    w,
    h: 84,
    danger: dangerLast && i === ids.length - 1,
  }));
}
export const PANEL_BUTTONS: PanelButton[] = [
  ...row(
    [
      ["previous", "◀ Previous"],
      ["next", "Next ▶"],
      ["verify", "Verify Step"],
      ["exit", "EXIT AR"],
    ],
    452,
    true,
  ),
  ...row(
    [
      ["reanchor", "Re-anchor"],
      ["recenter", "Recenter"],
      ["reference", "Reference"],
      ["result", "Result"],
      ["page", "More text"],
      ["help", "Help"],
      ["voice", "🎤 Speak"],
    ],
    544,
  ),
];
export function panelButtonAt(x: number, y: number): PanelButton | null {
  return (
    PANEL_BUTTONS.find((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) ??
    null
  );
}

type RefImage = {
  width: number;
  height: number;
  close?: () => void;
} & Record<string, unknown>;

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
    "Position the preview on your real table, then tap the panel (above the buttons) to Confirm origin.";
  private info: Guidance = { placement: null, text: "", detail: "" };
  private lastStatus = "";
  private refImage: RefImage | null = null;
  private showReference = true;
  private helpVisible = false;
  private viewMode: "guide" | "result" = "guide";
  private resultPage = 0;
  private instructionPage = 0;
  private lastInstruction = "";
  readonly anchorTracker = new AnchorTracker();
  private fieldConfig: AssemblyFieldConfig = { ...DEFAULT_FIELD };
  private fieldGroup: THREE.Group | null = null;
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
    this.canvas.width = PANEL_W;
    this.canvas.height = PANEL_H;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.panel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.72, 0.45),
      new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: false,
      }),
    );
    this.panel.renderOrder = 10;
    this.scene.add(this.origin, this.panel, this.reticle);
    this.rebuildField();
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
  get anchorState() { return this.anchorTracker.state; }
  get isAnchored() { return this.anchorTracker.isAnchored; }
  setFieldSize(widthM: number, depthM: number) {
    this.fieldConfig = { widthM, depthM };
    this.rebuildField();
  }
  get fieldSize() { return { ...this.fieldConfig }; }
  /** Visible tabletop assembly field: boundary + translucent plane + front tick.
   *  Child of `origin`, so it inherits exactly the confirmed field pose and
   *  is never moved by panel, result, voice or step updates. */
  private rebuildField() {
    if (this.fieldGroup) {
      this.origin.remove(this.fieldGroup);
      disposeObject(this.fieldGroup);
    }
    const group = new THREE.Group();
    const corners = fieldCorners(this.fieldConfig);
    const points = [...corners, corners[0]].map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const boundary = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0xffd166 }),
    );
    boundary.position.y = 0.002;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(this.fieldConfig.widthM, this.fieldConfig.depthM).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.07, depthWrite: false }),
    );
    plane.position.y = 0.001;
    const front = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.004, 0.012),
      new THREE.MeshBasicMaterial({ color: 0xffd166 }),
    );
    front.position.set(0, 0.003, this.fieldConfig.depthM / 2 - 0.01);
    group.add(plane, boundary, front);
    this.fieldGroup = group;
    this.origin.add(group);
  }
  update(info: Guidance) {
    this.info = info;
    if (info.instruction !== this.lastInstruction) {
      this.lastInstruction = info.instruction ?? "";
      this.instructionPage = 0;
    }
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
  /** Replace the expected-reference bitmap. Previous bitmap is closed/disposed. */
  setReferenceImage(image: RefImage | null) {
    if (this.refImage && this.refImage !== image) {
      try {
        this.refImage.close?.();
      } catch {
        /* bitmap already closed */
      }
    }
    this.refImage = image;
    this.draw();
  }
  get hasReferenceImage() {
    return this.refImage !== null;
  }
  setShowReference(value: boolean) {
    this.showReference = value;
    this.draw();
  }
  get referenceVisible() {
    return this.showReference;
  }
  setHelpVisible(value: boolean) {
    this.helpVisible = value;
    this.draw();
  }
  setViewMode(mode: "guide" | "result") {
    if (this.viewMode !== mode) this.resultPage = 0;
    this.viewMode = mode;
    this.draw();
  }
  get panelViewMode() {
    return this.viewMode;
  }
  recenterPanel() {
    this.panelPlaced = false;
    this.message = "Panel recentered in front of you. The assembly hologram did not move.";
    this.draw();
  }
  // Legacy panel adjustment controls retained for manual alignment fallback.
  adjustPanel(kind: "nearer" | "farther" | "lower" | "higher" | "rotate-left" | "rotate-right") {
    if (kind === "nearer") this.distance = Math.max(0.2, this.distance - 0.05);
    if (kind === "farther") this.distance = Math.min(1.5, this.distance + 0.05);
    if (kind === "lower") this.height = THREE.MathUtils.clamp(this.height - 0.025, -1.5, 0.2);
    if (kind === "higher") this.height = THREE.MathUtils.clamp(this.height + 0.025, -1.5, 0.2);
    if (this.selected && kind.startsWith("rotate")) {
      this.message = "Field is anchored. Rotation is locked — use Re-anchor Assembly Field to rotate it.";
      this.draw();
      return;
    }
    if (kind === "rotate-left") this.yaw -= 0.1;
    if (kind === "rotate-right") this.yaw += 0.1;
    if (kind.startsWith("rotate")) return;
    this.hit?.cancel();
    this.hit = null;
    this.reset();
  }
  private draw() {
    const c = this.canvas.getContext("2d")!;
    c.clearRect(0, 0, PANEL_W, PANEL_H);
    c.fillStyle = "rgba(4,16,26,.96)";
    c.fillRect(0, 0, PANEL_W, PANEL_H);
    const info = this.info;
    const stepLabel = info.stepLabel ?? info.text.split("—")[0]?.trim() ?? "";
    const title = info.title ?? info.text;
    // Header
    c.fillStyle = "#7df3ff";
    c.font = "bold 30px sans-serif";
    c.fillText(stepLabel.slice(0, 42), 20, 38);
    const vLabel = verificationLabel(info.verification ?? "not_verified");
    c.fillStyle =
      info.verification === "verified"
        ? "#6dffa8"
        : info.verification === "uncertain"
          ? "#ffd166"
          : "#ffb3b3";
    c.font = "bold 24px sans-serif";
    c.fillText(vLabel, 560, 38);
    // Title (2 lines)
    c.fillStyle = "#ffffff";
    c.font = "bold 30px sans-serif";
    wrapText(title, 62)
      .slice(0, 2)
      .forEach((line, i) => c.fillText(line, 20, 76 + i * 34));
    const hasRef = !!info.hasReference;
    const showRef = hasRef && this.showReference;
    const maxChars = showRef ? 42 : 68;
    if (this.viewMode === "result" && info.resultHeadline) {
      // Real Meta result: headline answers "is it correct?", lines answer
      // "what is wrong?" and "what next?", paginated — never truncated.
      const toneColor: Record<string, string> = {
        correct: "#6dffa8",
        verified: "#6dffa8",
        incorrect: "#ff9d9d",
        uncertain: "#ffd166",
        error: "#ff9d9d",
        inspecting: "#7df3ff",
      };
      c.fillStyle = toneColor[info.resultTone ?? ""] ?? "#ffffff";
      c.font = "bold 27px sans-serif";
      c.fillText(info.resultHeadline.slice(0, 58), 20, 132);
      const rawLines = info.resultLines ?? [];
      const wrapped = rawLines.flatMap((line) => wrapText(line, maxChars));
      const pages = paginate(wrapped, 6);
      const page = pages[Math.min(this.resultPage, pages.length - 1)] ?? [];
      c.font = "23px sans-serif";
      c.fillStyle = "#eafcff";
      page.forEach((line, i) => c.fillText(line, 20, 168 + i * 30));
      if (pages.length > 1) {
        c.fillStyle = "#83e8eb";
        c.font = "20px sans-serif";
        c.fillText(
          `Result page ${Math.min(this.resultPage, pages.length - 1) + 1}/${pages.length} — tap “More text”`,
          20,
          168 + 6 * 30,
        );
      }
      if (hasRef) {
        const box = { x: 664, y: 116, w: 340, h: 250 };
        c.strokeStyle = "#38d9ff";
        c.lineWidth = 3;
        c.strokeRect(box.x, box.y, box.w, box.h);
        c.fillStyle = "#83e8eb";
        c.font = "bold 19px sans-serif";
        c.fillText("EXPECTED REFERENCE", box.x + 8, box.y - 8);
        if (this.showReference && this.refImage) {
          const fit = fitRect(this.refImage.width, this.refImage.height, box.w - 8, box.h - 8);
          try {
            c.drawImage(
              this.refImage as unknown as CanvasImageSource,
              box.x + 4 + fit.x,
              box.y + 4 + fit.y,
              fit.w,
              fit.h,
            );
          } catch {
            c.fillStyle = "#ffd166";
            c.font = "21px sans-serif";
            c.fillText("Reference failed to load", box.x + 14, box.y + 60);
          }
        }
      }
    } else if (this.helpVisible) {
      c.font = "23px sans-serif";
      c.fillStyle = "#bffaff";
      const help = [
        "Voice / button commands:",
        "Next step · Previous step · Verify step",
        "Show reference · Hide reference",
        "Show instructions · Read instructions",
        "Re-anchor · Recenter · Help · Stop listening · Exit AR",
        "Exit without voice: use the large EXIT AR button,",
        "or the HoloLens Start gesture (system menu).",
        "Verify always needs a fresh real camera photo.",
      ];
      help.forEach((line, i) => c.fillText(line, 20, 138 + i * 32));
    } else {
      // Instruction, paginated (never truncated silently)
      const instruction = info.instruction ?? info.text;
      const lines = wrapText(instruction, maxChars);
      const pages = paginate(lines, 7);
      const page = pages[Math.min(this.instructionPage, pages.length - 1)] ?? [];
      c.font = "25px sans-serif";
      c.fillStyle = "#eafcff";
      page.forEach((line, i) => c.fillText(line, 20, 138 + i * 32));
      if (pages.length > 1) {
        c.fillStyle = "#83e8eb";
        c.font = "20px sans-serif";
        c.fillText(
          `Text page ${Math.min(this.instructionPage, pages.length - 1) + 1}/${pages.length} — tap “More text”`,
          20,
          138 + 7 * 32,
        );
      }
      // Reference image box (right side) — guidance only, not camera evidence
      if (hasRef) {
        const box = { x: 664, y: 116, w: 340, h: 250 };
        c.strokeStyle = "#38d9ff";
        c.lineWidth = 3;
        c.strokeRect(box.x, box.y, box.w, box.h);
        c.fillStyle = "#83e8eb";
        c.font = "bold 19px sans-serif";
        c.fillText("EXPECTED REFERENCE", box.x + 8, box.y - 8);
        if (this.showReference && this.refImage) {
          const fit = fitRect(this.refImage.width, this.refImage.height, box.w - 8, box.h - 8);
          try {
            c.drawImage(
              this.refImage as unknown as CanvasImageSource,
              box.x + 4 + fit.x,
              box.y + 4 + fit.y,
              fit.w,
              fit.h,
            );
          } catch {
            c.fillStyle = "#ffd166";
            c.font = "21px sans-serif";
            c.fillText("Reference failed to load", box.x + 14, box.y + 60);
          }
        } else if (this.showReference) {
          c.fillStyle = "#ffd166";
          c.font = "21px sans-serif";
          c.fillText("Loading reference…", box.x + 14, box.y + 60);
        } else {
          c.fillStyle = "#ffffff";
          c.font = "21px sans-serif";
          c.fillText("Reference hidden", box.x + 14, box.y + 60);
          c.fillText("Say “Show reference”", box.x + 14, box.y + 90);
        }
      } else {
        // Image-free compact note does not occupy the text area.
        c.fillStyle = "#ffd166";
        c.font = "20px sans-serif";
        c.fillText("No reference photo for this step.", 20, 386);
      }
    }
    // Detail / block / voice rows
    c.font = "21px sans-serif";
    c.fillStyle = "#ffffff";
    c.fillText((info.blockLabel ?? info.detail).slice(0, 92), 20, 392);
    c.fillStyle = "#83e8eb";
    if (!info.diagnostic)
      c.fillText((info.voiceLabel ?? "Voice: off").slice(0, 92), 20, 420);
    if (info.diagnostic) {
      c.fillStyle = info.diagnostic.startsWith("✗") ? "#ff9d9d" : "#6dffa8";
      c.font = "bold 20px sans-serif";
      c.fillText(info.diagnostic.slice(0, 96), 20, 420);
      c.font = "21px sans-serif";
    } else if (info.lastCommand) {
      c.fillStyle = "#6dffa8";
      c.fillText(`Heard: “${info.lastCommand}”`.slice(0, 92), 520, 420);
    }
    // Compact capture health (mic / phase / last transcript): a failure here
    // stays visible until the next utterance, never hidden by "Listening".
    if (info.voiceDetail) {
      c.fillStyle = "#ffd166";
      c.font = "18px sans-serif";
      c.fillText(info.voiceDetail.slice(0, 108), 20, 372);
      c.font = "21px sans-serif";
    }
    if (info.anchorLabel) {
      c.fillStyle = "#ffd166";
      c.font = "bold 18px sans-serif";
      c.fillText(info.anchorLabel.slice(0, 108), 20, 444);
    }
    if (info.autoLabel) {
      c.fillStyle = "#7df3ff";
      c.font = "18px sans-serif";
      c.fillText(info.autoLabel.slice(0, 108), 560, 372);
    }
    c.fillStyle = "#bffaff";
    c.font = "19px sans-serif";
    if (!info.anchorLabel) c.fillText(this.message.slice(0, 96), 20, 444);
    // Buttons
    for (const b of PANEL_BUTTONS) {
      const isRef = b.id === "reference";
      c.fillStyle = b.danger ? "#8b1e2d" : isRef && !this.showReference ? "#33505f" : "#1b4a66";
      c.fillRect(b.x, b.y, b.w, b.h);
      c.strokeStyle = b.danger ? "#ff8fa3" : "#7df3ff";
      c.lineWidth = 3;
      c.strokeRect(b.x, b.y, b.w, b.h);
      c.fillStyle = "#ffffff";
      c.font = b.danger ? "bold 27px sans-serif" : "bold 23px sans-serif";
      const label =
        b.id === "result"
          ? this.viewMode === "result"
            ? "Guide"
            : "Result"
          : isRef
            ? this.showReference
              ? "Hide ref."
              : "Show ref."
            : b.label;
      const w = c.measureText(label).width;
      c.fillText(label, b.x + Math.max(8, (b.w - w) / 2), b.y + 52);
    }
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
  private onReset = () => {
    if (this.selected) {
      this.anchorTracker.onReferenceReset();
      this.message =
        "TABLETOP TRACKING UNAVAILABLE — reference space reset. Field held at its last confirmed pose as LOST; re-anchor deliberately when tracking recovers.";
      this.draw();
      return;
    }
    this.reset();
  };
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
    this.anchorTracker.beginReanchor();
    this.fixed.identity();
    this.candidate.identity();
    this.selected = false;
    this.confirming = false;
    this.candidateValid = false;
    this.panelPlaced = false;
    this.origin.visible = false;
    this.reticle.visible = false;
    this.message =
      "Re-anchor: align with the same physical assembly origin, then tap the panel to Confirm origin.";
    this.draw();
  }
  confirmOrigin() {
    if (this.candidateValid && !this.selected) this.confirming = true;
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
    const y = (1 - hit.uv.y) * PANEL_H,
      x = hit.uv.x * PANEL_W;
    const button = panelButtonAt(x, y);
    if (button) {
      if (button.id === "reanchor") {
        this.reset();
      } else if (button.id === "recenter") {
        this.recenterPanel();
      } else if (button.id === "reference") {
        this.showReference = !this.showReference;
        this.draw();
      } else if (button.id === "result") {
        this.viewMode = this.viewMode === "result" ? "guide" : "result";
        this.resultPage = 0;
        this.draw();
      } else if (button.id === "page") {
        if (this.viewMode === "result" && this.info.resultHeadline) {
          const wrapped = (this.info.resultLines ?? []).flatMap((line) =>
            wrapText(line, this.showReference && this.info.hasReference ? 42 : 68),
          );
          const pages = paginate(wrapped, 6);
          this.resultPage = (this.resultPage + 1) % pages.length;
        } else {
          const lines = wrapText(this.info.instruction ?? this.info.text, this.showReference && this.info.hasReference ? 42 : 68);
          const pages = paginate(lines, 7);
          this.instructionPage = (this.instructionPage + 1) % pages.length;
        }
        this.draw();
      } else if (button.id === "help") {
        this.helpVisible = !this.helpVisible;
        this.draw();
      }
      this.action(button.id);
      return;
    }
    // Non-button panel tap above the button rows: confirm origin when pending.
    if (y < 452 && this.candidateValid && !this.selected) {
      this.confirming = true;
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
      const held = this.anchorTracker.onPose(tracked ? tracked.transform.matrix : null);
      if (held.pose) this.fixed.fromArray(held.pose);
      if (held.state === "tracking_lost") {
        this.loseTracking();
        this.message =
          "TABLETOP TRACKING UNAVAILABLE — tracking lost after a sustained dropout. Re-anchor the assembly field deliberately.";
        this.draw();
        this.renderer.render(this.scene, this.camera);
        return;
      }
      if (held.state === "tracking_degraded") {
        this.message = "Tracking degraded — holding the assembly field at its last confirmed pose.";
      }
    }
    if (!this.selected) {
      this.candidateValid = false;
      this.anchorTracker.preview(false);
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
          this.anchorTracker.preview(true);
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
        this.anchorTracker.confirm(this.candidate.elements, !frame.createAnchor);
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
                this.anchorTracker.confirm(this.fixed.elements, false);
                this.message =
                  "Assembly field anchored (session anchor). It stays on the tabletop across steps; re-anchor after a new AR session.";
                this.draw();
              })
              .catch(() => {
                if (!this.ended && epoch === this.epoch) {
                  this.anchorTracker.confirm(this.fixed.elements, true);
                  this.message =
                    "Assembly field anchored to the session-local reference (no native anchor). It does not persist after Exit AR; re-anchor each session.";
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
    this.setReferenceImage(null);
    this.session.removeEventListener("select", this.onSelect);
    this.session.removeEventListener("visibilitychange", this.onVisibility);
    this.session.removeEventListener("end", this.onEnd);
    this.anchorTracker.release();
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
