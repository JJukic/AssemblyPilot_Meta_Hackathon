import * as THREE from "three";
import { disposeObject, ghost } from "./geometry";
import type { Placement } from "./data";
import { fitRect } from "./reference";
import { paginate, verificationLabel, wrapText, type VerificationStatus } from "./panel";
import { AnchorTracker, DEFAULT_FIELD, fieldCorners, type AssemblyFieldConfig } from "./field";
import {
  EMPTY_DIAGNOSTICS, SelectDebouncer, effectiveHover, rayEndpoint, uvToPanel,
  type InteractionDiagnostics,
} from "./interaction";
import {
  ManipulationMachine, PANEL_SCALE_DEFAULT, clampPanelScale, panelRegionAt,
} from "./panel-manipulation";

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
  readonly interaction: InteractionDiagnostics = { ...EMPTY_DIAGNOSTICS, sources: [] };
  private inputVisuals = new Map<XRInputSource, { line: THREE.Line; cursor: THREE.Group }>();
  private hoverBySource = new Map<XRInputSource, Action | null>();
  private hoveredButton: PanelButton | null = null;
  private hoverPoint: { x: number; y: number } | null = null;
  private pressedButton: Action | null = null;
  private lastHoverDrawn: { x: number; y: number } | null = null;
  private pressedTimer: ReturnType<typeof setTimeout> | null = null;
  private debouncer = new SelectDebouncer(300);
  readonly manipulation = new ManipulationMachine();
  private manipSource: XRInputSource | null = null;
  private dragOffset = new THREE.Vector3();
  private resizeStart: { distance: number; scale: number } | null = null;
  private panelPos = new THREE.Vector3();
  private panelQuat = new THREE.Quaternion();
  private panelScale = PANEL_SCALE_DEFAULT;
  get currentPanelScale() { return this.panelScale; }
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
    this.loadPanelScale();
    this.scene.add(this.origin, this.panel, this.reticle);
    this.rebuildField();
    session.addEventListener("end", this.onEnd);
    session.addEventListener("select", this.onSelect);
    session.addEventListener("selectstart", this.onSelectStart);
    session.addEventListener("selectend", this.onSelectEnd);
    session.addEventListener("visibilitychange", this.onVisibility);
    session.addEventListener("inputsourceschange", this.onSourcesChange);
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
  private applyPanelTransform() {
    this.panel.matrixAutoUpdate = false;
    this.panel.matrix.compose(
      this.panelPos,
      this.panelQuat,
      new THREE.Vector3(this.panelScale, this.panelScale, 1),
    );
    this.panel.matrixWorldNeedsUpdate = true;
  }
  /** Explicit user actions; these affect ONLY the floating panel. */
  resetPanelSize() {
    this.panelScale = PANEL_SCALE_DEFAULT;
    this.applyPanelTransform();
    this.persistPanelScale();
    this.message = "Panel size reset. The assembly field did not move.";
    this.draw();
  }
  setPanelScale(scale: number) {
    this.panelScale = clampPanelScale(scale);
    this.applyPanelTransform();
    this.persistPanelScale();
  }
  private persistPanelScale() {
    try {
      localStorage.setItem("assemblypilot.panel-scale", String(this.panelScale));
    } catch { /* storage unavailable in this context */ }
  }
  private loadPanelScale() {
    try {
      const raw = Number(localStorage.getItem("assemblypilot.panel-scale"));
      if (Number.isFinite(raw) && raw > 0) this.panelScale = clampPanelScale(raw);
    } catch { /* keep the default */ }
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
    // Title bar = drag handle. Highlight tracks the manipulation state.
    const manipState = this.manipulation.state;
    c.fillStyle = manipState === "dragging" ? "#2f9ec7" : manipState === "hovering_drag_handle" ? "#1d6d8a" : "rgba(20,50,70,.95)";
    c.fillRect(0, 0, PANEL_W, 56);
    c.fillStyle = "#bffaff";
    c.font = "20px sans-serif";
    c.fillText(manipState === "dragging" ? "⠿ MOVING PANEL — release to drop" : "⠿ AssemblyPilot", PANEL_W - 260, 38);
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
    // Buttons (hover = exact button under the hand-ray cursor)
    for (const b of PANEL_BUTTONS) {
      const isRef = b.id === "reference";
      const hovered = this.hoveredButton?.id === b.id;
      const pressed = this.pressedButton === b.id;
      c.fillStyle = pressed ? "#ffffff" : hovered ? "#2f9ec7" : b.danger ? "#8b1e2d" : isRef && !this.showReference ? "#33505f" : "#1b4a66";
      c.fillRect(b.x, b.y, b.w, b.h);
      c.strokeStyle = pressed ? "#ffffff" : hovered ? "#ffffff" : b.danger ? "#ff8fa3" : "#7df3ff";
      c.lineWidth = hovered || pressed ? 6 : 3;
      c.strokeRect(b.x, b.y, b.w, b.h);
      c.fillStyle = pressed ? "#04202f" : "#ffffff";
      c.font = b.danger ? "bold 27px sans-serif" : "bold 23px sans-serif";
      const rawLabel =
        b.id === "result"
          ? this.viewMode === "result"
            ? "Guide"
            : "Result"
          : isRef
            ? this.showReference
              ? "Hide ref."
              : "Show ref."
            : b.label;
      const label = this.hoveredButton?.id === b.id ? rawLabel.toUpperCase() : rawLabel;
      const w = c.measureText(label).width;
      c.fillText(label, b.x + Math.max(8, (b.w - w) / 2), b.y + 52);
    }
    // Targeting cursor drawn in panel space at the exact ray hit.
    if (this.hoverPoint) {
      c.strokeStyle = "#7df3ff";
      c.lineWidth = 5;
      c.beginPath();
      c.arc(this.hoverPoint.x, this.hoverPoint.y, 17, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = "#ffffff";
      c.beginPath();
      c.arc(this.hoverPoint.x, this.hoverPoint.y, 4, 0, Math.PI * 2);
      c.fill();
    }
    // Resize handle (lower-right corner): grip box, highlighted on hover/active.
    const resizing = manipState === "resizing" || manipState === "hovering_resize_handle";
    c.fillStyle = resizing ? "#2f9ec7" : "rgba(27,74,102,.9)";
    c.fillRect(PANEL_W - 64, PANEL_H - 64, 64, 64);
    c.strokeStyle = resizing ? "#ffffff" : "#7df3ff";
    c.lineWidth = resizing ? 5 : 3;
    c.strokeRect(PANEL_W - 64, PANEL_H - 64, 64, 64);
    c.fillStyle = "#ffffff";
    c.font = "bold 26px sans-serif";
    c.fillText("◢", PANEL_W - 44, PANEL_H - 20);
    if (this.hoveredButton && !info.anchorLabel) {
      c.fillStyle = "#7df3ff";
      c.font = "bold 19px sans-serif";
      c.fillText(`Targeting: ${this.hoveredButton.label}`, 20, 444);
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
  private onSourcesChange = () => this.syncInputSources();

  private makeCursor(): THREE.Group {
    const group = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.009, 0.012, 32),
      new THREE.MeshBasicMaterial({ color: 0x7df3ff, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: false }),
    );
    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(0.0028, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: false }),
    );
    ring.renderOrder = 20;
    dot.renderOrder = 21;
    group.add(ring, dot);
    group.visible = false;
    return group;
  }

  private syncInputSources() {
    const list = (this.session as XRSession).inputSources;
    const sources: XRInputSource[] = list ? Array.from(list) : [];
    for (const source of sources) {
      if (this.inputVisuals.has(source)) continue;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
        new THREE.LineBasicMaterial({ color: 0x7df3ff, transparent: true, opacity: 0.75 }),
      );
      line.renderOrder = 15;
      line.visible = false;
      const cursor = this.makeCursor();
      this.inputVisuals.set(source, { line, cursor });
      this.scene.add(line, cursor);
    }
    for (const [source, visual] of Array.from(this.inputVisuals)) {
      if (sources.includes(source)) continue;
      this.scene.remove(visual.line, visual.cursor);
      disposeObject(visual.line);
      disposeObject(visual.cursor);
      this.inputVisuals.delete(source);
      this.hoverBySource.delete(source);
    }
    this.interaction.sources = sources.map((source) => ({
      handedness: source.handedness ?? "none",
      targetRayMode: source.targetRayMode ?? "unknown",
      tracked: this.inputVisuals.get(source)?.line.visible ?? false,
    }));
  }

  /** THE panel hit test: cursor, hover and Air Tap all use this one path. */
  private raycastPanel(inputSource: XRInputSource, xrFrame: XRFrame) {
    if (!this.reference || typeof xrFrame.getPose !== "function") return null;
    const pose = xrFrame.getPose(inputSource.targetRaySpace, this.reference);
    if (!pose) return null;
    const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
    const origin = new THREE.Vector3().setFromMatrixPosition(m);
    const direction = new THREE.Vector3(0, 0, -1).transformDirection(m).normalize();
    const ray = new THREE.Raycaster(origin, direction);
    const hit = ray.intersectObject(this.panel)[0] ?? null;
    if (!hit?.uv) return { origin, direction, hit: null, point: null, button: null };
    const point = uvToPanel(hit.uv, PANEL_W, PANEL_H);
    return { origin, direction, hit, point, button: panelButtonAt(point.x, point.y) };
  }

  private panelPlaneHit(source: XRInputSource, xrFrame: XRFrame): THREE.Vector3 | null {
    if (!this.reference || typeof xrFrame.getPose !== "function") return null;
    const pose = xrFrame.getPose(source.targetRaySpace, this.reference);
    if (!pose) return null;
    const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
    const origin = new THREE.Vector3().setFromMatrixPosition(m);
    const direction = new THREE.Vector3(0, 0, -1).transformDirection(m).normalize();
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(this.panelQuat);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, this.panelPos);
    return new THREE.Raycaster(origin, direction).ray.intersectPlane(plane, new THREE.Vector3());
  }

  private applyManipulation(source: XRInputSource, xrFrame: XRFrame) {
    if (!this.manipulation.active || this.manipSource !== source) return;
    const hit = this.panelPlaneHit(source, xrFrame);
    if (!hit) {
      // Tracking lost mid-gesture: end at the last applied transform.
      this.manipulation.cancel();
      this.manipSource = null;
      this.interaction.manipulation = "idle (tracking lost — panel kept its position)";
      this.interaction.lastFailure = "Manipulation cancelled: hand tracking lost; panel kept its last position";
      return;
    }
    this.manipulation.move([hit.x, hit.y, hit.z]);
    if (this.manipulation.state === "dragging") {
      this.panelPos.copy(hit).add(this.dragOffset);
    } else if (this.manipulation.state === "resizing" && this.resizeStart) {
      const distance = Math.max(0.05, hit.distanceTo(this.panelPos));
      this.panelScale = clampPanelScale(this.resizeStart.scale * (distance / this.resizeStart.distance));
    }
    this.applyPanelTransform();
    this.interaction.manipulation = this.manipulation.state;
  }

  private onSelectStart = (event: XRInputSourceEvent) => {
    if (this.manipulation.active) return;
    const source = event.inputSource as XRInputSource;
    const result = this.raycastPanel(source, event.frame as XRFrame);
    if (!result?.hit || !result.point) return;
    const region = panelRegionAt(result.point.x, result.point.y, PANEL_W, PANEL_H);
    if (!region || region === "panel") return;
    const hit = this.panelPlaneHit(source, event.frame as XRFrame);
    if (!hit) return;
    if (!this.manipulation.grab(region, [hit.x, hit.y, hit.z])) return;
    this.manipSource = source;
    if (region === "drag") this.dragOffset.copy(this.panelPos).sub(hit);
    else this.resizeStart = { distance: Math.max(0.05, hit.distanceTo(this.panelPos)), scale: this.panelScale };
    this.interaction.manipulation = this.manipulation.state;
    this.interaction.lastFailure = null;
    this.draw();
  };

  private onSelectEnd = () => {
    if (!this.manipulation.active) return;
    this.manipulation.release();
    this.manipSource = null;
    this.resizeStart = null;
    this.persistPanelScale();
    this.interaction.manipulation = "idle";
    this.draw();
  };

  private updateInputRays(xrFrame: XRFrame) {
    if (this.ended) return;
    this.syncInputSources();
    if (this.manipSource) this.applyManipulation(this.manipSource, xrFrame);
    let anyTracked = false;
    let intersects = false;
    for (const [source, visual] of this.inputVisuals) {
      const result = this.raycastPanel(source, xrFrame);
      if (!result) {
        visual.line.visible = false;
        visual.cursor.visible = false;
        this.hoverBySource.set(source, null);
        continue;
      }
      anyTracked = true;
      const end = rayEndpoint(
        [result.origin.x, result.origin.y, result.origin.z],
        [result.direction.x, result.direction.y, result.direction.z],
        result.hit ? result.hit.distance : null,
      );
      visual.line.geometry.setFromPoints([
        result.origin,
        new THREE.Vector3(end[0], end[1], end[2]),
      ]);
      visual.line.visible = true;
      if (result.hit && result.point) {
        intersects = true;
        const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(
          this.panel.getWorldQuaternion(new THREE.Quaternion()),
        );
        visual.cursor.position.copy(result.hit.point).addScaledVector(normal, 0.004);
        visual.cursor.quaternion.copy(this.panel.getWorldQuaternion(new THREE.Quaternion()));
        visual.cursor.visible = true;
        this.hoverBySource.set(source, result.button?.id ?? null);
        this.hoverPoint = result.point;
      } else {
        visual.cursor.visible = false;
        this.hoverBySource.set(source, null);
      }
    }
    this.interaction.hasTrackedRay = anyTracked;
    this.interaction.rayIntersectsPanel = intersects;
    if (!intersects) this.hoverPoint = null;
    this.interaction.sources = this.interaction.sources.map((d, i) => ({
      ...d,
      tracked: Array.from(this.inputVisuals.values())[i]?.line.visible ?? d.tracked,
    }));
    if (!this.manipulation.active) {
      const point = this.hoverPoint;
      const region = point ? panelRegionAt(point.x, point.y, PANEL_W, PANEL_H) : null;
      this.manipulation.hover(region, !!effectiveHover(this.hoverBySource.values()));
      this.interaction.manipulation = this.manipulation.state;
    }
    const hoverId = effectiveHover(this.hoverBySource.values());
    const hoverButton = hoverId ? PANEL_BUTTONS.find((b) => b.id === hoverId) ?? null : null;
    const moved = this.hoverPoint
      ? Math.abs(this.hoverPoint.x - (this.lastHoverDrawn?.x ?? -99)) > 3 ||
        Math.abs(this.hoverPoint.y - (this.lastHoverDrawn?.y ?? -99)) > 3
      : this.lastHoverDrawn !== null;
    if (hoverButton?.id !== this.hoveredButton?.id || moved) {
      this.hoveredButton = hoverButton;
      this.interaction.hoveredButton = hoverButton?.id ?? null;
      this.lastHoverDrawn = this.hoverPoint ? { ...this.hoverPoint } : null;
      this.draw();
    }
  }

  private onSelect = (event: XRInputSourceEvent) => {
    const source = event.inputSource as XRInputSource;
    const key = `${source.handedness ?? "none"}:${source.targetRayMode ?? "ray"}`;
    this.interaction.lastSelect = `${key} @ ${new Date().toISOString()}`;
    if (!this.debouncer.tryAccept(key, Date.now())) {
      this.interaction.lastFailure = "Duplicate select ignored (one gesture, one action)";
      return;
    }
    if (this.manipulation.active) {
      if (source !== this.manipSource) {
        this.interaction.lastFailure = "Select ignored: panel manipulation in progress with the other hand";
        return;
      }
      if (this.manipulation.moved) {
        this.interaction.lastFailure = "Click suppressed: the pinch moved/resized the panel";
        return;
      }
    }
    if (!this.reference || !this.tracking) {
      this.interaction.lastFailure = "Select ignored: XR tracking unavailable";
      return;
    }
    const result = this.raycastPanel(source, event.frame as XRFrame);
    if (!result) {
      this.interaction.lastFailure = "Select ignored: input ray has no tracked pose";
      return;
    }
    if (!result.hit || !result.point) {
      this.interaction.lastFailure = "Select ignored: ray did not intersect the panel";
      return;
    }
    const { y } = result.point;
    const button = result.button;
    if (button) {
      this.pressedButton = button.id;
      this.interaction.lastAction = button.id;
      this.interaction.lastFailure = null;
      this.draw();
      if (this.pressedTimer) clearTimeout(this.pressedTimer);
      this.pressedTimer = setTimeout(() => {
        this.pressedButton = null;
        if (!this.ended) this.draw();
      }, 220);
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
      this.interaction.lastAction = "confirm-origin";
      return;
    }
    this.interaction.lastFailure = "Select on the panel but outside any button — nothing activated";
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
      this.panelPos.setFromMatrixPosition(head);
      this.panelQuat.setFromRotationMatrix(head);
      this.panelPos.add(new THREE.Vector3(0, 0.12, -0.85).applyQuaternion(this.panelQuat));
      this.applyPanelTransform();
      this.panelPlaced = true;
    }
    this.updateInputRays(frame);
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
    this.session.removeEventListener("selectstart", this.onSelectStart);
    this.session.removeEventListener("selectend", this.onSelectEnd);
    this.session.removeEventListener("visibilitychange", this.onVisibility);
    this.session.removeEventListener("inputsourceschange", this.onSourcesChange);
    this.session.removeEventListener("end", this.onEnd);
    if (this.pressedTimer) clearTimeout(this.pressedTimer);
    this.inputVisuals.clear();
    this.hoverBySource.clear();
    this.debouncer.reset();
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
