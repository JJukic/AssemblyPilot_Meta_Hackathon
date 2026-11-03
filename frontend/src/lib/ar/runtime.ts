import * as THREE from "three";
import { disposeObject, ghost } from "./geometry";
import type { Placement } from "./data";
import type { HologramView } from "./hologram";
import { fitRect } from "./reference";
import { paginate, wrapText, type VerificationStatus } from "./panel";
import type { CaptureView, IndicatorTone } from "./capturePreview";
import {
  AnchorTracker, DEFAULT_FIELD, EMPTY_FIELD_DIAGNOSTICS, fieldCorners, fieldInView, fieldViewGeometry,
  validPose, type AssemblyFieldConfig, type FieldDiagnostics,
} from "./field";
import {
  EMPTY_DIAGNOSTICS, SelectDebouncer, effectiveHover, rayEndpoint, uvToPanel,
  type InteractionDiagnostics,
} from "./interaction";
import {
  DRAG_BAR_H, ManipulationMachine, PANEL_SCALE_DEFAULT, ROTATE_FROM_RIGHT, ROTATE_W, clampPanelScale, panelRegionAt,
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
  | "result"
  | "auto"
  | "camera"
  | "confirm"
  | "auto-stop"
  | "page-prev"
  | "rotate-left"
  | "rotate-right"
  | "confirm-field"
  | "field-left-5"
  | "field-left-1"
  | "field-right-1"
  | "field-right-5"
  | "field-rotate-reset";
export interface Guidance {
  /** Legacy single target (used when `hologram` is absent). */
  placement: Placement | null;
  /** Cumulative step hologram: earlier steps dimmed, current step highlighted. Guidance only. */
  hologram?: HologramView;
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
  /** Label for the in-AR Autonomous button (start / pause / resume). */
  autoButton?: string;
  /** Autonomous Assembly is starting/running/paused: show the separate Stop control. */
  autoActive?: boolean;
  lastCommand?: string;
  diagnostic?: string;
  resultHeadline?: string;
  resultTone?: string;
  resultLines?: string[];
  resultErrorsOnly?: boolean;
  /** Guided flow (short German UI). */
  guideLabel?: string;
  guideMessage?: string;
  guideTone?: "ready" | "info" | "ok" | "warn" | "bad";
  /** Short visible instruction, e.g. "Place the red 2×4 brick on the green marker." */
  shortInstruction?: string;
  /** Contextual large buttons (≤ 2). Empty while checking. */
  primary?: { id: Action; label: string }[];
  /** Compact in-AR voice status line and the Start/Stop Voice button label. */
  voiceLine?: string;
  voiceTone?: "idle" | "info" | "ok" | "warn" | "error";
  voiceButton?: string;
  /** Tabletop target marker colour and ghost tint (null = neutral transparent ghost). */
  markerColor?: number;
  ghostTint?: number | null;
}

export type PanelView = "guide" | "result" | "camera";
export const PANEL_W = 1024;
export const PANEL_H = 768;
/** Panel size in metres at scale 1 (same 4:3 aspect as the texture). */
export const PANEL_WORLD_W = 0.72;
export const PANEL_WORLD_H = 0.54;
export interface PanelButton {
  id: Action;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  danger?: boolean;
  /** Large contextual action of the guided flow (Check Step / Next Step / …). */
  primary?: boolean;
  /** The single main action (first contextual button): widest and most prominent. */
  main?: boolean;
}
/** Top of the button area: tapping the panel ABOVE this confirms the field origin. */
export const PANEL_BUTTONS_TOP = 484;
const PRIMARY_Y = 484, PRIMARY_H = 96, SECONDARY_Y = 590, SECONDARY_H = 82, TEXT_Y = 682, TEXT_H = 76;
/** Third row stops before the lower-right resize corner. */
const TEXT_ROW_W = 948;
/** Bottom of the content area (text/images never draw into the buttons). */
const CONTENT_BOTTOM = 448;
/** Baseline of the always-visible voice status line (between content and buttons). */
const VOICE_LINE_Y = 476;
/** Field placement: fine-rotation row and the direct hand-rotation dial (content area). */
const PLACE_Y = 380, PLACE_H = 84;
export const FIELD_DIAL = { x: 20, y: 286, w: 984, h: 80 };
function row(ids: [Action, string, number?][], y: number, h: number, dangerLast = false, width = PANEL_W): PanelButton[] {
  const gap = 10;
  const total = ids.reduce((sum, [, , weight]) => sum + (weight ?? 1), 0);
  const unit = (width - gap * (ids.length + 1)) / total;
  let x = gap;
  return ids.map(([id, label, weight], i) => {
    const w = Math.floor(unit * (weight ?? 1));
    const button = { id, label, x, y, w, h, danger: dangerLast && i === ids.length - 1 };
    x += w + gap;
    return button;
  });
}
/** Always-visible secondary controls (gaze/hand-ray sized, ≥ 82 px tall). */
const SECONDARY: [Action, string, number?][] = [
  ["previous", "◀ Previous Step", 1.1],
  ["reanchor", "Re-anchor"],
  ["result", "Show Result"],
  ["auto", "Start Autonomous", 1.3],
  ["exit", "Exit AR", 1.45],
];
/** Text paging, camera view and window controls (air-tap fallback for move/rotate). */
const TEXT_ROW: [Action, string, number?][] = [
  ["page-prev", "◀ Previous Text"],
  ["page", "More Text ▶"],
  ["camera", "Camera", 0.8],
  ["voice", "Start Voice", 0.95],
  ["rotate-left", "⟲", 0.5],
  ["rotate-right", "⟳", 0.5],
  ["recenter", "Reset Panel Position", 1.3],
];
/** Initial field placement: confirm + reset (large), and fine rotation steps. */
const PLACEMENT_PRIMARY: [Action, string, number?][] = [
  ["confirm-field", "✓ Confirm Assembly Field", 1.7],
  ["field-rotate-reset", "Reset Rotation"],
];
const PLACEMENT_FINE: [Action, string, number?][] = [
  ["field-left-5", "⟲ 5°"],
  ["field-left-1", "⟲ 1°"],
  ["field-right-1", "⟳ 1°"],
  ["field-right-5", "⟳ 5°"],
];
/**
 * Panel layout: at most two large contextual buttons of the guided flow,
 * plus one fixed secondary row. No voice-only control exists.
 */
export function layoutButtons(
  primary: { id: Action; label: string }[],
  opts: { autoActive?: boolean; placing?: boolean } = {},
): PanelButton[] {
  const top = primary.slice(0, 2);
  if (opts.placing) {
    // Before the field is confirmed: position + orientation controls replace the guided buttons.
    return [
      ...row(PLACEMENT_FINE, PLACE_Y, PLACE_H),
      ...row(PLACEMENT_PRIMARY, PRIMARY_Y, PRIMARY_H).map((b) => ({ ...b, primary: true })),
      ...row(SECONDARY, SECONDARY_Y, SECONDARY_H, true),
      ...row(TEXT_ROW, TEXT_Y, TEXT_H, false, TEXT_ROW_W),
    ];
  }
  // While Autonomous runs, a distinct Stop sits next to Pause/Resume, so it can be
  // stopped completely without focusing the 2D page (which blurs the session).
  const secondary: [Action, string, number?][] = opts.autoActive
    ? SECONDARY.flatMap((b) => (b[0] === "auto" ? [b, ["auto-stop", "■ Stop Autonomous", 1.2] as [Action, string, number]] : [b]))
    : SECONDARY;
  return [
    // The first contextual action is the main one (e.g. Check Again before Confirm Position).
    ...(top.length
      ? row(top.map((p, i) => [p.id, p.label, top.length > 1 && i === 0 ? 1.4 : 1] as [Action, string, number]), PRIMARY_Y, PRIMARY_H)
          .map((b, i) => ({ ...b, primary: true, main: i === 0 }))
      : []),
    ...row(secondary, SECONDARY_Y, SECONDARY_H, true),
    ...row(TEXT_ROW, TEXT_Y, TEXT_H, false, TEXT_ROW_W),
  ];
}
export const DEFAULT_PRIMARY: { id: Action; label: string }[] = [{ id: "verify", label: "Check Step" }];
/** Layout of the initial "Bereit" state (kept for callers/tests that need static coordinates). */
export const PANEL_BUTTONS: PanelButton[] = layoutButtons(DEFAULT_PRIMARY);
export function panelButtonAt(x: number, y: number, buttons: PanelButton[] = PANEL_BUTTONS): PanelButton | null {
  return buttons.find((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) ?? null;
}

/** Panel move/rotate tuning (far manipulation, metres / radians). */
export const PANEL_PUSH_GAIN = 3;
export const PANEL_MIN_DIST = 0.3;
export const PANEL_MAX_DIST = 3;
export const PANEL_ROTATE_GAIN = 1.5;
export const PANEL_MAX_TILT = Math.PI / 3;
export const PANEL_ROTATE_STEP = Math.PI / 12;
/** Field dial: 10° of hand-ray sweep turns the field 5° (precise alignment). */
export const FIELD_DIAL_GAIN = 0.5;
const DEG = Math.PI / 180;
const FIELD_STEPS: Record<string, number> = {
  "field-left-5": 5 * DEG, "field-left-1": 1 * DEG, "field-right-1": -1 * DEG, "field-right-5": -5 * DEG,
};
function inRect(p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }) {
  return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
}

const GUIDE_TONE: Record<"ready" | "info" | "ok" | "warn" | "bad", string> = {
  ready: "#2ee66b",
  info: "#38d9ff",
  ok: "#2ee66b",
  warn: "#ffd23f",
  bad: "#ff4d4d",
};

/** Flat target outline + translucent fill on the tabletop under the ghost (field space). */
function targetMarker(p: Placement): THREE.Group {
  const margin = 0.012;
  const w = p.dimensions.x_mm / 1000 + margin, d = p.dimensions.z_mm / 1000 + margin;
  const group = new THREE.Group();
  group.name = "target-marker";
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x2ee66b, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }),
  );
  const pts = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [-w / 2, -d / 2]]
    .map(([x, z]) => new THREE.Vector3(x, 0.0005, z));
  const outline = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x2ee66b }));
  group.add(fill, outline);
  group.position.set(p.position_m[0], p.position_m[1] + 0.001, p.position_m[2]);
  group.rotation.y = THREE.MathUtils.degToRad(p.rotation_deg[1]);
  return group;
}

const TONE_COLOR: Record<IndicatorTone, string> = {
  idle: "#9fb3c0",
  info: "#7df3ff",
  ok: "#6dffa8",
  warn: "#ffd166",
  error: "#ff9d9d",
};

/** Result banner colours: success, mistake/error, warning, active check (HoloLens-bright). */
const RESULT_TONE: Record<string, string> = {
  correct: "#2ee66b", verified: "#2ee66b", incorrect: "#ff4d4d", error: "#ff4d4d", uncertain: "#ffd23f", inspecting: "#38d9ff",
};

/**
 * Result view geometry (panel px). With an image the text column is on the
 * left and the inspected image fills the right side of the content area,
 * clear of the page indicator line and the button rows.
 */
export function resultLayout(withImage: boolean) {
  const text = { x: 20, w: withImage ? 560 : 984 };
  return {
    banner: { x: 20, y: 74, w: text.w, h: 56 },
    text,
    headlineChars: withImage ? 34 : 60,
    lineChars: withImage ? 48 : 82,
    image: { x: 596, y: 74, w: 408, h: 344 },
  };
}

const ROW_LABEL = /^(Problem|Expected|Observed|Fix|Suggested action|Next|Why uncertain|Step verified|Error|Note|Correction plan|Issue \d+(?: \([^)]*\))?|Additional view needed(?: \([^)]*\))?):\s*(.*)$/;

/** Wrap result lines for the panel; a leading "Label:" is kept apart so it can be highlighted. */
export function resultRows(lines: string[], maxChars: number): { label: string | null; text: string }[] {
  return lines.flatMap((line) => {
    const m = ROW_LABEL.exec(line);
    if (!m) return wrapText(line, maxChars).map((text) => ({ label: null, text }));
    const label = m[1];
    const parts = wrapText(`${label}: ${m[2]}`, maxChars);
    return parts.map((text, i) => (i === 0 ? { label, text: text.slice(label.length + 1).trimStart() } : { label: null, text }));
  });
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
  /** Frames since the hit-test source last produced a usable tabletop hit. */
  private hitMisses = 0;
  private placementMode: "surface" | "gaze" | "none" = "none";
  private visibility = "visible";
  private viewerLostFrames = 0;
  private framesRendered = 0;
  private fieldRendered = false;
  private viewGeometry: { distanceM: number; angleDeg: number } | null = null;
  private targetKey = "";
  /** Tabletop target marker (child of origin, next to the ghost). */
  private marker: THREE.Group | null = null;
  private buttons: PanelButton[] = PANEL_BUTTONS;
  private epoch = 0;
  /** Field yaw about the tabletop normal (parent transform of the whole assembly field). */
  private yaw = 0;
  private defaultYaw = 0;
  private fieldYawInit = false;
  private grabTarget: "panel" | "field" = "panel";
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
  private viewMode: PanelView = "guide";
  /** Decoded inspection captures, keyed by capture id; bounded to the ≤2 ids referenced below. */
  private captureImages = new Map<number, RefImage>();
  private captureCurrent: CaptureView | null = null;
  private captureResult: CaptureView | null = null;
  private indicator: { label: string; tone: IndicatorTone } = { label: "", tone: "idle" };
  /** Current text page per view and the page count of the last draw (never truncated). */
  private pages: Record<PanelView, number> = { guide: 0, result: 0, camera: 0 };
  private pageCounts: Record<PanelView, number> = { guide: 1, result: 1, camera: 1 };
  private lastResultKey = "";
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
  /** Grab snapshot for move/rotate (hand ray + panel pose at pinch start). */
  private grab: {
    origin: THREE.Vector3; dir: THREE.Vector3; distance: number; offset: THREE.Vector3;
    azimuth: number; elevation: number; yaw: number; pitch: number; fieldYaw: number;
  } | null = null;
  private resizeStart: { distance: number; scale: number } | null = null;
  private panelPos = new THREE.Vector3();
  private panelQuat = new THREE.Quaternion();
  private panelScale = PANEL_SCALE_DEFAULT;
  get currentPanelScale() { return this.panelScale; }
  private fieldConfig: AssemblyFieldConfig = { ...DEFAULT_FIELD };
  private fieldGroup: THREE.Group | null = null;
  private fieldTint: { line: THREE.LineBasicMaterial; plane: THREE.MeshBasicMaterial; front: THREE.MeshBasicMaterial } | null = null;
  private currentTint = -1;
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
      new THREE.PlaneGeometry(PANEL_WORLD_W, PANEL_WORLD_H),
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
  /** The last XR frame had a viewer pose (head tracking available). */
  get viewerTracked() { return !this.ended && this.tracking; }
  /** Changes on every Re-anchor / new placement: prepared automatic captures of an older epoch are invalid. */
  get anchorEpoch() { return this.epoch; }
  /**
   * Automatic inspection allowed right now: a trustworthy anchor AND a current
   * viewer pose. `isAnchored` alone is not enough (the anchor is held during
   * head-tracking loss, but no frame of the field can then be trusted).
   */
  get autoInspectionReady() { return !this.ended && this.anchorTracker.isAnchored && this.tracking; }
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
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffd166 });
    const boundary = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMaterial);
    boundary.position.y = 0.002;
    const planeMaterial = new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.07, depthWrite: false });
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(this.fieldConfig.widthM, this.fieldConfig.depthM).rotateX(-Math.PI / 2),
      planeMaterial,
    );
    plane.position.y = 0.001;
    const frontMaterial = new THREE.MeshBasicMaterial({ color: 0xffd166 });
    const front = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.004, 0.012), frontMaterial);
    front.position.set(0, 0.003, this.fieldConfig.depthM / 2 - 0.01);
    group.add(plane, boundary, front);
    group.name = "assembly-field";
    this.fieldGroup = group;
    this.fieldTint = { line: lineMaterial, plane: planeMaterial, front: frontMaterial };
    this.currentTint = -1;
    this.origin.add(group);
  }
  /** Field colour encodes trust: cyan preview, light grey anchored, orange held, red lost. */
  private tintField(color: number) {
    if (!this.fieldTint || this.currentTint === color) return;
    this.currentTint = color;
    this.fieldTint.line.color.setHex(color);
    this.fieldTint.plane.color.setHex(color);
    this.fieldTint.front.color.setHex(color);
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
  /** Step content only. The field, its anchor and the origin pose are never touched here. */
  update(info: Guidance) {
    this.info = info;
    if (info.instruction !== this.lastInstruction) {
      this.lastInstruction = info.instruction ?? "";
      this.pages.guide = 0;
    }
    const resultKey = JSON.stringify([info.resultHeadline, info.resultLines]);
    if (resultKey !== this.lastResultKey) {
      this.lastResultKey = resultKey;
      this.pages.result = 0;
    }
    // Rebuild the step hologram only when its geometry really changed —
    // status-only re-renders (autonomous ticks, voice) must not churn GPU objects.
    const holo: HologramView = info.hologram ?? { assembled: [], current: info.placement ? [info.placement] : [] };
    const key = holo.assembled.length || holo.current.length ? JSON.stringify(holo) : "";
    if (key !== this.targetKey) {
      this.targetKey = key;
      if (this.target) {
        this.origin.remove(this.target);
        disposeObject(this.target);
        this.target = null;
      }
      if (this.marker) {
        this.origin.remove(this.marker);
        disposeObject(this.marker);
        this.marker = null;
      }
      if (key) {
        // Child of origin: inherits ONLY the confirmed field pose; never moves the field.
        const group = new THREE.Group();
        group.name = "step-hologram";
        for (const p of holo.assembled) group.add(ghost(p, "assembled"));
        for (const p of holo.current) {
          const g = ghost(p, "current");
          g.traverse((o) => {
            const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
            if (m && "color" in m) o.userData.baseColor = m.color.getHex();
          });
          group.add(g);
        }
        this.target = group;
        this.origin.add(group);
        if (holo.current.length) {
          const markers = new THREE.Group();
          markers.name = "target-markers";
          for (const p of holo.current) markers.add(targetMarker(p));
          this.marker = markers;
          this.origin.add(markers);
        }
      }
    }
    this.buttons = layoutButtons(info.primary ?? DEFAULT_PRIMARY, { autoActive: !!info.autoActive, placing: !this.selected });
    this.applyGuideColors(info);
    this.draw();
  }
  /** Green target / red wrong / yellow partial. Panel+hologram only; never the field pose. */
  private applyGuideColors(info: Guidance) {
    const markerColor = info.markerColor ?? 0x2ee66b;
    this.marker?.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
      if (m && "color" in m) m.color.setHex(markerColor);
    });
    this.target?.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
      if (m && "color" in m && typeof o.userData.baseColor === "number")
        m.color.setHex(info.ghostTint ?? o.userData.baseColor);
    });
  }
  get markerColorHex(): number | null {
    let hex: number | null = null;
    this.marker?.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
      if (hex === null && m && "color" in m) hex = m.color.getHex();
    });
    return hex;
  }
  get currentButtons(): PanelButton[] {
    return this.buttons;
  }
  /** Page `lines` for a view, clamp the stored page, and draw the page indicator. */
  private page<T>(c: CanvasRenderingContext2D, view: PanelView, lines: T[], perPage: number): T[] {
    const pages = paginate(lines, Math.max(2, perPage));
    this.pageCounts[view] = pages.length;
    this.pages[view] = Math.max(0, Math.min(this.pages[view], pages.length - 1));
    if (pages.length > 1) {
      c.fillStyle = "#83e8eb";
      c.font = "bold 18px sans-serif";
      c.fillText(`Text page ${this.pages[view] + 1} of ${pages.length} — More Text ▶ / ◀ Previous Text`, 20, CONTENT_BOTTOM);
    }
    return pages[this.pages[view]] ?? [];
  }
  /** Fixed top window bar: step, live indicator, Rotate Panel handle, Move Panel handle. */
  private drawManipulationBar(c: CanvasRenderingContext2D, info: Guidance) {
    const state = this.manipulation.state;
    const moving = state === "dragging" || state === "hovering_drag_handle";
    c.fillStyle = state === "dragging" ? "#2f9ec7" : state === "hovering_drag_handle" ? "#1d6d8a" : "rgba(20,50,70,.95)";
    c.fillRect(0, 0, PANEL_W, DRAG_BAR_H);
    c.fillStyle = "#7df3ff";
    c.font = "bold 26px sans-serif";
    const stepLabel = info.stepLabel ?? info.text.split("—")[0]?.trim() ?? "";
    c.fillText(stepLabel.slice(0, 20), 20, 42);
    if (this.indicator.label) {
      c.fillStyle = TONE_COLOR[this.indicator.tone];
      c.font = "bold 20px sans-serif";
      c.fillText(this.indicator.label.slice(0, 22), 236, 40);
    }
    const r0 = PANEL_W - ROTATE_FROM_RIGHT;
    const rotating = state === "rotating" || state === "hovering_rotate_handle";
    c.fillStyle = state === "rotating" ? "#2f9ec7" : rotating ? "#1d6d8a" : "rgba(27,74,102,.95)";
    c.fillRect(r0, 6, ROTATE_W, DRAG_BAR_H - 12);
    c.strokeStyle = rotating ? "#ffffff" : "#7df3ff";
    c.lineWidth = rotating ? 4 : 2;
    c.strokeRect(r0, 6, ROTATE_W, DRAG_BAR_H - 12);
    c.fillStyle = "#ffffff";
    c.font = "bold 21px sans-serif";
    c.fillText(state === "rotating" ? "⟲ Rotating…" : "⟲ Rotate Panel", r0 + 14, 40);
    c.fillStyle = moving ? "#ffffff" : "#bffaff";
    c.font = "bold 21px sans-serif";
    c.fillText(state === "dragging" ? "⠿ Moving…" : "⠿ Move Panel", r0 + ROTATE_W + 22, 40);
  }
  /** Initial placement: what to do, the live field rotation and the direct-rotation dial. */
  private drawPlacement(c: CanvasRenderingContext2D) {
    c.fillStyle = GUIDE_TONE.info;
    c.fillRect(20, 74, 984, 56);
    c.fillStyle = "#04121c";
    c.font = "bold 30px sans-serif";
    c.fillText(this.candidateValid ? "PLACE THE ASSEMBLY FIELD" : "LOOK AT YOUR TABLETOP", 34, 112);
    c.fillStyle = "#ffffff";
    c.font = "bold 24px sans-serif";
    wrapText(
      this.candidateValid
        ? "Rotate the field until it matches your baseplate, then select Confirm Assembly Field."
        : "Look at the table until the cyan field preview appears.",
      72,
    ).forEach((line, i) => c.fillText(line, 20, 168 + i * 30));
    c.fillStyle = "#7df3ff";
    c.font = "bold 26px sans-serif";
    const where = this.placementMode === "surface" ? "on detected surface" : this.placementMode === "gaze" ? "placed ahead of your gaze" : "waiting for a surface";
    c.fillText(`Field rotation: ${this.fieldYawDeg.toFixed(1)}°  ·  ${where}`, 20, 258);
    const d = FIELD_DIAL;
    const active = this.grabTarget === "field" && this.manipulation.state === "rotating";
    c.fillStyle = active ? "#2f9ec7" : "rgba(27,74,102,.95)";
    c.fillRect(d.x, d.y, d.w, d.h);
    c.strokeStyle = active ? "#ffffff" : "#7df3ff";
    c.lineWidth = active ? 5 : 3;
    c.strokeRect(d.x, d.y, d.w, d.h);
    c.fillStyle = "#ffffff";
    c.font = "bold 24px sans-serif";
    c.fillText(active ? "⟲  Rotating field…  ⟳" : "⟲  Pinch here and move your hand left / right to rotate the field  ⟳", d.x + 20, d.y + 50);
  }
  /** Main guided view: state, short instruction, message, then the full paginated instruction. */
  private drawGuide(c: CanvasRenderingContext2D, info: Guidance) {
    const toneColor = GUIDE_TONE[info.guideTone ?? "ready"];
    const showRef = !!info.hasReference && this.showReference && !!this.refImage;
    const left = showRef ? 610 : 984;
    c.fillStyle = toneColor;
    c.fillRect(20, 74, left, 56);
    c.fillStyle = "#04121c";
    c.font = "bold 32px sans-serif";
    c.fillText((info.guideLabel ?? "Ready").toUpperCase().slice(0, showRef ? 30 : 52), 34, 113);
    let y = 166;
    c.fillStyle = "#ffffff";
    c.font = "bold 30px sans-serif";
    for (const line of wrapText(info.shortInstruction ?? info.instruction ?? info.text, showRef ? 34 : 56)) {
      c.fillText(line, 20, y);
      y += 36;
    }
    if (info.guideMessage) {
      c.fillStyle = toneColor;
      c.font = "bold 24px sans-serif";
      for (const line of wrapText(info.guideMessage, showRef ? 44 : 72)) {
        c.fillText(line, 20, y);
        y += 30;
      }
    }
    // Full step text + required blocks, paginated with More Text / Previous Text.
    const details = [
      ...(info.instruction ? wrapText(`Instructions: ${info.instruction}`, showRef ? 50 : 82) : []),
      ...(info.blockLabel ? wrapText(`Bricks: ${info.blockLabel}`, showRef ? 50 : 82) : []),
    ];
    y += 10;
    c.fillStyle = "#eafcff";
    const pageLines = this.page(c, "guide", details, Math.floor((CONTENT_BOTTOM - 26 - y) / 28) + 1);
    c.fillStyle = "#eafcff";
    c.font = "22px sans-serif";
    pageLines.forEach((line, i) => c.fillText(line, 20, y + i * 28));
    if (showRef && this.refImage) {
      const box = { x: 646, y: 74, w: 358, h: 300 };
      c.strokeStyle = "#38d9ff";
      c.lineWidth = 3;
      c.strokeRect(box.x, box.y, box.w, box.h);
      const fit = fitRect(this.refImage.width, this.refImage.height, box.w - 8, box.h - 36);
      try {
        c.drawImage(this.refImage as unknown as CanvasImageSource, box.x + 4 + fit.x, box.y + 4 + fit.y, fit.w, fit.h);
      } catch {
        /* reference unavailable: the instruction text stays */
      }
      c.fillStyle = "#83e8eb";
      c.font = "bold 18px sans-serif";
      c.fillText("EXPECTED RESULT", box.x + 10, box.y + box.h - 10);
    }
  }
  /** Meta result: status banner + grouped, paginated result text on the left; the inspected image (or reference) on the right. */
  private drawResultView(c: CanvasRenderingContext2D, info: Guidance, hasRef: boolean) {
    const side = !!this.captureResult || hasRef;
    const L = resultLayout(side);
    const tone = RESULT_TONE[info.resultTone ?? ""] ?? RESULT_TONE.error;
    // 1) Status banner (tone fill, dark text: the same pattern as the guided state bar).
    const head = wrapText(info.resultHeadline ?? "", L.headlineChars);
    const bannerH = Math.max(L.banner.h, 20 + head.length * 32);
    c.fillStyle = tone;
    c.fillRect(L.banner.x, L.banner.y, L.banner.w, bannerH);
    c.fillStyle = "#04121c";
    c.font = "bold 28px sans-serif";
    head.forEach((line, i) => c.fillText(line, L.banner.x + 14, L.banner.y + 38 + i * 32));
    // 2) Result text: labelled lines (Problem / Expected / Observed / Fix …) with the label highlighted.
    const y = L.banner.y + bannerH + 34;
    const rows = resultRows(info.resultLines ?? [], L.lineChars);
    const pageRows = this.page(c, "result", rows, Math.floor((CONTENT_BOTTOM - 26 - y) / 28) + 1);
    pageRows.forEach((row, i) => {
      let x = L.text.x;
      if (row.label) {
        c.font = "bold 22px sans-serif";
        c.fillStyle = "#83e8eb";
        const label = `${row.label}:`;
        c.fillText(label, x, y + i * 28);
        x += c.measureText(`${label} `).width;
      }
      c.font = "22px sans-serif";
      c.fillStyle = "#eafcff";
      c.fillText(row.text, x, y + i * 28);
    });
    // 3) Inspected image (aspect preserved, never stretched) or the expected reference.
    const box = L.image;
    if (this.captureResult) {
      this.drawCapture(c, this.captureResult, box);
    } else if (hasRef) {
      c.strokeStyle = "#38d9ff";
      c.lineWidth = 3;
      c.strokeRect(box.x, box.y, box.w, box.h);
      if (this.showReference && this.refImage) {
        const fit = fitRect(this.refImage.width, this.refImage.height, box.w - 8, box.h - 8);
        try {
          c.drawImage(this.refImage as unknown as CanvasImageSource, box.x + 4 + fit.x, box.y + 4 + fit.y, fit.w, fit.h);
        } catch {
          c.fillStyle = "#ffd166";
          c.font = "21px sans-serif";
          c.fillText("Reference failed to load", box.x + 14, box.y + 60);
        }
      }
      c.fillStyle = "rgba(4,16,26,.82)";
      c.fillRect(box.x + 4, box.y + box.h - 34, box.w - 8, 30);
      c.fillStyle = "#83e8eb";
      c.font = "bold 18px sans-serif";
      c.fillText("Expected result", box.x + 12, box.y + box.h - 12);
    }
  }
  /** Exact inspection capture, its status and the live autonomous line (paginated column). */
  private drawCameraView(c: CanvasRenderingContext2D, info: Guidance) {
    const view = this.captureCurrent;
    if (!view) {
      c.fillStyle = "#eafcff";
      c.font = "25px sans-serif";
      [
        "No inspection frame captured for this step yet.",
        "This view shows ONLY the exact camera image selected",
        "for a Meta inspection (autonomous or Check Step) —",
        "never live video and never the reference photo.",
        ...(info.autoLabel ? wrapText(info.autoLabel, 70) : []),
      ].forEach((line, i) => c.fillText(line, 20, 112 + i * 34));
      this.pageCounts.camera = 1;
      return;
    }
    this.drawCapture(c, view, { x: 12, y: 74, w: 620, h: 394 });
    c.fillStyle = view.isNew ? "#ffffff" : "#83e8eb";
    c.font = "bold 18px sans-serif";
    c.fillText(view.isNew ? "● NEW FRAME CAPTURED" : view.title.slice(0, 34), 646, 98);
    c.fillStyle = TONE_COLOR[view.tone];
    c.font = "bold 22px sans-serif";
    const status = wrapText(view.status, 28);
    status.forEach((line, i) => c.fillText(line, 646, 128 + i * 28));
    const top = 128 + status.length * 28 + 10;
    const lines = [...view.lines, ...(info.autoLabel ? [info.autoLabel] : [])].flatMap((line) => wrapText(line, 32));
    // Page indicator shares the bottom line; keep the column clear of it.
    const pageLines = this.page(c, "camera", lines, Math.floor((CONTENT_BOTTOM - 26 - top) / 24) + 1);
    c.fillStyle = "#eafcff";
    c.font = "19px sans-serif";
    pageLines.forEach((line, i) => c.fillText(line, 646, top + i * 24));
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
  /**
   * Inspection-capture views. `current` = latest capture (Camera view),
   * `result` = capture that produced the displayed result (thumbnail in the
   * Result view). Bitmaps of ids no longer referenced are closed here.
   * Panel-only: never touches the origin, anchor or assembly field.
   */
  setCaptures(current: CaptureView | null, result: CaptureView | null, indicator: { label: string; tone: IndicatorTone }) {
    this.captureCurrent = current;
    this.captureResult = result;
    this.indicator = indicator;
    for (const [id, image] of Array.from(this.captureImages)) {
      if (id !== current?.id && id !== result?.id) {
        try { image.close?.(); } catch { /* already closed */ }
        this.captureImages.delete(id);
      }
    }
    this.draw();
  }
  /** Attach a decoded image; returns false (caller must close it) when the id is stale. */
  setCaptureBitmap(id: number, decoded: { width: number; height: number; close?: () => void }): boolean {
    const image = decoded as unknown as RefImage;
    if (this.ended || (id !== this.captureCurrent?.id && id !== this.captureResult?.id)) return false;
    const old = this.captureImages.get(id);
    if (old && old !== image) {
      try { old.close?.(); } catch { /* already closed */ }
    }
    this.captureImages.set(id, image);
    this.draw();
    return true;
  }
  get captureImageCount() {
    return this.captureImages.size;
  }
  private drawCapture(c: CanvasRenderingContext2D, view: CaptureView, box: { x: number; y: number; w: number; h: number }) {
    const image = this.captureImages.get(view.id);
    c.strokeStyle = view.tone === "error" ? "#ff6b6b" : view.isNew ? "#ffffff" : "#38d9ff";
    c.lineWidth = view.isNew ? 5 : 3;
    c.strokeRect(box.x, box.y, box.w, box.h);
    if (image) {
      // Aspect-preserving, unmirrored: positive width/height, no transforms.
      const fit = fitRect(image.width, image.height, box.w - 8, box.h - 8);
      try {
        c.drawImage(image as unknown as CanvasImageSource, box.x + 4 + fit.x, box.y + 4 + fit.y, fit.w, fit.h);
      } catch {
        c.fillStyle = "#ffd166";
        c.font = "21px sans-serif";
        c.fillText("Captured image could not be drawn", box.x + 14, box.y + 60);
      }
    } else {
      c.fillStyle = "#ffd166";
      c.font = "21px sans-serif";
      c.fillText("Decoding the captured image…", box.x + 14, box.y + 60);
    }
    if (view.tone === "error" && !view.sent) {
      c.fillStyle = "rgba(139,30,45,.85)";
      c.fillRect(box.x + 4, box.y + box.h - 40, box.w - 8, 36);
      c.fillStyle = "#ffffff";
      c.font = "bold 20px sans-serif";
      c.fillText("NOT SENT TO META", box.x + 14, box.y + box.h - 15);
    }
  }
  setViewMode(mode: PanelView) {
    if (this.viewMode !== mode) this.pages[mode] = 0;
    this.viewMode = mode;
    this.draw();
  }
  get panelViewMode() {
    return this.viewMode;
  }
  /** Next/previous text page of the visible view (clamped, never wraps). */
  turnPage(delta: 1 | -1) {
    const view: PanelView = this.viewMode === "result" && !this.info.resultHeadline ? "guide" : this.viewMode;
    this.pages[view] = Math.max(0, Math.min(this.pageCounts[view] - 1, this.pages[view] + delta));
    this.draw();
  }
  get textPage() {
    const view: PanelView = this.viewMode === "result" && !this.info.resultHeadline ? "guide" : this.viewMode;
    return { page: this.pages[view], count: this.pageCounts[view] };
  }
  /** Turn (yaw, about world up) and tilt (pitch, panel-local) about the panel centre. Panel only. */
  rotatePanelBy(yawRad: number, pitchRad: number) {
    const e = new THREE.Euler().setFromQuaternion(this.panelQuat, "YXZ");
    const pitch = THREE.MathUtils.clamp(e.x + pitchRad, -PANEL_MAX_TILT, PANEL_MAX_TILT);
    this.panelQuat.setFromEuler(new THREE.Euler(pitch, e.y + yawRad, 0, "YXZ"));
    this.applyPanelTransform();
    this.draw();
  }
  get panelPose() {
    const e = new THREE.Euler().setFromQuaternion(this.panelQuat, "YXZ");
    return { position: this.panelPos.toArray() as [number, number, number], yaw: e.y, pitch: e.x, scale: this.panelScale };
  }
  /** Rebuild the button layout (placement vs guided) without touching any transform. */
  private relayout() {
    this.buttons = layoutButtons(this.info.primary ?? DEFAULT_PRIMARY, { autoActive: !!this.info.autoActive, placing: !this.selected });
    this.draw();
  }
  /**
   * Rotate the WHOLE assembly field about the vertical axis while it is being
   * placed. Blocks are children of the field, so their relative transforms are
   * untouched; stored placements, steps and the panel never change. Locked
   * once confirmed (use Re-anchor to adjust again).
   */
  rotateField(deltaRad: number): boolean {
    if (this.selected) {
      this.message = "The field is confirmed. Use Re-anchor to adjust its position or rotation.";
      this.draw();
      return false;
    }
    let yaw = this.yaw + deltaRad;
    while (yaw > Math.PI) yaw -= 2 * Math.PI;
    while (yaw <= -Math.PI) yaw += 2 * Math.PI;
    this.yaw = yaw;
    this.draw();
    return true;
  }
  resetFieldRotation(): boolean {
    return this.rotateField(this.defaultYaw - this.yaw);
  }
  get fieldYawDeg() {
    return Math.round(((this.yaw * 180) / Math.PI) * 10) / 10 || 0; // never "-0.0°"
  }
  get fieldPlacing() {
    return !this.selected;
  }
  /** "Reset Panel Position": upright, facing the user, in front of the head. Panel only. */
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
    this.drawManipulationBar(c, info);
    const hasRef = !!info.hasReference;
    if (this.viewMode === "camera") this.drawCameraView(c, info);
    else if (this.viewMode === "result" && info.resultHeadline) this.drawResultView(c, info, hasRef);
    else if (this.helpVisible) {
      c.font = "24px sans-serif";
      c.fillStyle = "#bffaff";
      [
        "Use the large buttons: point with your hand ray and air tap.",
        "Check Step · Check Again · Confirm Position · Next Step",
        "More Text / Previous Text page through long text.",
        "Move Panel: pinch the top bar and drag; push or pull your hand",
        "to move it farther or closer. Rotate Panel: pinch the rotate",
        "handle and move left/right (turn) or up/down (tilt).",
        "Reset Panel Position brings it back in front of you.",
        "Start Voice (local Whisper): say Next Step, Check Step, More Text,",
        "Show Result, Stop Autonomous, Confirm Assembly Field, Exit AR …",
        "Camera shows the exact image sent to Meta.",
      ].forEach((line, i) => c.fillText(line, 20, 112 + i * 36));
    } else if (!this.selected) this.drawPlacement(c);
    else this.drawGuide(c, info);
    if (info.voiceLine) {
      const tone = info.voiceTone ?? "idle";
      c.fillStyle = TONE_COLOR[tone === "error" || tone === "warn" || tone === "ok" || tone === "info" ? tone : "idle"];
      c.font = "bold 18px sans-serif";
      c.fillText(`🎤 ${info.voiceLine}`.slice(0, 104), 20, VOICE_LINE_Y);
    }
    // Buttons (hover = exact button under the hand-ray cursor)
    for (const b of this.buttons) {
      const isRef = b.id === "reference";
      const hovered = this.hoveredButton?.id === b.id;
      const pressed = this.pressedButton === b.id;
      // Hierarchy: main action = solid fill; second contextual action = outlined;
      // the fixed rows (navigation, panel, voice) are quieter so the main action stands out.
      const primaryFill = b.main ? (b.id === "next" ? "#1d7a3e" : b.id === "confirm" ? "#7a5a12" : "#1f6fa8") : b.id === "confirm" ? "#3a2f0e" : "#123a52";
      const pageView: PanelView = this.viewMode === "result" && !info.resultHeadline ? "guide" : this.viewMode;
      const inert =
        (b.id === "page-prev" && this.pages[pageView] <= 0) ||
        (b.id === "page" && this.pages[pageView] >= this.pageCounts[pageView] - 1);
      c.globalAlpha = inert && !hovered ? 0.45 : 1;
      c.fillStyle = pressed ? "#ffffff" : hovered ? "#2f9ec7" : b.danger ? "#5a1a26" : b.id === "auto-stop" ? "#6d2633" : b.primary ? primaryFill : isRef && !this.showReference ? "#33505f" : "#10344a";
      c.fillRect(b.x, b.y, b.w, b.h);
      c.strokeStyle = pressed || hovered ? "#ffffff"
        : b.primary ? (b.main ? "#bff6ff" : b.id === "confirm" ? "#ffd23f" : "#7df3ff")
        : b.danger ? "#d0707f" : "#3f8fab";
      c.lineWidth = hovered || pressed ? 6 : b.main ? 4 : b.primary ? 3 : 2;
      c.strokeRect(b.x, b.y, b.w, b.h);
      c.fillStyle = pressed ? "#04202f" : b.primary ? (b.id === "confirm" && !b.main ? "#ffe9a6" : "#ffffff") : "#d6f3fb";
      const rawLabel =
        b.id === "auto"
          ? (info.autoButton ?? b.label)
          : b.id === "voice"
          ? (info.voiceButton ?? b.label)
          : b.id === "camera"
          ? this.viewMode === "camera"
            ? "Show Instructions"
            : "Camera"
          : b.id === "result"
          ? this.viewMode === "result"
            ? "Show Instructions"
            : "Show Result"
          : isRef
            ? this.showReference
              ? "Hide ref."
              : "Show ref."
            : b.label;
      const label = this.hoveredButton?.id === b.id ? rawLabel.toUpperCase() : rawLabel;
      // Largest font that fits the button (labels are never cut).
      let size = b.main ? 38 : b.primary ? 32 : 22;
      c.font = `bold ${size}px sans-serif`;
      let w = c.measureText(label).width;
      while (w > b.w - 14 && size > 15) {
        size -= 1;
        c.font = `bold ${size}px sans-serif`;
        w = c.measureText(label).width;
      }
      c.fillText(label, b.x + Math.max(6, (b.w - w) / 2), b.y + b.h / 2 + size * 0.35);
      c.globalAlpha = 1;
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
    const manipState = this.manipulation.state;
    const resizing = manipState === "resizing" || manipState === "hovering_resize_handle";
    c.fillStyle = resizing ? "#2f9ec7" : "rgba(27,74,102,.9)";
    c.fillRect(PANEL_W - 64, PANEL_H - 64, 64, 64);
    c.strokeStyle = resizing ? "#ffffff" : "#7df3ff";
    c.lineWidth = resizing ? 5 : 3;
    c.strokeRect(PANEL_W - 64, PANEL_H - 64, 64, 64);
    c.fillStyle = "#ffffff";
    c.font = "bold 26px sans-serif";
    c.fillText("◢", PANEL_W - 44, PANEL_H - 20);
    this.texture.needsUpdate = true;
    const status = this.message;
    if (this.lastStatus !== status) {
      this.lastStatus = status;
      this.status(status);
    }
  }
  /**
   * HoloLens Edge reports "visible-blurred" whenever the 2D Edge slate, a
   * camera/microphone permission prompt or system UI takes focus. That is
   * an INPUT-focus change, not tracking loss: rendering continues and the
   * anchored field must stay exactly where it is. "hidden" pauses frames;
   * the anchor is kept and resumes when frames return.
   */
  private onVisibility = () => {
    const next = this.session.visibilityState ?? "visible";
    if (next === this.visibility) return;
    const previous = this.visibility;
    this.visibility = next;
    this.anchorTracker.lastEvent = `XR visibility ${previous} → ${next}`;
    if (next !== "visible") {
      this.message =
        next === "visible-blurred"
          ? "AR input paused while another window or prompt has focus. The assembly field stays anchored."
          : "AR hidden by the system. The anchor is kept and resumes when AR is visible again.";
    } else if (previous !== "visible") {
      this.message = this.selected
        ? "AR focus restored. The assembly field kept its tabletop position."
        : "AR focus restored. Position the preview on your tabletop and tap the panel to confirm.";
    }
    this.draw();
  };
  private onReset = () => {
    if (this.selected) {
      this.anchorTracker.onReferenceReset(!!this.anchor);
      this.message = this.anchor
        ? "Reference space reset — re-locating the native anchor; the field is held meanwhile."
        : "TABLETOP TRACKING UNAVAILABLE — reference space reset and this field has no native anchor. It is shown red at its old pose; Re-anchor it.";
      this.draw();
      return;
    }
    this.reset();
  };
  /** Explicit re-anchor (panel/voice/2D button). The ONLY path that discards a placement. */
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
    this.hitMisses = 0;
    this.placementMode = "none";
    // The floating panel is independent of the tabletop field: re-anchoring never moves it.
    this.origin.visible = false;
    this.reticle.visible = false;
    this.fieldRendered = false;
    this.message =
      "Re-anchor: look at your tabletop until the preview appears, then tap the panel above the buttons to confirm.";
    this.draw();
    this.relayout(); // placement controls (position + rotation) are available again
  }
  /** Measured, not inferred: what the last rendered XR frame actually contained. */
  get fieldDiagnostics(): FieldDiagnostics {
    if (this.ended) return { ...EMPTY_FIELD_DIAGNOSTICS, lastEvent: this.anchorTracker.lastEvent };
    const pose = this.origin.matrix.elements;
    return {
      lifecycle: this.anchorTracker.state,
      nativeAnchor: !!this.anchor,
      anchorConfirmed: this.selected,
      fieldMeshExists: !!this.fieldGroup && this.origin.children.includes(this.fieldGroup),
      fieldRendered: this.fieldRendered,
      transformValid: validPose(pose),
      xrSessionActive: !this.ended,
      visibilityState: this.visibility,
      viewerTracked: this.tracking,
      reanchorPending: !this.selected,
      stepContentAvailable: !!this.target,
      placementMode: this.selected ? this.placementMode : this.candidateValid ? this.placementMode : "none",
      distanceM: this.viewGeometry?.distanceM ?? null,
      angleDeg: this.viewGeometry?.angleDeg ?? null,
      inView: this.selected ? fieldInView(this.viewGeometry) : null,
      framesRendered: this.framesRendered,
      lastEvent: this.anchorTracker.lastEvent,
    };
  }
  /** Approximate head-gaze gate for autonomous inspection (null = unknown). */
  get fieldInView(): boolean | null {
    return this.selected && this.anchorTracker.isAnchored ? fieldInView(this.viewGeometry) : null;
  }
  /**
   * Confirm the field at the current preview (position + chosen yaw). If the
   * surface preview flickers out at that instant, the confirmation stays
   * pending and is applied on the next frame with a valid preview.
   */
  confirmOrigin() {
    if (this.selected) return;
    this.confirming = true;
    if (!this.candidateValid) {
      this.message = "Confirming — look at the table until the field preview appears.";
      this.draw();
    }
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
    return { origin, direction, hit, point, button: panelButtonAt(point.x, point.y, this.buttons) };
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

  /** World-space hand ray of an input source this frame (null when not tracked). */
  private ray(source: XRInputSource, xrFrame: XRFrame): { origin: THREE.Vector3; dir: THREE.Vector3 } | null {
    if (!this.reference || typeof xrFrame.getPose !== "function") return null;
    const pose = xrFrame.getPose(source.targetRaySpace, this.reference);
    if (!pose) return null;
    const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
    return {
      origin: new THREE.Vector3().setFromMatrixPosition(m),
      dir: new THREE.Vector3(0, 0, -1).transformDirection(m).normalize(),
    };
  }

  /**
   * HoloLens-style far manipulation. Move: the grabbed point stays on the
   * hand ray; pushing/pulling the hand along the ray moves the panel
   * farther/closer (gain PANEL_PUSH_GAIN). Rotate: horizontal ray motion turns
   * (yaw), vertical motion tilts (pitch, clamped). Only the panel transform
   * changes — never the field, anchor, hologram, step or any action.
   */
  private applyManipulation(source: XRInputSource, xrFrame: XRFrame) {
    if (!this.manipulation.active || this.manipSource !== source) return;
    const ray = this.ray(source, xrFrame);
    if (!ray) {
      // Tracking lost mid-gesture: end at the last applied transform.
      this.manipulation.cancel();
      this.manipSource = null;
      this.grab = null;
      this.interaction.manipulation = "idle (tracking lost — panel kept its position)";
      this.interaction.lastFailure = "Manipulation cancelled: hand tracking lost; panel kept its last position";
      this.draw();
      return;
    }
    const g = this.grab;
    if (this.manipulation.state === "dragging" && g) {
      const push = ray.origin.clone().sub(g.origin).dot(g.dir);
      const distance = THREE.MathUtils.clamp(g.distance + PANEL_PUSH_GAIN * push, PANEL_MIN_DIST, PANEL_MAX_DIST);
      const point = ray.origin.clone().addScaledVector(ray.dir, distance);
      this.manipulation.move([point.x, point.y, point.z]);
      this.panelPos.copy(point).add(g.offset);
    } else if (this.manipulation.state === "rotating" && g) {
      const az = Math.atan2(-ray.dir.x, -ray.dir.z), el = Math.asin(THREE.MathUtils.clamp(ray.dir.y, -1, 1));
      let dAz = az - g.azimuth;
      if (dAz > Math.PI) dAz -= 2 * Math.PI;
      if (dAz < -Math.PI) dAz += 2 * Math.PI;
      const dEl = el - g.elevation;
      if (this.grabTarget === "field") {
        // Field dial: horizontal hand motion turns the whole field (fine gain); panel untouched.
        this.manipulation.rotate(Math.abs(dAz));
        this.yaw = g.fieldYaw;
        this.rotateField(dAz * FIELD_DIAL_GAIN);
        this.interaction.manipulation = "rotating field";
        return;
      }
      this.manipulation.rotate(Math.max(Math.abs(dAz), Math.abs(dEl)));
      const pitch = THREE.MathUtils.clamp(g.pitch + dEl * PANEL_ROTATE_GAIN, -PANEL_MAX_TILT, PANEL_MAX_TILT);
      this.panelQuat.setFromEuler(new THREE.Euler(pitch, g.yaw + dAz * PANEL_ROTATE_GAIN, 0, "YXZ"));
    } else if (this.manipulation.state === "resizing" && this.resizeStart) {
      const hit = this.panelPlaneHit(source, xrFrame);
      if (hit) {
        this.manipulation.move([hit.x, hit.y, hit.z]);
        const distance = Math.max(0.05, hit.distanceTo(this.panelPos));
        this.panelScale = clampPanelScale(this.resizeStart.scale * (distance / this.resizeStart.distance));
      }
    }
    this.applyPanelTransform();
    this.interaction.manipulation = this.manipulation.state;
  }

  private onSelectStart = (event: XRInputSourceEvent) => {
    if (this.manipulation.active) return;
    const source = event.inputSource as XRInputSource;
    const result = this.raycastPanel(source, event.frame as XRFrame);
    if (!result?.hit || !result.point) return;
    const dial = !this.selected && inRect(result.point, FIELD_DIAL);
    const region = dial ? "rotate" : panelRegionAt(result.point.x, result.point.y, PANEL_W, PANEL_H);
    if (!region || region === "panel") return;
    this.grabTarget = dial ? "field" : "panel";
    const hit = region === "resize" ? this.panelPlaneHit(source, event.frame as XRFrame) : result.hit.point.clone();
    if (!hit) return;
    if (!this.manipulation.grab(region, [hit.x, hit.y, hit.z])) return;
    this.manipSource = source;
    if (region === "resize") {
      this.resizeStart = { distance: Math.max(0.05, hit.distanceTo(this.panelPos)), scale: this.panelScale };
    } else {
      const e = new THREE.Euler().setFromQuaternion(this.panelQuat, "YXZ");
      this.grab = {
        origin: result.origin.clone(),
        dir: result.direction.clone(),
        distance: hit.distanceTo(result.origin),
        offset: this.panelPos.clone().sub(hit),
        azimuth: Math.atan2(-result.direction.x, -result.direction.z),
        elevation: Math.asin(THREE.MathUtils.clamp(result.direction.y, -1, 1)),
        yaw: e.y,
        pitch: e.x,
        fieldYaw: this.yaw,
      };
    }
    this.interaction.manipulation = this.manipulation.state;
    this.interaction.lastFailure = null;
    this.draw();
  };

  private onSelectEnd = () => {
    if (!this.manipulation.active) return;
    this.manipulation.release();
    this.manipSource = null;
    this.resizeStart = null;
    this.grab = null;
    this.grabTarget = "panel";
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
    const hoverButton = hoverId ? this.buttons.find((b) => b.id === hoverId) ?? null : null;
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
      } else if (button.id === "camera") {
        this.viewMode = this.viewMode === "camera" ? "guide" : "camera";
        this.draw();
      } else if (button.id === "result") {
        this.viewMode = this.viewMode === "result" ? "guide" : "result";
        this.pages.result = 0;
        this.draw();
      } else if (button.id === "page" || button.id === "page-prev") {
        this.turnPage(button.id === "page" ? 1 : -1);
      } else if (button.id === "rotate-left" || button.id === "rotate-right") {
        this.rotatePanelBy(button.id === "rotate-left" ? PANEL_ROTATE_STEP : -PANEL_ROTATE_STEP, 0);
      } else if (button.id === "confirm-field") {
        this.confirmOrigin();
      } else if (button.id === "field-rotate-reset") {
        this.resetFieldRotation();
      } else if (button.id.startsWith("field-")) {
        this.rotateField(FIELD_STEPS[button.id] ?? 0);
      } else if (button.id === "help") {
        this.helpVisible = !this.helpVisible;
        this.draw();
      }
      this.action(button.id);
      return;
    }
    // Non-button panel tap above the button rows: confirm origin when pending.
    // The manipulation bar never confirms the origin (grabbing it must not place the field).
    const onDial = !this.selected && inRect(result.point, FIELD_DIAL);
    if (!onDial && y >= DRAG_BAR_H && y < PANEL_BUTTONS_TOP && this.candidateValid && !this.selected) {
      this.confirming = true;
      this.interaction.lastAction = "confirm-origin";
      return;
    }
    this.interaction.lastFailure = "Select on the panel but outside any button — nothing activated";
  };
  /** Frames without a usable surface hit before the gaze-placed preview is shown instead. */
  static readonly HIT_FALLBACK_FRAMES = 90;
  private gazeCandidate(head: THREE.Matrix4) {
    const position = new THREE.Vector3(0, 0, -this.distance).applyMatrix4(head);
    position.y += this.height;
    this.candidate.makeTranslation(position.x, position.y, position.z);
    this.candidateValid = true;
    this.placementMode = "gaze";
  }
  private frame = (_time: number, frame?: XRFrame) => {
    if (!frame || !this.reference || this.ended) return;
    const pose = frame.getViewerPose(this.reference);
    if (!pose) {
      // Head tracking temporarily unavailable. Never discard the placement:
      // keep the origin/anchor exactly as they are and resume next frame.
      this.tracking = false;
      if (++this.viewerLostFrames === 1) {
        this.anchorTracker.lastEvent = "viewer pose unavailable";
        this.message = this.selected
          ? "Head tracking temporarily unavailable — the assembly field is kept and will resume."
          : "Head tracking temporarily unavailable — look around slowly to recover.";
        this.draw();
      }
      this.fieldRendered = false;
      this.renderer.render(this.scene, this.camera);
      return;
    }
    if (this.viewerLostFrames > 0) {
      this.viewerLostFrames = 0;
      this.anchorTracker.lastEvent = "viewer pose recovered";
    }
    this.tracking = true;
    const head = new THREE.Matrix4().fromArray(pose.transform.matrix);
    if (!this.panelPlaced) {
      // Upright window facing the user (head yaw only — no head pitch/roll baked in).
      const forward = new THREE.Vector3(0, 0, -1).transformDirection(head);
      const yaw = Math.atan2(-forward.x, -forward.z);
      this.panelQuat.setFromEuler(new THREE.Euler(0, yaw, 0, "YXZ"));
      this.panelPos.setFromMatrixPosition(head).add(new THREE.Vector3(0, -0.05, -0.85).applyQuaternion(this.panelQuat));
      this.applyPanelTransform();
      this.panelPlaced = true;
    }
    // Hand rays only while the session has input focus (blurred = no input).
    if (this.visibility === "visible") this.updateInputRays(frame);
    if (this.selected && this.anchor) {
      const tracked = frame.getPose(this.anchor.anchorSpace, this.reference);
      const before = this.anchorTracker.state;
      const held = this.anchorTracker.onPose(tracked ? tracked.transform.matrix : null);
      if (held.pose) this.fixed.fromArray(held.pose);
      if (held.state !== before) {
        this.message =
          held.state === "tracking_lost"
            ? "TRACKING LOST — the field is shown red at its last pose and is not trustworthy. It recovers automatically if the anchor is found again; otherwise Re-anchor."
            : held.state === "tracking_degraded"
              ? "Tracking degraded — holding the assembly field at its last confirmed pose."
              : "Anchor tracking recovered — the assembly field is back on the tabletop.";
        this.draw();
      }
    }
    if (!this.selected) {
      this.candidateValid = false;
      const hit =
        this.hit &&
        frame.getHitTestResults(this.hit)[0]?.getPose(this.reference);
      let surface = false;
      if (hit) {
        const matrix = new THREE.Matrix4().fromArray(hit.transform.matrix),
          position = new THREE.Vector3().setFromMatrixPosition(matrix);
        const viewer = new THREE.Vector3().setFromMatrixPosition(head);
        if (
          new THREE.Vector3(0, 1, 0).transformDirection(matrix).y > 0.9 &&
          position.y < viewer.y - 0.1 &&
          position.distanceTo(viewer) < 2
        ) {
          // Position only: the field orientation is the user's choice (yaw), never
          // the hit-test frame (which turns as you look around).
          this.candidate.makeTranslation(position.x, position.y, position.z);
          this.candidateValid = true;
          this.placementMode = "surface";
          surface = true;
        }
      }
      if (surface) {
        this.hitMisses = 0;
      } else if (!this.hit) {
        this.gazeCandidate(head);
      } else if (++this.hitMisses > SpatialSession.HIT_FALLBACK_FRAMES) {
        // Surface detection is available but finds nothing: never leave the
        // user without a visible preview (the Re-anchor dead end).
        if (this.hitMisses === SpatialSession.HIT_FALLBACK_FRAMES + 1) {
          this.message =
            "No tabletop surface detected yet — the preview is placed ahead of your gaze. Look at the table to snap it, or tap the panel to confirm here.";
          this.draw();
        }
        this.gazeCandidate(head);
      }
      this.anchorTracker.preview(this.candidateValid);
      if (this.candidateValid && !this.fieldYawInit) {
        // First preview of the session: field front (+Z) faces the user.
        const fwd = new THREE.Vector3(0, 0, -1).transformDirection(head);
        this.yaw = this.defaultYaw = Math.atan2(-fwd.x, -fwd.z);
        this.fieldYawInit = true;
      }
      if (this.confirming && this.candidateValid) {
        this.confirming = false;
        this.selected = true;
        this.fixed.copy(this.candidate);
        this.relayout(); // placement controls give way to the guided flow; yaw is kept
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
            this.anchorTracker.confirm(this.fixed.elements, true);
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
    // The field is visible whenever a placement or a preview exists —
    // independent of step content (the ghost may legitimately be absent).
    const poseOk = validPose(this.origin.matrix.elements);
    this.origin.visible = poseOk && (this.selected || this.candidateValid);
    if (this.fieldGroup) this.fieldGroup.visible = true;
    const state = this.anchorTracker.state;
    this.tintField(
      !this.selected ? 0x38d9ff
        : state === "tracking_lost" ? 0xff4d4d
          : state === "tracking_degraded" ? 0xffa64d
            : 0xd8e4ea, // neutral: yellow/red/green are reserved for the step result
    );
    if (this.target) this.target.visible = this.selected ? state !== "tracking_lost" : true;
    this.reticle.visible = !this.selected && this.candidateValid && this.placementMode === "surface";
    this.reticle.matrixAutoUpdate = false;
    this.reticle.matrix.copy(this.candidate);
    this.viewGeometry = this.selected
      ? fieldViewGeometry(head.elements, this.origin.matrix.elements)
      : null;
    this.renderer.render(this.scene, this.camera);
    this.framesRendered++;
    this.fieldRendered = this.origin.visible && !!this.fieldGroup?.visible;
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
    for (const image of this.captureImages.values()) {
      try { image.close?.(); } catch { /* already closed */ }
    }
    this.captureImages.clear();
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
