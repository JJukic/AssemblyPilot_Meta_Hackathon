"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { registry } from "@/lib/registry";
import { errorMessage, mediaUrl } from "@/lib/api";
import {
  capabilities,
  getAssemblyRun,
  getScene,
  getView,
  setView,
  startAssemblyRun,
  type Placement,
  type ViewedStep,
} from "@/lib/ar/data";
import { EMPTY_HOLOGRAM, proxyBlock, splitScene, type HologramView } from "@/lib/ar/hologram";
import { HologramPreview } from "@/components/ar/HologramPreview";
import { selectedStepReference, trustedReferencePath } from "@/lib/ar/reference";
import {
  GERMAN_ALIASES,
  VOICE_COMMANDS,
  VoiceController,
  detectSpeechSupport,
  probeMicrophone,
  type CommandDiagnostic,
  type ExecutionOutcome,
  type RecognitionLike,
  type VoiceAction,
  type VoiceSnapshot,
} from "@/lib/ar/voice";
import {
  LocalVoiceController,
  backendVoiceApi,
  type CaptureDiagnostic,
} from "@/lib/ar/voiceLocal";
import {
  readLastInspection,
  saveVoiceVerifyIntent,
} from "@/lib/ar/voiceVerify";
import {
  loadInspectionSummary,
  resultHeadline,
  resultLines,
  type InspectionSummary,
} from "@/lib/ar/inspectionResult";
import { getProgress, inspectSnapshot, verifySnapshot } from "@/lib/inspection";
import { isWorkflowInspection } from "@/lib/workflow";
import type { WorkflowInspection } from "@/types/workflow";
import { AutonomousMachine } from "@/lib/ar/autonomous";
import { AutonomousRunner } from "@/lib/ar/autoRunner";
import type { CameraSource } from "@/lib/ar/monitoring";
import {
  AutoController, classifyFailure, failureHeadline,
  type AutoStatus, type InspectOutcome, type SelectedFrame,
} from "@/lib/ar/autoController";
import type { FailureKind } from "@/lib/ar/autonomous";
import { EMPTY_FIELD_DIAGNOSTICS, describeField, type FieldDiagnostics } from "@/lib/ar/field";
import { MonitorCamera, listVideoDevices } from "@/lib/ar/autonomousMonitor";
import {
  clearInspectionSummary,
  inspectingSummary,
  saveInspectionSummary,
  summarizeInspection,
  summarizeVerification,
  errorSummary as autoErrorSummary,
} from "@/lib/ar/inspectionResult";
import { clearLastInspection, clearVoiceVerifyIntent, saveLastInspection } from "@/lib/ar/voiceVerify";
import {
  claimExternalRequest, latestExternalResult, newPairingCode, pendingExternalRequests,
  postExternalResult, requestExternalCapture, validPairingCode, ExternalRequestTracker,
} from "@/lib/ar/cameraBridge";
import {
  InspectionTrace, encodedByteSize, snapshotFingerprint,
  type InspectionDiagnostics,
} from "@/lib/ar/inspectionTrace";
import { classifyUncertain, type FrameQuality } from "@/lib/ar/monitoring";
import { InspectionCoordinator, UploadRun } from "@/lib/ar/coordinator";
import { isRevisionConflict, moveCursor } from "@/lib/ar/cursor";
import type { TraceSummary } from "@/lib/ar/inspectionResult";
import type { ProjectDetail } from "@/types/projects";
import type { SpatialSession, Action, Guidance, PanelView } from "@/lib/ar/runtime";
import { CapturePreviewStore, captureView, indicatorFor, type CaptureRecord } from "@/lib/ar/capturePreview";
import { snapshotFile } from "@/lib/camera-image";
import { deriveGuide, shortInstruction, type GuideView } from "@/lib/ar/guidedFlow";
import { voicePanel, voiceToggle } from "@/lib/ar/voicePanel";
import type { Snapshot } from "@/types/assembly";

type SpeechCtor = new () => RecognitionLike;
const CHECKING_SPEECH = {
  supported: false,
  apiName: null,
  secureContext: false,
  mayUseCloudService: false,
  reason: "Checking speech support…",
} as const;
let speechCache: ReturnType<typeof detectSpeechSupport> | null = null;
/** How long "New assembly started · Step 1 of N · No steps verified" stays before the normal guidance. */
const NEW_RUN_NOTICE_MS = 6000;
function detectSpeechSupportCached() {
  if (!speechCache)
    speechCache = detectSpeechSupport(window as unknown as Record<string, unknown>);
  return speechCache;
}

export function ARWorkspace({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<ProjectDetail | null>(null),
    [view, setViewed] = useState<ViewedStep>({ step_id: null, revision: 0 });
  const router = useRouter();
  // Cumulative step hologram (earlier steps = assembled, this step = current). Guidance only.
  const [rawHologram, setHologram] = useState<HologramView>(EMPTY_HOLOGRAM),
    [loadedFor, setLoadedFor] = useState(""),
    [sceneExcluded, setSceneExcluded] = useState(0);
  const [resultSummary, setResultSummary] = useState<InspectionSummary | null>(null),
    [resultMode, setResultMode] = useState<PanelView>("guide"),
    [resultErrorsOnly, setResultErrorsOnly] = useState(false);
  const [verification, setVerification] = useState({ step: "", verified: false }),
    [online, setOnline] = useState(false);
  const [device, setDevice] = useState("Checking");
  const [cap, setCap] = useState({ available: false, message: "Checking this device…" });
  const [status, setStatus] = useState("No XR session started."),
    [busy, setBusy] = useState(false),
    [active, setActive] = useState(false),
    [error, setError] = useState("");
  const [showReference, setShowReference] = useState(true),
    [helpVisible, setHelpVisible] = useState(false),
    [refError, setRefError] = useState("");
  const voiceSupported = useSyncExternalStore(
    () => () => {},
    () => detectSpeechSupportCached(),
    () => CHECKING_SPEECH,
  );
  const [voice, setVoice] = useState<VoiceSnapshot>({ state: "off", message: "Voice is off." }),
    [voiceStatus, setVoiceStatus] = useState(""),
    [lastCommand, setLastCommand] = useState(""),
    [voiceLang, setVoiceLang] = useState("en-US"),
    [consent, setConsent] = useState(false),
    [readAloud, setReadAloud] = useState(false);
  const [micTest, setMicTest] = useState({ state: "idle", message: "Microphone access has not been tested." });
  const micPending = useRef(false), micSession = useRef({ active: false });
  const voiceBusy = ["starting", "listening", "stopping"].includes(voice.state);
  const voiceState = voiceSupported.supported ? voice.state : "unsupported";
  const voiceMessage = voiceSupported.supported ? voice.message : voiceSupported.reason;
  const voiceLabel = voiceState.charAt(0).toUpperCase() + voiceState.slice(1);
  const host = useRef<HTMLDivElement>(null),
    runtime = useRef<SpatialSession | null>(null),
    alive = useRef(true),
    generation = useRef(0);
  const [diagnostic, setDiagnostic] = useState<CommandDiagnostic | null>(null);
  const [captureDiag, setCaptureDiag] = useState<CaptureDiagnostic | null>(null);
  const viewRef = useRef<ViewedStep>({ step_id: null, revision: 0 });
  const [localOn, setLocalOn] = useState(false),
    [localBusy, setLocalBusy] = useState(false),
    [localStatus, setLocalStatus] = useState("Local voice off (recommended on HoloLens)."),
    [localConsent, setLocalConsent] = useState(false),
    [localEngine, setLocalEngine] = useState("");
  const localRef = useRef<LocalVoiceController | null>(null);
  const [autoOn, setAutoOn] = useState(false),
    [autoPaused, setAutoPaused] = useState(false),
    [autoStateLabel, setAutoStateLabel] = useState("idle"),
    [autoStatus, setAutoStatus] = useState("Autonomous Assembly is off. It never calls Meta AI until you start it."),
    [cameraSource, setCameraSource] = useState<CameraSource>("hololens"),
    [camDevices, setCamDevices] = useState<{ deviceId: string; label: string }[]>([]),
    [camDeviceId, setCamDeviceId] = useState("");
  const [anchorUi, setAnchorUi] = useState("unplaced");
  const [fieldDiag, setFieldDiag] = useState<FieldDiagnostics>(EMPTY_FIELD_DIAGNOSTICS);
  const [autoDiag, setAutoDiag] = useState<AutoStatus | null>(null);
  // Guided flow: a running Check Step and an explicit USER confirmation (never backend verification).
  const [checkingStep, setCheckingStep] = useState(false);
  const checkingRef = useRef(false);
  const [manualConfirm, setManualConfirm] = useState<{ stepId: string; at: string } | null>(null);
  // Finish: bound to the verified last step it was confirmed for (never a separate progress state).
  const [finishedFor, setFinishedFor] = useState<string | null>(null);
  // Restart Assembly starts a NEW run: a new server run (progress scope) and a new local
  // epoch that discards every answer/check of the old run on this device.
  const runEpochRef = useRef(0);
  /** Server run id last seen (undefined = not loaded yet); a change means another device restarted. */
  const runIdRef = useRef<string | null | undefined>(undefined);
  const [newRunNotice, setNewRunNotice] = useState<number | null>(null);
  const [lastGuideOutcome, setLastGuideOutcome] = useState("");
  // In-AR voice: explicit two-tap consent inside the panel and a visible last error.
  const [voiceConsentPending, setVoiceConsentPending] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [checkError, setCheckError] = useState<{ stepId: string; message: string } | null>(null);
  // Inspection-capture preview: the EXACT snapshot handed to the pipeline (≤2 kept, memory only).
  const [previewVersion, setPreviewVersion] = useState(0);
  const [previews] = useState(() => new CapturePreviewStore(() => setPreviewVersion((v) => v + 1)));
  /** Which capture produced the summary currently in `resultSummary` (identity-bound). */
  const resultBinding = useRef<{ summary: InspectionSummary | null; id: number }>({ summary: null, id: 0 });
  const decodedFor = useRef<{ runtime: SpatialSession | null; ids: Set<number> }>({ runtime: null, ids: new Set() });
  const [pairingCode, setPairingCode] = useState("");
  const [assessPlaced, setAssessPlaced] = useState(false);
  const [lastTrace, setLastTrace] = useState<InspectionDiagnostics | null>(null);
  const [lastFrame, setLastFrame] = useState<{ dataUrl: string; source: string; capturedAt: string; fingerprint: string; width: number; height: number } | null>(null);
  const [showFrame, setShowFrame] = useState(false);
  const [extPending, setExtPending] = useState(false);
  /** The single active external capture request (request id + scope); stale polls are dropped. */
  const [extTracker] = useState(() => new ExternalRequestTracker());
  const pairingRef = useRef("");
  const specRef = useRef("");
  const [companionOn, setCompanionOn] = useState(false);
  const [interactionUi, setInteractionUi] = useState("");
  const machineRef = useRef<AutonomousMachine | null>(null);
  const controllerRef = useRef<AutoController | null>(null);
  const coordinatorRef = useRef(new InspectionCoordinator());
  const monitorRef = useRef<MonitorCamera | null>(null);
  /** Camera OPENED by the external companion (owner), independent of the shared `monitorRef` reference. */
  const companionCameraRef = useRef<MonitorCamera | null>(null);
  const autoAbort = useRef<AbortController | null>(null);
  /** The in-flight request started BY Autonomous (Stop aborts only this one, never a manual Check). */
  const autoOwnedAbort = useRef<AbortController | null>(null);
  /**
   * One runner owns camera, controller and timer. Its phase is read synchronously,
   * so rapid holographic taps never act on a stale React render.
   */
  const [runner] = useState(() => new AutonomousRunner({
    camera: () => (monitorRef.current?.live ? monitorRef.current : new MonitorCamera()),
    controller: {
      inspect: (intent, frame, sid, guard) => inspectRef.current(intent, frame, sid, guard),
      context: () => ({
        projectId,
        stepId: viewRef.current.step_id,
        xrActive: runtime.current !== null,
        // Anchored AND a current viewer pose: an anchor held during head-tracking loss is not enough.
        anchored: runtime.current?.autoInspectionReady ?? false,
        anchorState: runtime.current?.anchorState ?? "unplaced",
        viewerTracked: runtime.current ? runtime.current.viewerTracked : undefined,
        anchorEpoch: runtime.current?.anchorEpoch,
        fieldInView: runtime.current?.fieldInView ?? null,
        otherInspectionRunning: coordinatorRef.current.busy,
        externalPending: extPendingRef.current,
      }),
      advance: () => advanceRef.current(),
      onFrameRejected: (preview, reason) => rejectedRef.current(preview, reason),
      now: () => Date.now(),
    },
    onStatus: (st) => {
      if (!alive.current) return;
      setAutoDiag(st);
      setAutoStatus(`${st.headline} — ${st.detail}`);
      setAutoStateLabel(st.machineState);
    },
    onPhase: (phase, message) => {
      if (phase === "starting" || phase === "running") monitorRef.current = runner.camera as MonitorCamera | null;
      if (phase === "off") monitorRef.current = null;
      controllerRef.current = runner.controller;
      if (runner.controller) machineRef.current = runner.controller.machine;
      if (!alive.current) return;
      setAutoOn(phase !== "off");
      setAutoPaused(phase === "paused");
      if (phase === "off") {
        machineRef.current = null;
        setAutoStateLabel("idle");
        setAutoDiag(null);
      }
      if (phase === "completed") setAutoStateLabel("completed");
      if (phase !== "running") setAutoStatus(message);
    },
    abortOwnRequest: () => autoOwnedAbort.current?.abort(),
  }));

  const autoWorkflow = useRef<WorkflowInspection | null>(null);
  const advancingRef = useRef(false);
  const voiceRef = useRef<VoiceController | null>(null);
  const actionRef = useRef<(action: Action | VoiceAction) => void>(() => {});
  // Voice controllers are created once at enable time; they must never call
  // the enable-time closure (stale step/revision/toggles). Always dispatch
  // through this ref, which is refreshed with the latest render.
  const dispatchRef = useRef<
    (a: VoiceAction, t: string) => Promise<ExecutionOutcome>
  >(() => Promise.resolve({ ok: false, reason: "Voice dispatch not ready" }));
  const info = useRef<Guidance>({ placement: null, text: "Loading", detail: "Unverified" });
  const step = project?.steps.find((s) => s.id === view.step_id);
  const totalSteps = project?.steps.length ?? 0;
  const selectedRef = selectedStepReference(step);
  const refPath = trustedReferencePath(selectedRef);
  const spec = JSON.stringify([
    step?.updated_at,
    step?.required_blocks.map((b) => b.block.updated_at),
  ]);
  // The scene depends on this step AND every earlier step's guidance revision.
  const sceneSpec = JSON.stringify(
    (project?.steps ?? [])
      .filter((s) => step && s.position <= step.position)
      .map((s) => [s.id, s.updated_at, s.required_blocks.map((b) => b.block.updated_at)]),
  );
  const placementKey = `${view.step_id}:${spec}:${sceneSpec}`;
  const hologram = loadedFor === placementKey ? rawHologram : EMPTY_HOLOGRAM;
  /** First block of this step (labels, marker presence); the panel draws all of them. */
  const placement: Placement | null = hologram.current[0] ?? null;
  const verified = verification.step === view.step_id && verification.verified;
  const target = step?.required_blocks.find((b) => b.block_id === placement?.target_block_id);
  const verificationUrl = `/?project=${encodeURIComponent(projectId)}&step=${encodeURIComponent(view.step_id ?? "")}`;
  const verificationStatus = !online ? "uncertain" : verified ? "verified" : "not_verified";
  const isLastStep = !!step && step.position === totalSteps;
  const stepSummary = resultSummary && resultSummary.stepId === view.step_id ? resultSummary : null;
  const manuallyConfirmed = !!manualConfirm && manualConfirm.stepId === view.step_id;
  const stepCheckError = checkError && checkError.stepId === view.step_id ? checkError.message : null;
  const guide: GuideView = useMemo(() => {
    const base = deriveGuide({
      anchored: active ? anchorUi === "anchored" || anchorUi === "tracking_degraded" : null,
      checking: checkingStep,
      serverVerified: verified && online,
      manuallyConfirmed,
      isLastStep,
      finished: finishedFor !== null && finishedFor === view.step_id,
      newRun: newRunNotice !== null && !!step && step.position === 1 ? { total: totalSteps } : null,
      checkError: stepCheckError,
      summary: stepSummary,
    });
    return active && anchorUi === "tracking_lost"
      ? { ...base, label: "Tracking lost", message: "Field tracking is uncertain — select Re-anchor.", tone: "warn" }
      : base;
  }, [active, anchorUi, checkingStep, verified, online, manuallyConfirmed, isLastStep, finishedFor, newRunNotice, step, totalSteps, view.step_id, stepCheckError, stepSummary]);
  const shortText = step
    ? shortInstruction(step.required_blocks.map((b) => ({ color: b.block.color, name: b.block.name, quantity: b.required_quantity })), !!placement)
    : "Loading project…";

  const stopVoice = useCallback((release = false) => {
    if (release) {
      voiceRef.current?.dispose();
      voiceRef.current = null;
    } else voiceRef.current?.stop();
  }, []);
  const stopLocalVoice = useCallback(() => {
    localRef.current?.stop();
    localRef.current = null;
    setLocalOn(false);
    setLocalBusy(false);
  }, []);
  const stopAllVoice = useCallback(
    (release = false) => {
      stopVoice(release);
      stopLocalVoice();
    },
    [stopVoice, stopLocalVoice],
  );
  useEffect(() => {
    let cancelled = false;
    void backendVoiceApi
      .status()
      .then((s) => {
        if (!cancelled)
          setLocalEngine(
            s.available
              ? `Local Whisper ready: ${s.engine} (${s.model}) on your Mac.`
              : `Local Whisper unavailable: ${s.reason}`,
          );
      })
      .catch(() => {
        if (!cancelled) setLocalEngine("Local Whisper status unavailable (backend unreachable).");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    alive.current = true;
    const microphoneSession = { active: true };
    micSession.current = microphoneSession;
    generation.current++;
    void capabilities().then((c) => {
      if (alive.current) {
        setCap(c);
        setDevice(navigator.userAgent);
      }
    });
    return () => {
      alive.current = false;
      extTracker.invalidate(); // a poll resolving after unmount is dropped
      // runner.stop() clears monitorRef via onPhase("off"): capture every camera
      // reference first so a companion/probe camera it does not own is released too.
      const monitor = monitorRef.current;
      const companionCamera = companionCameraRef.current;
      companionCameraRef.current = null;
      runner.stop();
      autoAbort.current?.abort();
      monitor?.stop();
      companionCamera?.stop();
      monitorRef.current?.stop();
      microphoneSession.active = false;
      voiceRef.current?.dispose();
      voiceRef.current = null;
      localRef.current?.dispose();
      localRef.current = null;
      void runtime.current?.end();
    };
  }, [runner, extTracker]);
  useEffect(() => {
    let cancelled = false,
      running = false,
      failures = 0;
    const refresh = async () => {
      if (running) return;
      running = true;
      try {
        const epochAtStart = runEpochRef.current;
        const [p, v, progress, run] = await Promise.all([
          registry.project(projectId),
          getView(projectId),
          getProgress(projectId),
          getAssemblyRun(projectId),
        ]);
        if (cancelled) return;
        // Another device started a new assembly run: end this device's old run first
        // (its results, frames, requests and completion state belong to the old run).
        // (A poll that started before this device's own restart carries the OLD run: ignore it.)
        if (epochAtStart === runEpochRef.current) {
          if (runIdRef.current !== undefined && run.run_id !== runIdRef.current) runChangedRef.current(run, v);
          runIdRef.current = run.run_id;
        }
        setProject(p);
        setViewed((old) =>
          v.revision >= old.revision || !p.steps.some((s) => s.id === old.step_id) ? v : old,
        );
        setVerification({
          step: v.step_id ?? "",
          verified: progress.some((s) => s.step_id === v.step_id && s.status === "verified"),
        });
        if (v.step_id)
          setResultSummary((old) => {
            const loaded = loadInspectionSummary(
              projectId,
              v.step_id!,
              progress.find((s) => s.step_id === v.step_id)?.specification_id ?? null,
            );
            // Keep object identity when nothing changed to avoid render loops.
            return JSON.stringify(old) === JSON.stringify(loaded) ? old : loaded;
          });
        failures = 0;
        setOnline(true);
      } catch (e) {
        // One dropped poll (Wi-Fi blip, busy backend) must not blank the
        // hologram; two consecutive failures mark the state unavailable.
        if (!cancelled && ++failures >= 2) {
          setOnline(false);
          setVerification({ step: "", verified: false });
          setError(errorMessage(e));
        }
      } finally {
        running = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [projectId]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Never show the previous step's geometry while the next one loads.
      setHologram(EMPTY_HOLOGRAM);
      if (!view.step_id) return;
      const key = `${view.step_id}:${spec}:${sceneSpec}`;
      try {
        const scene = await getScene(projectId, view.step_id);
        if (!cancelled) {
          setHologram(splitScene(scene, view.step_id));
          setSceneExcluded(scene.excluded?.length ?? 0);
          setLoadedFor(key);
        }
      } catch (e) {
        if (!cancelled) {
          setError(errorMessage(e));
          setLoadedFor(key); // settled (empty): the manual proxy box becomes available
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, view.step_id, spec, sceneSpec]);

  // Load the selected expected reference from the trusted media endpoint only.
  // Clear the previous bitmap immediately on step change (no stale image).
  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    runtime.current?.setReferenceImage(null);
    if (!refPath) return;
    void (async () => {
      setRefError("");
      try {
        const response = await fetch(mediaUrl(refPath));
        if (!response.ok) throw new Error(`Reference image failed (HTTP ${response.status})`);
        const blob = await response.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        const bitmap = await createImageBitmap(blob).catch(() => null);
        if (cancelled) {
          bitmap?.close();
          return;
        }
        if (bitmap) {
          runtime.current?.setReferenceImage(bitmap as unknown as { width: number; height: number });
        } else {
          const img = new Image();
          img.src = objectUrl;
          await img.decode();
          if (cancelled) return;
          const bmp = await createImageBitmap(img).catch(() => null);
          if (bmp && !cancelled) runtime.current?.setReferenceImage(bmp as unknown as { width: number; height: number });
          else if (bmp) bmp.close();
        }
      } catch (e) {
        if (!cancelled) {
          runtime.current?.setReferenceImage(null);
          setRefError(`Expected reference could not be loaded: ${errorMessage(e)}`);
        }
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      // Runtime disposes/closes the bitmap when replaced or on session end.
    };
  }, [refPath, view.step_id]);

  const fieldLine = active ? describeField(fieldDiag) : "";
  // Compact voice status for the AR panel (real controller state, never a silent Off).
  const voiceView = voicePanel({
    listening: localOn, busy: localBusy, consentPending: voiceConsentPending,
    processing: captureDiag?.phase === "processing", error: voiceError, diagnostic,
  });
  const voiceLine = voiceView.line, voiceTone = voiceView.tone, voiceButton = voiceView.button;
  const autoButton = !autoOn ? "Start Autonomous" : autoStateLabel === "completed" ? "Assembly Complete ✓" : autoPaused ? "Resume Autonomous" : "Pause Autonomous";
  useEffect(() => {
    const blockLabel = step
      ? step.required_blocks
          .map((b) => `${b.required_quantity} × ${b.block.color} ${b.block.name}`)
          .join(", ") || "No block required"
      : "";
    const headline = resultHeadline(resultSummary, verified && online);
    info.current = {
      completion: finishedFor === view.step_id && finishedFor !== null && verified && online && !checkingStep && !extPending && stepSummary?.kind !== "inspecting",
      placement: online ? placement : null,
      hologram: online ? hologram : EMPTY_HOLOGRAM,
      text: step ? `Step ${step.position} — ${step.instruction}` : "Choose a project step",
      detail: `${hologram.current.length} block(s) this step · ${hologram.assembled.length} already assembled · ${verified && online ? "Inspection verified" : "Not verified"}`,
      title: step ? step.title : "Choose a step",
      instruction: step?.instruction ?? "",
      blockLabel: `${blockLabel} · ${placement?.evidence.toUpperCase() ?? "NO MODEL"}${placement ? ` · #${placement.instance}/${target?.required_quantity ?? "?"}` : ""}`,
      verification: verificationStatus as Guidance["verification"],
      hasReference: !!refPath,
      voiceLabel: localOn
        ? `🎤 Local voice listening — ${localStatus}`
        : `Voice: ${voiceLabel}${voice.errorCode ? ` (${voice.errorCode})` : ""} — ${voiceMessage}`,
      anchorLabel: active ? fieldLine : undefined,
      autoLabel: autoOn || extPending ? (autoDiag ? `${autoDiag.headline}${autoDiag.metrics ? ` [${autoDiag.metrics}]` : ""}` : autoStatus) : undefined,
      autoButton,
      voiceLine,
      voiceTone,
      voiceButton,
      autoActive: autoOn && autoStateLabel !== "completed",
      stepLabel: step ? `Step ${step.position} of ${totalSteps}` : "No step",
      progress: step ? { position: step.position, total: totalSteps, currentVerified: verified && online } : undefined,
      guideLabel: guide.label,
      guideMessage: lastGuideOutcome || guide.message,
      guideTone: guide.tone,
      shortInstruction: shortText,
      primary: guide.buttons,
      markerColor: guide.marker,
      ghostTint: guide.ghostTint,
      voiceDetail: captureDiag
        ? `🎤 Mic ${captureDiag.mic} · ${captureDiag.phase} · ${captureDiag.message}${captureDiag.transcript ? ` · “${captureDiag.transcript}”` : ""}${captureDiag.action ? ` → ${captureDiag.action}` : ""}${captureDiag.rms !== undefined ? ` · level ${captureDiag.rms.toFixed(3)}` : ""} · track ${captureDiag.trackState ?? "?"} · audio ${captureDiag.contextState ?? "?"}`
        : undefined,
      diagnostic: diagnostic
        ? `${diagnostic.state === "completed" ? "✓" : diagnostic.state === "failed" || diagnostic.state === "rejected" ? "✗" : "…"} ${diagnostic.action ?? "no command"} · ${diagnostic.state.toUpperCase()}${diagnostic.detail ? ` · ${diagnostic.detail}` : ""}${diagnostic.reason ? ` · ${diagnostic.reason}` : ""} · “${diagnostic.transcript}”`
        : undefined,
      lastCommand: lastCommand || undefined,
      resultHeadline: headline?.text,
      resultTone: headline?.tone,
      resultLines: resultSummary ? resultLines(resultSummary, verified && online, resultErrorsOnly) : undefined,
      resultErrorsOnly,
    };
    runtime.current?.update(info.current);
    runtime.current?.setShowReference(showReference);
    runtime.current?.setHelpVisible(helpVisible);
    runtime.current?.setViewMode(resultMode);
  }, [checkingStep, stepSummary, finishedFor, view.step_id, placement, hologram, step, target, verified, online, totalSteps, refPath, voiceLabel, voiceMessage, voice.errorCode, lastCommand, showReference, helpVisible, verificationStatus, localOn, localStatus, diagnostic, captureDiag, active, anchorUi, autoOn, extPending, autoStateLabel, autoStatus, resultSummary, resultMode, resultErrorsOnly, fieldLine, autoButton, autoDiag, guide, lastGuideOutcome, shortText, voiceLine, voiceTone, voiceButton]);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  useEffect(() => {
    const rt = runtime.current;
    if (!rt || !active) return;
    if (decodedFor.current.runtime !== rt) decodedFor.current = { runtime: rt, ids: new Set() };
    const current = previews.current;
    const binding = resultBinding.current;
    const bound = binding.summary && binding.summary === resultSummary ? previews.byId(binding.id) : null;
    rt.setCaptures(current ? captureView(current) : null, bound ? captureView(bound) : null, indicatorFor(current, autoOn && !autoPaused));
    for (const record of [current, bound]) {
      if (record && !decodedFor.current.ids.has(record.id)) {
        decodedFor.current.ids.add(record.id);
        void decodeCapture(rt, record);
      }
    }
    // Drop the "NEW FRAME" highlight after it expires (one redraw, no animation loop).
    if (current && captureView(current).isNew) {
      const timer = setTimeout(() => setPreviewVersion((v) => v + 1), 3100);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewVersion, resultSummary, autoOn, autoPaused, active]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      setAnchorUi(runtime.current?.anchorState ?? "unplaced");
      const diag = runtime.current?.fieldDiagnostics;
      if (diag) setFieldDiag(diag);
      const d = runtime.current?.interaction;
      if (d) setInteractionUi(
        `sources: ${d.sources.map((x) => `${x.handedness}/${x.targetRayMode}${x.tracked ? "" : " (untracked)"}`).join(", ") || "none"} · panel hit: ${d.rayIntersectsPanel ? "yes" : "no"} · hover: ${d.hoveredButton ?? "none"} · manipulation: ${d.manipulation} · last select: ${d.lastSelect ?? "none"} · last action: ${d.lastAction ?? "none"} · last failure: ${d.lastFailure ?? "none"}`,
      );
    }, 500);
    return () => clearInterval(timer);
  }, [active]);
  useEffect(() => {
    if (view.step_id) {
      // Any request still running belongs to the previous step: cancel it so
      // it can neither overwrite the new step's state nor hit a backend 409.
      if (coordinatorRef.current.busy && coordinatorRef.current.activeStep !== view.step_id) autoAbort.current?.abort();
      coordinatorRef.current.invalidateStep();
      // An external capture requested for the previous step can never answer this one.
      // (the poll then sees no active request and clears the pending flag itself).
      if (extTracker.current && extTracker.current.stepId !== view.step_id) extTracker.invalidate();
      previews.invalidate(); // never present a previous-step frame as current evidence
      resultBinding.current = { summary: null, id: 0 };
      if (controllerRef.current) controllerRef.current.onStepChanged(view.step_id);
      else machineRef.current?.stepChanged(view.step_id);
      autoWorkflow.current = null;
      syncAutoLabel();
    }
  }, [view.step_id, previews, extTracker]);
  useEffect(() => {
    if (!extPending) return;
    let disposed = false;
    const timer = setInterval(() => {
      void (async () => {
        const request = extTracker.current;
        if (!request) {
          // Invalidated (step change / Stop): nothing is awaited any more.
          if (!disposed && alive.current) setExtPending(false);
          return;
        }
        if (request.spec !== specRef.current || request.code !== pairingRef.current) {
          // The step guidance or pairing changed: this request can no longer be answered.
          extTracker.invalidate();
          if (!disposed && alive.current) {
            setExtPending(false);
            setAutoStatus("External camera request discarded — the step or pairing code changed. Request a new check.");
          }
          return;
        }
        const received = await extTracker.pollOnce(
          (r) => latestExternalResult(r.projectId, r.stepId, r.code, r.requestId),
          () => ({ projectId, stepId: viewRef.current.step_id, code: pairingRef.current, spec: specRef.current }),
        );
        if (!received || disposed || !alive.current) return;
        const { summary } = received;
        saveInspectionSummary(summary);
        setResultSummary(summary);
        // The external verdict is a manual check: Autonomous adopts it (uncertain = wait for Check Again).
        const external = summaryVerdictOf(summary);
        if (external && summary.stepId === viewRef.current.step_id) controllerRef.current?.adoptManual(external, summary.stepId);
        setResultMode("result");
        runtime.current?.setViewMode("result");
        setExtPending(false); // only the active request was consumed by pollOnce
        setAutoStatus("External camera result received in AR — see the result panel.");
        // Advance only after the backend progress confirms this exact step.
        if (summary.verificationStatus === "verified") await advanceIfVerified();
      })();
    }, 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extPending, extTracker]);
  useEffect(() => {
    if (!companionOn) return;
    const timer = setInterval(() => void runCompanionOnce(), 2000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companionOn, pairingCode, view.step_id, cameraSource, camDeviceId]);
  useEffect(() => {
    if (!companionOn) return;
    return () => {
      // Companion switched off: release the camera it opened unless Autonomous now owns it.
      const camera = companionCameraRef.current;
      companionCameraRef.current = null;
      if (camera && camera !== runner.camera) {
        camera.stop();
        if (monitorRef.current === camera) monitorRef.current = null;
      }
    };
  }, [companionOn, runner]);
  useEffect(() => {
    if (autoOn && verified) void advanceIfVerified();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOn, verified]);

  /**
   * Move the shared step cursor by `offset`. The move is bound to a fixed
   * origin (`fromStepId`, default: the current step) and a fixed absolute
   * target computed ONCE; a revision conflict never re-applies the offset
   * (see lib/ar/cursor.ts), so with two devices no step is skipped.
   */
  async function navigate(offset: number, fromStepId?: string): Promise<ExecutionOutcome> {
    if (!project) return { ok: false, reason: "Project is still loading" };
    if (coordinatorRef.current.busy && !advancingRef.current)
      return { ok: false, reason: "Inspection running — navigation waits until Meta finishes" };
    if (!online) return { ok: false, reason: "Project state unavailable (offline)" };
    const current = viewRef.current;
    const originId = fromStepId ?? current.step_id;
    const index = project.steps.findIndex((s) => s.id === originId);
    if (index < 0) return { ok: false, reason: "Current step is unknown" };
    const from = project.steps[index];
    const next = project.steps[index + offset];
    if (!next)
      return {
        ok: false,
        reason: offset < 0 ? "Already at first step" : "Already at last step",
        detail: `Step ${from.position} of ${project.steps.length}`,
      };
    if (current.step_id === next.id) return { ok: true, detail: `Already at Step ${next.position}` };
    if (current.step_id !== from.id)
      return { ok: false, reason: "The step changed meanwhile; nothing was moved", detail: `Still at Step ${project.steps.find((s) => s.id === current.step_id)?.position ?? "?"}` };
    setHologram(EMPTY_HOLOGRAM);
    runtime.current?.setReferenceImage(null);
    runtime.current?.update({ ...info.current, placement: null, hologram: EMPTY_HOLOGRAM });
    const adopt = (v: ViewedStep) => {
      viewRef.current = v;
      setViewed(v);
      setVerification({ step: "", verified: false });
      setError("");
    };
    try {
      const move = await moveCursor(
        { setView: (step, revision) => setView(projectId, step, revision), getView: () => getView(projectId) },
        { from: from.id, to: next.id, revision: current.revision },
      );
      adopt(move.view);
      if (move.kind === "diverged")
        return {
          ok: false,
          reason: "Project state revision conflict",
          detail: `Another device moved to Step ${project.steps.find((s) => s.id === move.view.step_id)?.position ?? "?"}; nothing was moved`,
        };
      return {
        ok: true,
        detail: move.kind === "synced"
          ? `Step ${from.position} → ${next.position} (already moved by another device)`
          : `Step ${from.position} → ${next.position}${move.retried ? " (after revision reload)" : ""}`,
      };
    } catch (e) {
      const message = errorMessage(e);
      setError(message);
      return {
        ok: false,
        reason: isRevisionConflict(e) ? "Project state revision conflict" : message,
      };
    }
  }
  async function verify(mode: "inspect" | "verify" = "inspect"): Promise<ExecutionOutcome> {
    // Voice/button Verify never marks anything verified. It ends XR and opens
    // the HoloLens camera workspace, which auto-captures ONE fresh real frame
    // and runs the existing Meta inspection / fresh-image verification.
    if (view.step_id)
      saveVoiceVerifyIntent({
        mode,
        projectId,
        stepId: view.step_id,
        requestedAt: new Date().toISOString(),
      });
    stopAllVoice(true);
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    await runtime.current?.end();
    router.push(verificationUrl);
    return {
      ok: true,
      detail: `Opening HoloLens camera ${mode === "verify" ? "fresh-image verification" : "inspection"} for Step ${step?.position ?? "?"}`,
    };
  }
  async function verifyAgain(): Promise<ExecutionOutcome> {
    if (!view.step_id) return { ok: false, reason: "Current step is unknown" };
    const last = readLastInspection(projectId, view.step_id);
    if (!last)
      setStatus("Verify Again: no previous inspection for this step yet — running a first inspection instead.");
    const outcome = await verifyInAR(last ? "verify" : "inspect");
    return last
      ? outcome
      : { ...outcome, detail: `${outcome.detail ?? ""} (first inspection — no previous inspection yet)` };
  }
  /** 2D guided card: same actions as the AR panel buttons (no voice). */
  async function runGuideAction(id: "verify" | "next" | "confirm" | "finish" | "restart" | "previous") {
    const outcome = await handleAction(id);
    // Check results are shown by the status itself; only other failed actions get an extra line.
    if (alive.current) setLastGuideOutcome(id === "verify" || outcome.ok ? "" : outcome.reason ?? "Aktion fehlgeschlagen");
  }
  async function exitAR() {
    stopAllVoice(true);
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    await runtime.current?.end();
    setActive(false);
    setStatus("XR session ended. Microphone stopped. Re-enter and re-anchor before continuing.");
  }
  async function handleAction(a: Action | VoiceAction): Promise<ExecutionOutcome> {
    switch (a) {
      case "next":
        return navigate(1);
      case "previous":
        return navigate(-1);
      case "verify":
      case "verify-again":
        // Check Step / Check Again (button or voice): runs the normal fresh-image check;
        // nothing here can mark a step verified without an accepted inspection.
        return checkStep();
      case "confirm":
        return confirmPosition();
      case "finish":
        return finishAssembly();
      case "restart":
        return restartAssembly();
      case "exit":
        await exitAR();
        return { ok: true, detail: "XR session ended; microphone stopped" };
      case "re-anchor":
      case "reanchor":
        if (!runtime.current) return { ok: false, reason: "No active AR session — enter AR first" };
        reanchorField();
        return { ok: true, detail: "Tabletop alignment reset — confirm the origin again" };
      case "recenter":
        if (!runtime.current) return { ok: false, reason: "No active AR session — enter AR first" };
        runtime.current.recenterPanel();
        return { ok: true, detail: "Instruction panel recentered" };
      case "reference": {
        if (!refPath && !showReference)
          return { ok: false, reason: "No reference photograph for this step" };
        const nextValue = !showReference;
        setShowReference(nextValue);
        runtime.current?.setShowReference(nextValue);
        return { ok: true, detail: nextValue ? "Reference shown" : "Reference hidden" };
      }
      case "show-reference":
        if (!refPath) return { ok: false, reason: "No reference photograph for this step" };
        setShowReference(true);
        runtime.current?.setShowReference(true);
        return { ok: true, detail: "Expected reference shown" };
      case "hide-reference":
        setShowReference(false);
        runtime.current?.setShowReference(false);
        return { ok: true, detail: "Expected reference hidden" };
      case "result": {
        const mode = runtime.current?.panelViewMode ?? resultMode;
        setResultMode(mode);
        return { ok: true, detail: mode === "result" ? "Inspection result shown" : "Instructions shown" };
      }
      case "camera": {
        const mode = runtime.current?.panelViewMode ?? resultMode;
        setResultMode(mode);
        return {
          ok: true,
          detail: mode === "camera"
            ? previews.current ? `Captured frame ${captureView(previews.current).time} shown` : "No inspection frame captured for this step yet"
            : "Instructions shown",
        };
      }
      case "show-result":
        if (!resultSummary) return { ok: false, reason: "No inspection result for this step yet — say Verify Step" };
        setResultErrorsOnly(false);
        setResultMode("result");
        runtime.current?.setViewMode("result");
        return { ok: true, detail: resultHeadline(resultSummary, verified)?.text ?? "Latest result shown" };
      case "show-errors":
        if (!resultSummary) return { ok: false, reason: "No inspection result for this step yet — say Verify Step" };
        setResultErrorsOnly(true);
        setResultMode("result");
        runtime.current?.setViewMode("result");
        return {
          ok: resultSummary.issues.length > 0,
          reason: resultSummary.issues.length ? undefined : "No issues were reported for this step",
          detail: `${resultSummary.issues.length} issue(s) reported`,
        };
      case "read-result": {
        if (!resultSummary) return { ok: false, reason: "No inspection result for this step yet — say Verify Step" };
        if (!readAloud) return { ok: false, reason: "Read-aloud is off — enable “Read instructions aloud”" };
        if (!("speechSynthesis" in window)) return { ok: false, reason: "Speech synthesis is not supported in this browser" };
        const headline = resultHeadline(resultSummary, verified);
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(
          `${headline?.text ?? ""}. ${resultSummary.explanation} ${resultSummary.nextAction}`,
        ));
        return { ok: true, detail: "Reading the result aloud" };
      }
      case "read-correction": {
        if (!resultSummary) return { ok: false, reason: "No inspection result for this step yet — say Verify Step" };
        if (!readAloud) return { ok: false, reason: "Read-aloud is off — enable “Read instructions aloud”" };
        if (!("speechSynthesis" in window)) return { ok: false, reason: "Speech synthesis is not supported in this browser" };
        const text = resultSummary.issues.length
          ? resultSummary.issues.map((i) => `${i.description} Fix: ${i.suggested_fix}`).join(". ")
          : resultSummary.correctionPlan.join(". ") || "No correction was reported.";
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
        return { ok: true, detail: "Reading the correction aloud" };
      }
      case "back-to-instructions":
        setResultMode("guide");
        setResultErrorsOnly(false);
        runtime.current?.setViewMode("guide");
        document.getElementById("ar-full-instruction")?.scrollIntoView({ block: "nearest" });
        return { ok: true, detail: "Instructions shown" };
      case "show-instructions":
        setResultMode("guide");
        runtime.current?.setViewMode("guide");
        document.getElementById("ar-full-instruction")?.scrollIntoView({ block: "nearest" });
        return { ok: true, detail: `Step ${step?.position ?? "?"} instruction displayed` };
      case "read-instructions": {
        if (!readAloud)
          return { ok: false, reason: "Read-aloud is off — enable “Read instructions aloud”" };
        if (!step || !("speechSynthesis" in window))
          return { ok: false, reason: "Speech synthesis is not supported in this browser" };
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(step.instruction));
        return { ok: true, detail: "Reading the instruction aloud" };
      }
      case "help":
        setHelpVisible((v) => !v);
        return { ok: true, detail: "Available commands toggled" };
      case "page":
        return { ok: true, detail: "More Text" };
      case "page-prev":
        return { ok: true, detail: "Previous Text" };
      case "rotate-left":
      case "rotate-right":
        // Handled by the panel itself; panel transform only (never field, step or Autonomous).
        return { ok: true, detail: "Panel rotated" };
      case "voice": {
        // In-AR Start/Stop Voice (local Whisper on the Mac; nothing recorded until started).
        const toggle = voiceToggle({
          listening: !!localRef.current?.isListening || localOn,
          busy: localBusy || !!localRef.current?.isBusy,
          consented: localConsent,
          consentPending: voiceConsentPending,
        });
        if (toggle === "stop") {
          stopLocalVoice();
          setVoiceConsentPending(false);
          return { ok: true, detail: "Voice stopped — microphone released" };
        }
        if (toggle === "busy") return { ok: false, reason: "Voice is starting" };
        if (toggle === "ask-consent") {
          setVoiceConsentPending(true);
          return { ok: true, detail: "Voice consent shown — select Confirm Voice to start" };
        }
        setLocalConsent(true);
        setVoiceConsentPending(false);
        enableLocalVoice(true);
        return { ok: true, detail: "Starting voice…" };
      }
      case "more-text":
      case "previous-text":
        if (!runtime.current) return { ok: false, reason: "Text pages are in the AR panel — enter AR first" };
        runtime.current.turnPage(a === "more-text" ? 1 : -1);
        return { ok: true, detail: `Text page ${runtime.current.textPage.page + 1} of ${runtime.current.textPage.count}` };
      case "auto-start":
        if (runner.active) return { ok: false, reason: `Autonomous is already ${runner.phase}` };
        await startAutonomous();
        return runner.active ? { ok: true, detail: "Autonomous started" } : { ok: false, reason: "Autonomous could not start — see the status" };
      case "auto-pause":
        return runner.pause() ? { ok: true, detail: "Autonomous paused" } : { ok: false, reason: "Autonomous is not running" };
      case "auto-resume":
        return runner.resume() ? { ok: true, detail: "Autonomous resumed" } : { ok: false, reason: "Autonomous is not paused" };
      case "confirm-field": {
        const rt = runtime.current;
        if (!rt) return { ok: false, reason: "No active AR session — enter AR first" };
        if (!rt.fieldPlacing) return { ok: false, reason: "The field is already confirmed — use Re-anchor to adjust it" };
        rt.confirmOrigin(); // applied on the next XR frame when a preview exists
        return { ok: true, detail: `Assembly field confirmed at ${rt.fieldYawDeg.toFixed(1)}°` };
      }
      case "field-left-5":
      case "field-left-1":
      case "field-right-1":
      case "field-right-5":
      case "field-rotate-reset":
        // Handled by the panel (field yaw only; never blocks, steps, verification or the panel).
        return { ok: true, detail: `Field rotation ${runtime.current?.fieldYawDeg.toFixed(1) ?? "?"}°` };
      case "stop-listening":
        stopAllVoice();
        return { ok: true, detail: "Microphone recognition stopped" };
      case "auto": {
        // In-AR Start / Pause / Resume (never requires the 2D slate, which blurs the
        // immersive session). Decided from the runner's synchronous phase, not React state.
        const phase = runner.phase;
        if (phase === "completed")
          return { ok: true, detail: "Assembly complete — no further automatic requests" };
        if (phase === "starting") return { ok: false, reason: "Camera is starting — use Stop Autonomous to cancel" };
        if (phase === "running") {
          pauseAutonomous();
          return { ok: true, detail: "Monitoring paused (camera kept open, no Meta requests)" };
        }
        if (phase === "paused") {
          resumeAutonomous();
          return { ok: true, detail: "Monitoring resumed" };
        }
        if (machineRef.current) {
          // Manual camera mode: no runner, toggle the machine.
          if (autoPaused) resumeAutonomous();
          else pauseAutonomous();
          return { ok: true, detail: autoPaused ? "Resumed" : "Paused" };
        }
        await startAutonomous();
        return { ok: true, detail: "Autonomous Assembly started" };
      }
      case "auto-stop":
        // Distinct full Stop inside immersive AR; XR, field and hologram stay.
        if (!runner.active && runner.phase !== "completed" && !machineRef.current)
          return { ok: false, reason: "Autonomous Assembly is not running" };
        stopAutonomous();
        return { ok: true, detail: "Autonomous Assembly stopped — camera released, no automatic Meta requests" };
    }
  }
  /** Single dispatch path for voice: always records a visible diagnostic. */
  async function dispatchVoiceAction(
    action: VoiceAction,
    transcript: string,
  ): Promise<ExecutionOutcome> {
    setLastCommand(transcript);
    setDiagnostic({ transcript, action, state: "executing" });
    try {
      const outcome = await handleAction(action);
      setDiagnostic({
        transcript,
        action,
        state: outcome.ok ? "completed" : "failed",
        reason: outcome.ok ? undefined : outcome.reason,
        detail: outcome.detail,
      });
      return outcome;
    } catch (cause) {
      const reason = errorMessage(cause);
      setDiagnostic({ transcript, action, state: "failed", reason });
      return { ok: false, reason };
    }
  }
  useEffect(() => {
    // Guided step actions from the AR panel report failures like the 2D card does
    // (shown in the panel message), e.g. a Restart that cannot reach Step 1.
    actionRef.current = (a) =>
      a === "next" || a === "confirm" || a === "finish" || a === "restart" ? void runGuideAction(a) : void handleAction(a);
    dispatchRef.current = (a, t) => dispatchVoiceAction(a, t);
  });

  function enableVoice() {
    if (!voiceSupported.supported || !consent || voiceBusy || micPending.current) return;
    if (voiceRef.current && ["starting", "listening", "stopping"].includes(voiceRef.current.status.state)) return;
    const Ctor = voiceSupported.apiName
      ? (window as unknown as Record<string, SpeechCtor | undefined>)[voiceSupported.apiName]
      : undefined;
    if (!Ctor) {
      setVoice({ state: "unsupported", message: "Speech recognition unavailable in this browser." });
      return;
    }
    voiceRef.current?.dispose();
    setVoiceStatus("");
    setLastCommand("");
    const controller = new VoiceController(
      () => new Ctor(),
      {
        onCommand: (cmd) => {
          controller.gate.setPending(true);
          void dispatchRef.current(cmd.action, cmd.phrase)
            .catch((e) => {
              if (alive.current) setVoiceStatus(`Command failed: ${errorMessage(e)}`);
            })
            .finally(() => controller.gate.setPending(false));
        },
        onStateChange: (snapshot) => {
          if (alive.current && voiceRef.current === controller) setVoice(snapshot);
        },
      },
      { lang: voiceLang },
    );
    voiceRef.current = controller;
    controller.start();
  }

  /** `consented` lets the in-AR Confirm Voice tap start immediately (state updates are async). */
  function enableLocalVoice(consented = localConsent) {
    if (!consented || localOn || localRef.current?.isBusy || voiceBusy || micPending.current) return;
    setLocalBusy(true);
    setVoiceError("");
    localRef.current?.dispose();
    const controller = new LocalVoiceController({
      language: voiceLang.startsWith("de") ? "de" : "en",
      onCommand: (cmd) => dispatchRef.current(cmd.action, cmd.phrase),
      onDiagnostic: (d) => {
        if (alive.current) setDiagnostic(d);
      },
      onCaptureDiagnostic: (d) => {
        if (alive.current) setCaptureDiag(d);
      },
      onStatus: (s) => {
        if (alive.current) setLocalStatus(s);
      },
      onError: (s) => {
        if (alive.current) {
          setLocalStatus(s);
          setVoiceError(s); // shown in the AR panel — never a silent "Off"
          setLocalOn(controller.isListening);
        }
      },
      onListeningChange: (listening) => {
        if (alive.current) setLocalOn(listening);
      },
    });
    localRef.current = controller;
    void controller.start().then((ok) => {
      if (alive.current && localRef.current === controller) {
        setLocalBusy(false);
        if (!ok) setLocalOn(false);
        // Started inside immersive AR: tell the controller (keeps the stream, AR status).
        else if (runtime.current) controller.setXRActive(true);
      }
    });
  }

  async function recordOneLocalCommand() {
    if (!localConsent || localOn || localRef.current?.isBusy || voiceBusy || micPending.current) return;
    setLocalBusy(true);
    // A new explicit recording uses the currently selected language.
    localRef.current?.dispose();
    const controller = new LocalVoiceController({
      language: voiceLang.startsWith("de") ? "de" : "en",
      onCommand: (cmd) => dispatchRef.current(cmd.action, cmd.phrase),
      onDiagnostic: (d) => {
        if (alive.current) setDiagnostic(d);
      },
      onCaptureDiagnostic: (d) => {
        if (alive.current && localRef.current === controller) setCaptureDiag(d);
      },
      onStatus: (s) => {
        if (alive.current && localRef.current === controller) setLocalStatus(s);
      },
      onError: (s) => {
        if (alive.current && localRef.current === controller) setLocalStatus(s);
      },
    });
    localRef.current = controller;
    try { await controller.recordOnce(); }
    finally { if (alive.current && localRef.current === controller) setLocalBusy(false); }
  }


  /* ---------------- Autonomous Assembly (camera-driven) ----------------
   * The machine never verifies anything itself. It triggers the existing
   * /api/inspect and /api/verify pipeline with genuinely fresh frames and
   * advances only after server progress confirms `verified`. */
  function syncAutoLabel() {
    const m = machineRef.current;
    if (m) setAutoStateLabel(m.state);
  }
  /** Advance exactly one step, and only when SERVER progress says the current step is verified. */
  async function advanceIfVerified(): Promise<void> {
    const m = machineRef.current;
    const stepId = viewRef.current.step_id;
    if (advancingRef.current || !stepId || !project) return;
    advancingRef.current = true;
    try {
      const progress = await getProgress(projectId);
      if (viewRef.current.step_id !== stepId) return; // moved meanwhile: never advance twice
      const row = progress.find((r) => r.step_id === stepId);
      if (row?.status !== "verified") return;
      const index = project.steps.findIndex((x) => x.id === stepId);
      const isLast = index >= 0 && index === project.steps.length - 1;
      if (m) {
        m.serverVerified(projectId, stepId);
        if (!m.confirmAdvance(isLast)) return;
        syncAutoLabel();
      }
      if (isLast) {
        setAutoStatus("ASSEMBLY COMPLETE — all steps verified by the backend. Automatic Meta requests stopped; the anchored hologram stays until you exit AR.");
        if (m) finishAutonomous();
        return;
      }
      setAutoStatus(`STEP VERIFIED — Step ${project.steps[index].position} confirmed by the backend. Loading next step…`);
      // Bound to the verified origin step and its fixed successor (idempotent with two devices).
      const outcome = await navigate(1, stepId);
      if (outcome.ok && viewRef.current.step_id && viewRef.current.step_id !== stepId) {
        autoWorkflow.current = null;
        if (m) {
          m.onAdvanced(viewRef.current.step_id);
          controllerRef.current?.onStepChanged(viewRef.current.step_id);
        }
      } else if (!outcome.ok) {
        setAutoStatus(`Verified, but automatic advance failed: ${outcome.reason ?? "unknown"}. Use Next Step.`);
      }
      syncAutoLabel();
    } catch {
      setAutoStatus("Could not confirm server progress; automatic advance waits for the next update.");
    } finally {
      advancingRef.current = false;
    }
  }

  /**
   * Re-anchor: discards the placement AND invalidates every prepared automatic
   * capture/request (the anchor epoch changes; the in-flight Autonomous browser
   * request is cancelled). A manual check is not touched.
   */
  function reanchorField() {
    autoOwnedAbort.current?.abort();
    runtime.current?.reset();
  }
  /** Switch the AR panel view (panel only — never the field or anchor). */
  function showPanelView(mode: PanelView) {
    setResultMode(mode);
    runtime.current?.setViewMode(mode);
  }
  /** Decode one capture for the panel; a late decode for a superseded id is closed, never shown. */
  async function decodeCapture(rt: SpatialSession, record: CaptureRecord) {
    try {
      const bitmap = await createImageBitmap(snapshotFile(record, "capture-preview.jpg"));
      if (runtime.current !== rt || !previews.wants(record.id) || !rt.setCaptureBitmap(record.id, bitmap)) bitmap.close();
    } catch {
      /* the panel keeps its explicit "Decoding…" placeholder */
    }
  }
  /** Autonomous burst rejected every candidate: show the (unsent) frame and why. */
  function previewRejected(preview: Snapshot | null, reason: string) {
    const stepId = viewRef.current.step_id;
    if (!preview || !stepId) return;
    const id = previews.begin({
      projectId, stepId, intent: "none",
      source: `${cameraSource === "external" ? "external" : "hololens"} camera`,
      capturedAt: preview.capturedAt, width: preview.width, height: preview.height, dataUrl: preview.dataUrl,
      phase: "rejected", detail: reason,
    });
    void snapshotFingerprint(preview.dataUrl).then((fingerprint) => previews.update(id, { fingerprint })).catch(() => {});
    showPanelView("camera");
  }
  type InARResult = {
    overallStatus: "correct" | "incorrect" | "uncertain" | "error";
    verificationStatus?: string;
    failure?: FailureKind;
    message?: string;
    stale?: boolean;
    needsView?: boolean;
  };
  /** Visual verdict of a manual in-AR result for the Autonomous machine (null = nothing to adopt). */
  function manualVerdictOf(d: InARResult): "correct" | "incorrect" | "uncertain" | null {
    if (d.stale || d.overallStatus === "error") return null;
    if (d.verificationStatus === "verified") return null; // server progress handles the advance
    if (d.verificationStatus === "uncertain") return "uncertain";
    if (d.verificationStatus === "still_incorrect") return "incorrect";
    return d.overallStatus;
  }
  /** Visual verdict of a stored/external summary (verified/error/inspecting adopt nothing). */
  function summaryVerdictOf(summary: InspectionSummary): "correct" | "incorrect" | "uncertain" | null {
    if (summary.kind === "error" || summary.kind === "inspecting" || summary.verificationStatus === "verified") return null;
    const kind = summary.overall?.kind ?? summary.status;
    if (summary.kind === "verification") return kind === "incorrect" || summary.verificationStatus === "still_incorrect" ? "incorrect" : kind === "verified" ? null : "uncertain";
    return kind === "correct" || kind === "incorrect" || kind === "uncertain" ? kind : null;
  }
  /** The result asks for evidence the frame did not contain (print/face/active view). */
  function needsAnotherView(summary: InspectionSummary): boolean {
    return !!summary.activeVision || summary.overall?.printGate === "uncertain" || summary.overall?.faceStatus === "uncertain";
  }
  /** One in-AR inspection/verification against the existing Meta pipeline.
   *  Captures nothing itself — the caller supplies a genuinely fresh frame.
   *  Never ends the XR session. Returns the combined overall outcome. */
  async function performInARInspection(
    intent: "inspect" | "verify",
    frame: import("@/types/assembly").Snapshot,
    stepId: string,
    opts: {
      cameraSource?: string; quality?: FrameQuality; frameFresh?: boolean; selection?: string; roiPx?: SelectedFrame["roiPx"]; origin?: "auto" | "manual";
      /** Run guard of the caller (Autonomous: not stopped/paused/superseded, tracking + anchor still valid). */
      mayUpload?: () => boolean;
    } = {},
  ): Promise<InARResult> {
    const lease = coordinatorRef.current.acquire(projectId, stepId, intent);
    if (lease === null)
      return { overallStatus: "error", failure: "conflict", message: "Another inspection already holds this step; nothing was sent." };
    // A result is applied only while its lease and step are still current.
    const current = () => coordinatorRef.current.accepts(lease, projectId, stepId) && viewRef.current.step_id === stepId;
    const stale: InARResult = { overallStatus: "error", failure: "stale", stale: true, message: "The step changed while the request ran; its result was discarded." };
    // Register the run (and its AbortController) BEFORE the first await, so Stop
    // during fingerprinting / image preparation cancels it and no upload starts.
    const run = new UploadRun(() => current() && (opts.mayUpload?.() ?? true));
    const controller = run.controller;
    autoAbort.current = controller;
    if (opts.origin === "auto") autoOwnedAbort.current = controller;
    const settle = () => {
      coordinatorRef.current.release(lease);
      if (autoAbort.current === controller) autoAbort.current = null;
      if (autoOwnedAbort.current === controller) autoOwnedAbort.current = null;
    };
    /** The run closed before any upload: nothing was sent to Meta. */
    const notSent = (previewId: number): InARResult => {
      settle();
      const superseded = !controller.signal.aborted && !current();
      previews.finish(previewId, "rejected",
        superseded ? "The step changed before upload — nothing was sent to Meta." : "Stopped before upload — nothing was sent to Meta.",
        "not sent to Meta");
      return superseded ? stale : { overallStatus: "error", failure: "aborted", message: "Cancelled before upload; nothing was sent to Meta." };
    };
    const source = opts.cameraSource ?? cameraSource;
    const trace = new InspectionTrace(source, projectId, stepId);
    trace.stage("CAPTURE_REQUESTED", `${intent} requested`);
    trace.stage("CAMERA_SOURCE_SELECTED", source);
    trace.stage("CAMERA_AVAILABLE", "live video track");
    trace.stage("FRAME_CAPTURED", `${frame.width}x${frame.height} at ${frame.capturedAt}`);
    trace.data.capturedAt = frame.capturedAt;
    trace.data.width = frame.width;
    trace.data.height = frame.height;
    trace.data.frameFresh = opts.frameFresh ?? true;
    trace.data.encodedBytes = encodedByteSize(frame.dataUrl);
    // Preview = the exact snapshot object that is validated and uploaded below.
    const previewId = previews.begin({
      projectId, stepId, source, intent,
      capturedAt: frame.capturedAt, width: frame.width, height: frame.height, dataUrl: frame.dataUrl,
      detail: opts.selection ? `Selected ${opts.selection}` : "Checking freshness, resolution and content…",
    });
    showPanelView("camera");
    try { trace.data.correlationId = await snapshotFingerprint(frame.dataUrl); } catch { /* fingerprint best-effort */ }
    if (!run.open) return notSent(previewId); // Stop/Pause/step change/tracking loss while fingerprinting
    previews.update(previewId, { fingerprint: trace.data.correlationId ?? null });
    setLastFrame({ dataUrl: frame.dataUrl, source, capturedAt: frame.capturedAt, fingerprint: trace.data.correlationId ?? "unavailable", width: frame.width, height: frame.height });
    if (opts.quality && !opts.quality.ok) {
      trace.data.frameQuality = opts.quality.reason;
      trace.data.metaCalled = false;
      trace.fail(`FRAME_VALIDATED failed: ${opts.quality.reason}. No image was sent to Meta.`);
      settle();
      trace.save();
      setLastTrace({ ...trace.data });
      const summary = autoErrorSummary(projectId, stepId, `CAMERA ERROR — no usable camera frame: ${opts.quality.reason}. Nothing was sent to Meta.`);
      saveInspectionSummary(summary);
      setResultSummary(summary);
      previews.finish(previewId, "rejected", `Rejected before upload: ${opts.quality.reason}`, "not sent to Meta");
      resultBinding.current = { summary, id: previewId };
      return { overallStatus: "error", failure: "camera", message: opts.quality.reason };
    }
    trace.stage("FRAME_VALIDATED", `${opts.selection ?? opts.quality?.reason ?? "dimensions and encoding validated"}${opts.roiPx ? ` · scoring ROI x${opts.roiPx.x} y${opts.roiPx.y} ${opts.roiPx.w}×${opts.roiPx.h} px (image centre, not projected from the field); the FULL frame is uploaded` : ""}`);
    trace.stage("UPLOAD_STARTED", `${trace.data.encodedBytes} bytes JPEG`);
    trace.stage("META_REQUEST_STARTED", "existing /api/inspect|verify pipeline");
    const causeOf = (sm: { kind: string; state: string | null; status: string | null; overall: { printGate: string | null; faceStatus: string | null; geometryStatus: string | null } | null }) =>
      classifyUncertain({ kind: sm.kind, state: sm.state, status: sm.status, printGate: sm.overall?.printGate, faceStatus: sm.overall?.faceStatus, geometryStatus: sm.overall?.geometryStatus, geometryConstrained: !!sm.overall?.geometryStatus });
    const finishTrace = (summary: ReturnType<typeof summarizeInspection> | null, model?: string, attempts?: number, latency?: number) => {
      const traceSummary: TraceSummary = {
        correlationId: trace.data.correlationId,
        inspectionId: summary?.inspectionId ?? null,
        cameraSource: source,
        capturedAt: frame.capturedAt,
        width: frame.width, height: frame.height,
        frameFresh: trace.data.frameFresh,
        metaCalled: true,
        metaModel: model ?? null,
        metaAttempts: attempts ?? null,
        metaLatencyMs: latency ?? null,
        uncertainCause: null, uncertainReason: null,
      };
      if (summary) {
        const c = causeOf(summary);
        if (c.cause !== "none") { traceSummary.uncertainCause = c.cause; traceSummary.uncertainReason = c.reason; }
      }
      trace.data.metaCalled = true;
      trace.data.metaModel = traceSummary.metaModel;
      trace.data.metaAttempts = traceSummary.metaAttempts;
      trace.data.metaLatencyMs = traceSummary.metaLatencyMs;
      trace.data.inspectionId = traceSummary.inspectionId;
      trace.data.semanticStatus = summary?.status ?? null;
      trace.data.printGate = summary?.overall?.printGate ?? null;
      trace.data.faceStatus = summary?.overall?.faceStatus ?? null;
      trace.data.geometryStatus = summary?.overall?.geometryStatus ?? null;
      trace.data.combinedState = summary?.state ?? null;
      trace.data.uncertainCause = traceSummary.uncertainCause;
      trace.data.uncertainReason = traceSummary.uncertainReason;
      trace.data.httpOk = true;
      trace.stage("META_RESPONSE_RECEIVED", model ?? "validated response");
      trace.stage("META_RESPONSE_VALIDATED", "snapshot/spec identity checked by existing validators");
      trace.stage("INSPECTION_FUSED", summary?.state ?? "no workflow state");
      trace.stage("RESULT_DELIVERED_TO_AR", "validated summary in AR panel");
      trace.stage("AR_RESULT_RENDERED", "result view");
      trace.save();
      setLastTrace({ ...trace.data });
      return traceSummary;
    };
    if (!run.open) return notSent(previewId); // final check before the in-progress state and upload
    const inProgress = inspectingSummary(projectId, stepId);
    saveInspectionSummary(inProgress);
    setResultSummary(inProgress);
    resultBinding.current = { summary: inProgress, id: previewId }; // new image never pairs with an old result
    const completed = (summary: InspectionSummary | null, attempts?: number, latencyMs?: number) => {
      const headline = summary ? resultHeadline(summary, false)?.text ?? "response received" : "response received";
      previews.finish(previewId, "complete",
        `Meta response received${attempts ? ` · ${attempts} provider attempt(s)` : ""}${latencyMs ? ` · ${(latencyMs / 1000).toFixed(1)} s` : ""} (backend-reported)`,
        headline);
      if (summary) resultBinding.current = { summary, id: previewId };
      showPanelView("result");
    };
    previews.update(previewId, {
      phase: "uploading",
      sent: true,
      detail: "Upload + backend inspection running (Muse, print/face/geometry checks). The backend reports no intermediate progress.",
    });
    try {
      if (intent === "verify" && autoWorkflow.current && autoWorkflow.current.step_id === stepId) {
        const workflow = autoWorkflow.current;
        const sending = run.upload((signal) => verifySnapshot(projectId, workflow, frame, signal));
        if (!sending) return notSent(previewId);
        const verification = await sending;
        if (controller.signal.aborted) { previews.update(previewId, { phase: "failed", detail: "Request cancelled" }); return { overallStatus: "error", failure: "aborted", message: "Cancelled" }; }
        if (!current()) { previews.update(previewId, { phase: "stale", detail: "The step changed while the request ran — this result was discarded." }); return stale; }
        autoWorkflow.current = verification.inspection;
        saveLastInspection({ projectId, stepId, inspectionId: verification.inspection.inspection_id });
        const summary = summarizeVerification(verification, projectId,
          finishTrace(null, verification.inspection.model, verification.inspection.meta_attempt_count, verification.inspection.model_latency_ms));
        // finishTrace needs the summary for cause classification; rebuild with it.
        const traced = summarizeVerification(verification, projectId, { ...summary.trace!, uncertainCause: causeOf(summary).cause === "none" ? null : causeOf(summary).cause, uncertainReason: causeOf(summary).reason || null });
        saveInspectionSummary(traced);
        setResultSummary(traced);
        completed(traced, verification.inspection.meta_attempt_count, verification.inspection.model_latency_ms);
        return {
          verificationStatus: verification.status,
          overallStatus: verification.status === "verified" ? "correct" : verification.status === "still_incorrect" ? "incorrect" : "uncertain",
          needsView: needsAnotherView(traced),
        };
      }
      const sending = run.upload((signal) => inspectSnapshot(projectId, stepId, frame, signal));
      if (!sending) return notSent(previewId);
      const diagnosis = await sending;
      if (controller.signal.aborted) { previews.update(previewId, { phase: "failed", detail: "Request cancelled" }); return { overallStatus: "error", failure: "aborted", message: "Cancelled" }; }
      if (!current()) { previews.update(previewId, { phase: "stale", detail: "The step changed while the request ran — this result was discarded." }); return stale; }
      const workflow = isWorkflowInspection(diagnosis, stepId) ? diagnosis : null;
      if (workflow) {
        autoWorkflow.current = workflow;
        saveLastInspection({ projectId, stepId, inspectionId: workflow.inspection_id });
      }
      const traceSummary = workflow ? finishTrace(null, workflow.model, workflow.meta_attempt_count, workflow.model_latency_ms) : null;
      const baseSummary = workflow ? summarizeInspection(workflow, projectId, "inspection", null, traceSummary) : null;
      const summary = baseSummary && traceSummary ? summarizeInspection(workflow!, projectId, "inspection", null, {
        ...traceSummary,
        uncertainCause: causeOf(baseSummary).cause === "none" ? null : causeOf(baseSummary).cause,
        uncertainReason: causeOf(baseSummary).reason || null,
      }) : baseSummary;
      if (summary) { saveInspectionSummary(summary); setResultSummary(summary); }
      completed(summary, workflow?.meta_attempt_count, workflow?.model_latency_ms);
      const overallStatus = workflow
        ? workflow.state === "correct" ? "correct"
          : ["correction_required", "still_incorrect"].includes(workflow.state) ? "incorrect"
          : "uncertain"
        : diagnosis.status;
      return {
        overallStatus: overallStatus === "correct" ? "correct" : overallStatus === "incorrect" ? "incorrect" : "uncertain",
        needsView: summary ? needsAnotherView(summary) : true,
      };
    } catch (cause) {
      if (controller.signal.aborted) { previews.update(previewId, { phase: "failed", detail: "Request cancelled" }); return { overallStatus: "error", failure: "aborted", message: "Cancelled" }; }
      if (!current()) { previews.update(previewId, { phase: "stale", detail: "The step changed while the request ran — this result was discarded." }); return stale; }
      const failure = classifyFailure(cause);
      trace.data.metaCalled = false;
      trace.data.httpOk = false;
      trace.fail(`${failureHeadline(failure)}: request failed before a validated Meta result: ${errorMessage(cause)}`);
      trace.save();
      setLastTrace({ ...trace.data });
      const summary = autoErrorSummary(projectId, stepId, `${failureHeadline(failure)} — ${errorMessage(cause)}`);
      saveInspectionSummary(summary);
      setResultSummary(summary);
      previews.finish(previewId, "failed", `${failureHeadline(failure)} — ${errorMessage(cause)}`, failureHeadline(failure));
      resultBinding.current = { summary, id: previewId };
      showPanelView("result");
      return { overallStatus: "error", failure, message: errorMessage(cause) };
    } finally {
      settle();
    }
  }
  /** "Inspect Now": one explicit request through the same guarded controller. */
  async function runAutoTrigger(): Promise<void> {
    const controller = controllerRef.current;
    if (controller) {
      const outcome = await controller.inspectNow();
      setAutoStatus(`${controller.status.headline} — ${controller.status.detail || outcome}`);
      syncAutoLabel();
      return;
    }
    if (active) {
      // Never leave immersive AR implicitly; the camera workspace is outside XR.
      setAutoStatus("CAMERA ERROR — no live camera monitor in AR. Use Verify Step on the panel, or start Autonomous Assembly with a camera source.");
      return;
    }
    if (cameraSource === "manual") {
      setAutoStatus("Manual capture: opening the camera workspace for one fresh inspection frame.");
      await verify(machineRef.current?.nextIntent === "verify" ? "verify" : "inspect");
    }
  }

  /* -------- Verify Step inside immersive AR (never exits XR) -------- */
  async function verifyInAR(mode: "inspect" | "verify" = "inspect"): Promise<ExecutionOutcome> {
    return (await captureCheck(mode)).outcome;
  }
  /**
   * One real capture + existing Meta inspection/verification. In AR (or with
   * `inPage` on the 2D page) it uses this device's camera and never leaves
   * the page; `advance` controls automatic navigation after verification.
   */
  async function captureCheck(
    mode: "inspect" | "verify",
    opts: { inPage?: boolean; advance?: boolean } = {},
  ): Promise<{ outcome: ExecutionOutcome; result: InARResult | null }> {
    const done = (outcome: ExecutionOutcome, result: InARResult | null = null) => ({ outcome, result });
    if (!active && !opts.inPage) return done(await verify(mode)); // explicit camera-workspace flow only outside XR
    if (coordinatorRef.current.busy)
      return done({ ok: false, reason: "An inspection is already running for this step — wait for its result in the panel" });
    if (!view.step_id || !project) return done({ ok: false, reason: "Current step is unknown" });
    const stepId = view.step_id;
    setStatus("Verify Step: capturing a fresh camera frame inside AR…");
    // 1) Try a real camera while XR stays active (live monitor or new probe).
    let monitor = monitorRef.current;
    let created = false;
    if (!monitor?.live) {
      monitor = new MonitorCamera();
      created = true;
      try {
        await monitor.start(cameraSource === "external" && camDeviceId ? camDeviceId : undefined);
        const verdict = await monitor.probe(active, 900);
        if (verdict.status === "unavailable" || verdict.status === "stalled") {
          monitor.stop();
          return done(active ? await requestExternalFallback(mode, verdict.reasons.join(" ")) : { ok: false, reason: `Camera unavailable: ${verdict.reasons.join(" ")}` });
        }
        monitorRef.current = monitor;
      } catch (cause) {
        return done(active ? await requestExternalFallback(mode, errorMessage(cause)) : { ok: false, reason: `Camera unavailable: ${errorMessage(cause)}` });
      }
    }
    // 2) Freshness: the frame clock must advance between two samples.
    const first = monitor.sample();
    await new Promise((r) => setTimeout(r, 300));
    const second = monitor.sample();
    if (!first || !second || second.frameTime <= first.frameTime) {
      if (created) { monitor.stop(); if (monitorRef.current === monitor) monitorRef.current = null; }
      return done(active ? await requestExternalFallback(mode, "Camera frames are not advancing inside immersive AR.") : { ok: false, reason: "Camera frames are not arriving." });
    }
    const validated = monitor.captureValidated();
    const frame = validated?.snapshot ?? null;
    if (created && !autoOn) { monitor.stop(); if (monitorRef.current === monitor) monitorRef.current = null; }
    if (!frame || frame.width < 160 || frame.height < 120)
      return done({ ok: false, reason: "Camera unavailable in immersive AR. Connect an external camera or select a supported camera source." });
    setStatus("Inspecting with Meta AI inside AR — the session and anchored field stay active…");
    const intent = mode === "verify" && autoWorkflow.current ? "verify" : "inspect";
    const d = await performInARInspection(intent, frame, stepId, { quality: validated?.quality, frameFresh: true });
    if (d.stale) return done({ ok: false, reason: "The step changed while Meta was running; that result was discarded" }, d);
    if (d.failure === "camera")
      return done({ ok: false, reason: `Captured frame rejected before upload: ${d.message ?? "unusable frame"}. Nothing was sent to Meta — see the Camera view.` }, d);
    if (d.overallStatus === "error")
      return done({ ok: false, reason: `${failureHeadline(d.failure ?? "backend")} — see the result panel; AR and the anchored field are unchanged` }, d);
    // Keep Autonomous consistent with EVERY manual verdict — also an uncertain or
    // still-incorrect verification — so it never sends its own frame afterwards.
    const manualVerdict = manualVerdictOf(d);
    if (manualVerdict) controllerRef.current?.adoptManual(manualVerdict, stepId, !!d.needsView);
    if (d.verificationStatus === "verified") {
      setVerification({ step: stepId, verified: true }); // backend response is authoritative; the poll confirms
      if (opts.advance ?? true) {
        await advanceIfVerified();
        return done({ ok: true, detail: "Step verified by the backend — advancing inside AR" }, d);
      }
      return done({ ok: true, detail: "Step correct (verified by the backend)" }, d);
    }
    return done({
      ok: d.overallStatus !== "incorrect",
      reason: d.overallStatus === "incorrect" ? "Correction required — see the AR result panel" : undefined,
      detail: d.overallStatus === "correct"
        ? "Looks correct — a separate fresh verification is still required (Verify Again)"
        : d.overallStatus === "incorrect" ? "Incorrect — correction shown in the AR panel; remain on this step"
        : "Uncertain — another view needed; AR session unchanged",
    }, d);
  }

  /**
   * Guided Check Step / Check Again: a fresh inspection; if it is correct,
   * a SEPARATE later frame is verified by the backend. Never auto-advances
   * (the user taps Next Step) unless Autonomous Assembly is on.
   */
  async function checkStep(): Promise<ExecutionOutcome> {
    if (checkingRef.current) return { ok: false, reason: "Check already in progress" };
    const stepId = viewRef.current.step_id;
    if (!stepId) return { ok: false, reason: "Current step is unknown" };
    checkingRef.current = true;
    setCheckingStep(true);
    setCheckError(null);
    // A check that cannot even capture (camera/busy) must be visible as such, with the fallback.
    const failedBeforeInspection = (run: { outcome: ExecutionOutcome; result: InARResult | null }) => {
      if (!run.outcome.ok && !run.result && alive.current)
        setCheckError({ stepId, message: `Check unavailable: ${run.outcome.reason ?? "unknown error"}` });
      return run.outcome;
    };
    const epoch = runEpochRef.current; // Restart Assembly ends this check's run
    try {
      const first = await captureCheck("inspect", { inPage: true, advance: autoOn });
      const r = first.result;
      if (runEpochRef.current !== epoch) return { ok: false, reason: "Assembly restarted; this check was discarded" };
      if (!r || r.overallStatus !== "correct" || r.verificationStatus || viewRef.current.step_id !== stepId)
        return failedBeforeInspection(first);
      await new Promise((resolve) => setTimeout(resolve, 2000)); // a genuinely later, separate frame
      if (runEpochRef.current !== epoch) return { ok: false, reason: "Assembly restarted; this check was discarded" };
      if (viewRef.current.step_id !== stepId) return { ok: false, reason: "Step changed" };
      return failedBeforeInspection(await captureCheck("verify", { inPage: true, advance: autoOn }));
    } finally {
      checkingRef.current = false;
      if (alive.current) setCheckingStep(false);
    }
  }
  /**
   * Finish (last step only): re-reads SERVER progress and completes the existing
   * flow only when the last step is verified there. Never moves the cursor, never
   * marks anything verified, never skips a step; Autonomous is completed as usual.
   */
  async function finishAssembly(): Promise<ExecutionOutcome> {
    const runEpoch = runEpochRef.current;
    const xrSession = runtime.current;
    const anchorEpoch = xrSession?.anchorEpoch;
    const issuedSpec = specRef.current;
    if (xrSession && !["anchored", "tracking_degraded"].includes(xrSession.anchorState))
      return { ok: false, reason: "Confirm the assembly field before Finish" };
    const stepId = viewRef.current.step_id;
    if (!project || !stepId) return { ok: false, reason: "Project is still loading" };
    const index = project.steps.findIndex((s) => s.id === stepId);
    if (index < 0 || index !== project.steps.length - 1)
      return { ok: false, reason: "Finish is only available on the last step — use Next Step" };
    if (coordinatorRef.current.busy || checkingRef.current || extTracker.current) return { ok: false, reason: "Inspection running — wait for the result" };
    try {
      const progress = await getProgress(projectId);
      if (!alive.current || runEpoch !== runEpochRef.current || xrSession !== runtime.current || anchorEpoch !== runtime.current?.anchorEpoch || issuedSpec !== specRef.current || coordinatorRef.current.busy || checkingRef.current || extTracker.current)
        return { ok: false, reason: "Assembly context changed or inspection running — select Finish again" };
      if (viewRef.current.step_id !== stepId) return { ok: false, reason: "The step changed meanwhile; nothing was finished" };
      if (progress.find((r) => r.step_id === stepId)?.status !== "verified")
        return { ok: false, reason: "The last step is not verified yet — select Check Again" };
      const done = project.steps.filter((s) => progress.find((r) => r.step_id === s.id)?.status === "verified").length;
      setFinishedFor(stepId);
      setResultMode("guide");
      setHelpVisible(false);
      runtime.current?.showCompletion();
      if (runner.active) finishAutonomous();
      setStatus(`Assembly complete — ${done} of ${project.steps.length} steps verified by the backend.`);
      return { ok: true, detail: `Assembly complete — ${done} of ${project.steps.length} steps verified` };
    } catch (cause) {
      return { ok: false, reason: `Progress unavailable: ${errorMessage(cause)}` };
    }
  }
  /**
   * End everything of the current local run (this device): Autonomous (also a
   * completed runner), voice, external-camera poll and in-flight requests; late
   * answers lose their lease and the run epoch; the shown result, captured frame,
   * stored summary/last inspection and completion state are cleared. Starts nothing.
   */
  function resetLocalRun(autoMessage: string) {
    runtime.current?.clearCompletion();
    runEpochRef.current += 1;
    if (runner.active || runner.phase === "completed" || machineRef.current) stopAutonomous(autoMessage);
    autoAbort.current?.abort();
    autoOwnedAbort.current?.abort();
    coordinatorRef.current.invalidateStep(); // a late manual/auto answer no longer holds a lease
    if (extTracker.current) {
      extTracker.invalidate();
      setExtPending(false);
    }
    stopAllVoice(true);
    previews.invalidate();
    resultBinding.current = { summary: null, id: 0 };
    clearInspectionSummary();
    clearLastInspection(); // an old inspection id can never base a verification
    clearVoiceVerifyIntent();
    setResultSummary(null);
    setLastTrace(null);
    setLastFrame(null);
    setShowFrame(false);
    setResultMode("guide");
    runtime.current?.setViewMode("guide");
    setCheckError(null);
    setManualConfirm(null);
    setFinishedFor(null);
    setLastGuideOutcome("");
    setVerification({ step: "", verified: false });
    autoWorkflow.current = null;
  }
  /** Adopt the run's Step-1 cursor and show the "New assembly started" notice briefly. */
  function enterNewRun(run: { run_id: string | null }, v: ViewedStep) {
    runIdRef.current = run.run_id;
    setHologram(EMPTY_HOLOGRAM);
    runtime.current?.setReferenceImage(null);
    viewRef.current = v;
    setViewed(v);
    const notice = Date.now();
    setNewRunNotice(notice);
    setTimeout(() => {
      if (alive.current) setNewRunNotice((current) => (current === notice ? null : current));
    }, NEW_RUN_NOTICE_MS);
  }
  /**
   * Restart Assembly (after Finish): a REAL new assembly run. The backend starts a
   * new run (history kept) and puts the shared cursor on Step 1 atomically; the run
   * id is part of every step's specification identity, so all steps are unverified
   * again and any request begun in the old run fails its final identity check (409).
   * Locally the old run is ended completely (see resetLocalRun). Starts NO camera,
   * Meta, retry, verification or voice action. Project, blocks, references,
   * instructions, placements and calibration are untouched; XR state is kept.
   */
  async function restartAssembly(): Promise<ExecutionOutcome> {
    if (!project || !project.steps.length) return { ok: false, reason: "Project is still loading" };
    if (!online) return { ok: false, reason: "Project state unavailable (offline) — Restart Assembly needs the backend. Check the connection and try again." };
    resetLocalRun("Assembly restarted — Autonomous Assembly stopped. Start it again when ready.");
    let joined = false;
    try {
      let started: { run_id: string | null; view: ViewedStep };
      try {
        const expected = runIdRef.current === undefined ? (await getAssemblyRun(projectId)).run_id : runIdRef.current;
        started = await startAssemblyRun(projectId, expected);
      } catch (cause) {
        if (!isRevisionConflict(cause)) throw cause;
        // Another device restarted first: join ITS new run instead of stacking another one.
        const [run, v] = await Promise.all([getAssemblyRun(projectId), getView(projectId)]);
        started = { run_id: run.run_id, view: v };
        joined = true;
      }
      if (!alive.current) return { ok: false, reason: "Page closed" };
      enterNewRun(started, started.view);
    } catch (cause) {
      return { ok: false, reason: `Restart Assembly failed: ${errorMessage(cause)}. Nothing was changed on the server — try again.` };
    }
    const first = project.steps[0];
    const where = runtime.current && active
      ? "The confirmed AR field is kept; Step 1 guidance is shown."
      : "Select Enter immersive AR to continue in AR.";
    setStatus(`New assembly started${joined ? " (joined the run another device started)" : ""} — Step ${first.position} of ${project.steps.length}, no steps verified. ${where} Nothing is checked until you select Check Step.`);
    return { ok: true, detail: `New assembly started — Step ${first.position} of ${project.steps.length}, no steps verified` };
  }
  /** Visible manual fallback (Confirm Position): user-confirmed, never AI/backend-verified. */
  function confirmPosition(): ExecutionOutcome {
    const stepId = viewRef.current.step_id;
    if (!stepId) return { ok: false, reason: "Current step is unknown" };
    if (!["partial", "error"].includes(guide.state))
      return { ok: false, reason: "Confirm Position is only available when the automatic check is uncertain" };
    setManualConfirm({ stepId, at: new Date().toISOString() });
    return {
      ok: true,
      detail: isLastStep
        ? "Position confirmed by you (not AI verified). This was the final step."
        : "Position confirmed by you (not AI verified). Next Step is now available.",
    };
  }

  async function requestExternalFallback(mode: "inspect" | "verify", why: string): Promise<ExecutionOutcome> {
    const code = pairingCode && validPairingCode(pairingCode) ? pairingCode : newPairingCode();
    if (code !== pairingCode) setPairingCode(code);
    if (!view.step_id) return { ok: false, reason: "Current step is unknown" };
    const stepId = view.step_id;
    const issuedSpec = specRef.current;
    extTracker.invalidate(); // a new request supersedes any earlier one immediately
    try {
      const requestId = await requestExternalCapture(projectId, stepId, code, mode);
      if (!alive.current || viewRef.current.step_id !== stepId || specRef.current !== issuedSpec)
        return { ok: false, reason: "The step changed while the external capture was requested; nothing is awaited." };
      extTracker.begin({ requestId, projectId, stepId, code, spec: issuedSpec });
      pairingRef.current = code;
      setExtPending(true);
      setAutoStatus(`Camera unavailable in immersive AR (${why}) Connect an external camera: open this project page on the MacBook/iPhone, enter pairing code ${code}, and start the external camera companion. The result will appear here — you stay in AR.`);
      setStatus("External camera capture requested. Stay in AR; the result will appear in the panel.");
      return { ok: false, reason: `Camera unavailable in immersive AR — external capture requested (pairing code ${code}). Result will appear in the panel.` };
    } catch (cause) {
      setAutoStatus(`Camera unavailable in immersive AR. Connect an external camera or select a supported camera source. (${errorMessage(cause)})`);
      return { ok: false, reason: "Camera unavailable in immersive AR. Connect an external camera or select a supported camera source." };
    }
  }

  /* -------- External camera companion (runs on MacBook/iPhone page) -------- */
  async function runCompanionOnce() {
    if (!validPairingCode(pairingCode) || !view.step_id) return;
    try {
      const pending = await pendingExternalRequests(projectId, pairingCode);
      for (const request of pending) {
        await claimExternalRequest(request.id, pairingCode);
        let monitor = monitorRef.current;
        if (!monitor?.live) {
          monitor = new MonitorCamera();
          companionCameraRef.current = monitor; // owner known before the first await
          await monitor.start(cameraSource === "external" && camDeviceId ? camDeviceId : undefined);
          if (!alive.current || companionCameraRef.current !== monitor) {
            monitor.stop(); // page left or companion stopped while the camera opened
            return;
          }
          monitorRef.current = monitor;
        }
        const validated = monitor.captureValidated();
        if (!validated) continue;
        const d = await performInARInspection(request.mode === "verify" && autoWorkflow.current ? "verify" : "inspect", validated.snapshot, request.step_id, { quality: validated.quality, frameFresh: true });
        const summary = loadInspectionSummary(projectId, request.step_id);
        if (summary) await postExternalResult(request.id, pairingCode, summary);
        setAutoStatus(d.overallStatus === "error"
          ? "Companion inspection failed; the HoloLens was notified via the result panel state."
          : "Companion captured a fresh frame and sent the validated result to the HoloLens.");
        if (d.verificationStatus === "verified") await advanceIfVerified();
      }
    } catch (cause) {
      setAutoStatus(`External camera companion error: ${errorMessage(cause)}`);
    }
  }
  /** Bridge from the long-lived controller to the inspection pipeline of the LATEST render. */
  async function runControllerInspection(intent: "inspect" | "verify", frame: SelectedFrame, stepId: string, guard: () => boolean): Promise<InspectOutcome> {
    const source = `${cameraSource === "external" ? "external" : "hololens"} camera${monitorRef.current?.deviceLabel ? ` (${monitorRef.current.deviceLabel})` : ""}`;
    const d = await performInARInspection(intent, frame.snapshot, stepId, {
      cameraSource: source, frameFresh: true, selection: frame.reason, roiPx: frame.roiPx, origin: "auto", mayUpload: guard,
    });
    if (d.stale) return { kind: "stale" };
    if (d.overallStatus === "error") return { kind: "error", failure: d.failure ?? "backend", message: d.message ?? "Inspection failed" };
    if (d.verificationStatus)
      return { kind: "verification", status: d.verificationStatus as "verified" | "still_incorrect" | "uncertain", needsView: d.needsView };
    return { kind: "inspection", status: d.overallStatus, needsView: d.needsView };
  }
  const inspectRef = useRef(runControllerInspection);
  const advanceRef = useRef(advanceIfVerified);
  const extPendingRef = useRef(extPending);
  const rejectedRef = useRef(previewRejected);
  useEffect(() => {
    rejectedRef.current = previewRejected;
    inspectRef.current = runControllerInspection;
    advanceRef.current = advanceIfVerified;
    extPendingRef.current = extPending;
    pairingRef.current = pairingCode;
    specRef.current = spec;
  });

  async function startAutonomous() {
    if (!project || !view.step_id || runner.active || machineRef.current) return;
    const stepId = view.step_id;
    autoWorkflow.current = null;
    if (cameraSource === "manual") {
      const machine = new AutonomousMachine();
      machineRef.current = machine;
      machine.start(projectId, stepId);
      machine.cameraReady(true);
      machine.anchored();
      setAutoOn(true);
      setAutoPaused(false);
      syncAutoLabel();
      setAutoStatus("MANUAL CAMERA MODE — no continuous frames are captured. Advance follows server verification; use Verify Step.");
      return;
    }
    await runner.start({
      projectId, stepId, assessExisting: assessPlaced,
      deviceId: cameraSource === "external" && camDeviceId ? camDeviceId : undefined,
    });
  }
  function pauseAutonomous() {
    if (runner.pause()) return;
    const m = machineRef.current; // manual camera mode
    if (!m) return;
    m.pause();
    setAutoPaused(true);
    syncAutoLabel();
    setAutoStatus("PAUSED — no automatic advance until you resume.");
  }
  function resumeAutonomous() {
    if (runner.resume()) return;
    const m = machineRef.current;
    if (!m) return;
    m.resume();
    setAutoPaused(false);
    syncAutoLabel();
    setAutoStatus("RESUMED.");
    // A verification that arrived while paused advances only now (server progress is re-checked).
    if (m.state === "verified") void advanceIfVerified();
  }
  /** Final step verified: stop paid calls and release the camera, keep the hologram and history. */
  function finishAutonomous() {
    runner.complete();
  }
  /**
   * Full stop (also used when immersive AR ends): timer, controller, this run's
   * in-flight browser request and camera tracks. Never ends XR, never touches
   * the field, hologram or current step. A request that already reached the
   * backend is not cancelled there; its late result is ignored.
   */
  function stopAutonomous(message?: string) {
    runner.stop(message);
    // Stop also ends waiting for an external capture: a late result is dropped.
    if (extTracker.current) {
      extTracker.invalidate();
      setExtPending(false);
    }
    machineRef.current?.stop();
    machineRef.current = null;
    controllerRef.current = null;
    setAutoOn(false);
    setAutoPaused(false);
    setAutoStateLabel("idle");
    setAutoDiag(null);
    if (message) setAutoStatus(message);
  }
  const stopAutoRef = useRef(stopAutonomous);
  /** Poll → latest render: a run started elsewhere resets this device's local run (starts nothing). */
  const runChangedRef = useRef<(run: { run_id: string | null }, v: ViewedStep) => void>(() => {});
  useEffect(() => {
    runChangedRef.current = (run, v) => {
      resetLocalRun("Another device started a new assembly — Autonomous Assembly stopped here.");
      enterNewRun(run, v);
      setStatus("Another device started a new assembly — Step 1, no steps verified. Nothing is checked until you select Check Step.");
    };
  });
  useEffect(() => {
    stopAutoRef.current = stopAutonomous;
  });

  async function testMicrophone() {
    if (micPending.current || voiceBusy) return;
    micPending.current = true;
    const session = micSession.current;
    setMicTest({ state: "testing", message: "Waiting for microphone permission. Respond to the browser prompt; any granted test stream will be stopped immediately." });
    const result = await probeMicrophone(navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices));
    micPending.current = false;
    if (alive.current && session.active)
      setMicTest({ state: result.ok ? "passed" : "error", message: result.message });
  }

  async function enter() {
    if (!navigator.xr || !cap.available || busy || !host.current) return;
    setBusy(true);
    setFinishedFor(null); // Every XR entry requires a new explicit Finish.
    setError("");
    const epoch = ++generation.current;
    try {
      const session = await navigator.xr.requestSession("immersive-ar", {
        requiredFeatures: ["local"],
        optionalFeatures: ["hit-test", "anchors", "local-floor"],
      });
      if (!alive.current || epoch !== generation.current) {
        await session.end();
        return;
      }
      try {
        const { SpatialSession } = await import("@/lib/ar/runtime");
        if (!alive.current || epoch !== generation.current || !host.current) {
          await session.end();
          return;
        }
        const instance = new SpatialSession(
          session,
          host.current,
          (message) => {
            if (alive.current) setStatus(message);
          },
          (a) => actionRef.current(a),
          () => {
            runtime.current = null;
            setFinishedFor(null);
            stopAllVoice(true);
            // Contract: ending immersive AR stops Autonomous completely (anchors are
            // session-only, so monitoring has no trustworthy field any more).
            if (runner.active || machineRef.current)
              stopAutoRef.current("Immersive AR ended — Autonomous Assembly stopped and camera released. Start it again after re-entering AR.");
            if (alive.current) {
              setActive(false);
              setStatus("XR session ended. Microphone stopped. Re-enter and re-anchor before continuing.");
            }
          },
        );
        runtime.current = instance;
        await instance.initialize();
        instance.update(info.current);
        instance.setShowReference(showReference);
        // Re-trigger reference load for the new session.
        if (refPath) {
          try {
            const response = await fetch(mediaUrl(refPath));
            if (response.ok) {
              const bitmap = await createImageBitmap(await response.blob()).catch(() => null);
              if (bitmap) instance.setReferenceImage(bitmap as unknown as { width: number; height: number });
            }
          } catch {
            /* placeholder shown; DOM reference remains available */
          }
        }
        if (alive.current) {
          setActive(true);
          // Keep the already-running microphone stream across XR entry; the
          // controller resumes/repairs it in place instead of re-recording
          // per clip. Session end (done callback) still stops voice.
          localRef.current?.setXRActive(true);
        }
      } catch (e) {
        await session.end().catch(() => {});
        throw e;
      }
    } catch (e) {
      if (alive.current) setError(`AR did not start: ${errorMessage(e)}`);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function proxy() {
    const b = step?.required_blocks[0];
    if (!b) return;
    setLoadedFor(placementKey);
    setHologram({ assembled: hologram.assembled, current: [proxyBlock({ block_id: b.block_id, instance: 1 })] });
  }
  return (
    <section className="panel ar-workspace" aria-label="Spatial assembly guidance">
      <h2>{project?.name ?? "Spatial guidance"}</h2>
      <section className={`guided-step guided-${guide.tone}`} aria-label="Guided assembly step">
        <p className="guided-progress">{step ? `Step ${step.position} of ${totalSteps}` : "No step"}</p>
        <p className="guided-state" role="status" aria-label="Step status">{guide.label}</p>
        <p className="guided-instruction">{shortText}</p>
        <p className="guided-message" role="status" aria-label="Step guidance">{guide.message}</p>
        {lastGuideOutcome && <p className="guided-outcome" role="status" aria-label="Last action">{lastGuideOutcome}</p>}
        <div className="guided-actions">
          {guide.buttons.map((b) => (
            <button
              key={b.id}
              className={`button guided-button guided-${b.id}`}
              aria-label={b.label.replace(/[▶◀]/g, "").trim()}
              onClick={() => void runGuideAction(b.id)}
            >
              {b.label}
            </button>
          ))}
          <button className="button secondary guided-button" aria-label="Back" disabled={!online || step?.position === 1 || checkingStep} onClick={() => void runGuideAction("previous")}>◀ Back</button>
        </div>
      </section>
      <div className="form-actions ar-session-actions">
        <button className="button primary" disabled={!cap.available || busy || active || !step || !online} onClick={() => void enter()}>
          Enter immersive AR
        </button>
        {active && (
          <>
            <button className="button secondary" onClick={() => reanchorField()}>Re-anchor tabletop</button>
            <button className="button secondary" onClick={() => runtime.current?.recenterPanel()}>Recenter panel</button>
            <button className="button secondary" onClick={() => runtime.current?.resetPanelSize()}>Reset panel size</button>
            <button className="button danger ar-exit-large" onClick={() => void exitAR()}>Exit AR</button>
          </>
        )}
      </div>
      <p className="ar-quick-help">Enter AR and look at your table. Rotate the field preview to match your baseplate (Rotate Left/Right or pinch the rotation bar), select Confirm Assembly Field, then follow the step above and select Check Step.</p>
      <p role="status">{status}</p>
      <details className="ar-options">
        <summary>Device &amp; connection details</summary>
        {/* When AR is unavailable the same message is already shown outside this section. */}
        {cap.available && <p role="status">{cap.message}</p>}
        <p>Device: {device}. Connection and physical alignment must be tested on your HoloLens.</p>
      {active && (
        <details>
          <summary>XR interaction diagnostics (developer)</summary>
          <p role="status" aria-label="XR interaction diagnostics">{interactionUi || "No XR input source reported yet."}</p>
          <p>If no tracked hand ray is reported, HoloLens Edge has not provided a usable target ray for this session. The panel buttons on this page and the HoloLens Start gesture (Exit AR) remain available; no hand tracking is simulated.</p>
          <p>Panel manipulation: pinch the panel title bar (⠿) to drag it, pinch the ◢ lower-right corner to resize (aspect preserved, 65–140%). Dragging/resizing never activates buttons and never moves the anchored assembly field. Fallback: Recenter panel and Reset panel size above.</p>
        </details>
      )}
      <p>{online ? "Connected to project state" : "Project state unavailable — hologram hidden and verification unknown"}</p>
      </details>
      {!cap.available && <p role="status">{cap.message}</p>}
      {!online && <p role="alert">Project connection unavailable. Check your connection before continuing.</p>}

      <details className="ar-options">
        <summary>Voice control · {localOn ? "On" : "Off"}</summary>
      <fieldset className="ar-voice">
        <legend>Hands-free voice control</legend>
        <h3>Hands-free controls</h3>
        <p role="status" aria-label="Local microphone state">{localOn || localBusy ? `Local voice: ${localStatus}` : `Local voice: Off — ${localStatus}`}</p>
        <label>
          Voice language{" "}
          <select value={voiceLang} onChange={(e) => setVoiceLang(e.target.value)} disabled={voiceBusy || localOn || localBusy}>
            <option value="en-US">English (en-US)</option>
            <option value="de-DE">German (de-DE)</option>
          </select>
        </label>
        <p>
          Enable voice before entering AR. Microphone clips are sent over HTTPS
          to your Mac for local transcription, then deleted. No cloud speech
          service is used and no audio or transcripts are stored. You can stop
          listening at any time; panel buttons remain available.
        </p>
        <label>
          <input type="checkbox" checked={localConsent} onChange={(e) => {
            setLocalConsent(e.target.checked);
            if (!e.target.checked) stopLocalVoice();
          }} /> I agree to local voice transcription on my Mac as described above.
        </label>
        <div className="form-actions">
          {!localOn ? (
            <button className="button primary" disabled={!localConsent || localBusy || voiceBusy || micTest.state === "testing"} onClick={() => enableLocalVoice()}>
              Enable local voice control
            </button>
          ) : (
            <button className="button danger" onClick={stopLocalVoice}>Stop local listening</button>
          )}
          <button
            className="button secondary"
            disabled={!localConsent || localOn || localBusy || voiceBusy || micTest.state === "testing"}
            onClick={() => void recordOneLocalCommand()}
          >
            Record one command (push-to-talk)
          </button>
        </div>
        <details>
          <summary>Voice diagnostics</summary>
          {localEngine && <p>{localEngine}</p>}
        {captureDiag && (
          <p role="status" aria-label="Microphone capture diagnostics">
            Mic {captureDiag.mic} · {captureDiag.phase} · {captureDiag.message}
            {captureDiag.transcript ? ` · “${captureDiag.transcript}”` : ""}
            {captureDiag.action ? ` → ${captureDiag.action}` : ""} · track{" "}
            {captureDiag.trackState ?? "?"} · audio {captureDiag.contextState ?? "?"}
            {captureDiag.durationMs !== undefined ? ` · ${captureDiag.durationMs} ms` : ""}
            {captureDiag.rms !== undefined ? ` · level ${captureDiag.rms.toFixed(3)}` : ""}
          </p>
        )}
        {diagnostic && (
          <section aria-label="Voice command diagnostics" className="ar-diagnostics">
            <h4>Last voice command</h4>
            <p>Transcript: “{diagnostic.transcript}”</p>
            <p>Matched action: {diagnostic.action ?? "none — No command matched"}</p>
            <p role="status">
              Execution:{" "}
              {diagnostic.state === "completed"
                ? "SUCCESS"
                : diagnostic.state.toUpperCase()}
              {diagnostic.detail ? ` · ${diagnostic.detail}` : ""}
            </p>
            {diagnostic.reason && <p>Reason: {diagnostic.reason}</p>}
            <p>Current step: {step?.position ?? "—"} of {totalSteps || "—"}</p>
          </section>
        )}
        </details>
        <details>
        <summary>Browser voice fallback &amp; microphone test</summary>
        <h3>Browser speech recognition (not reliable on HoloLens)</h3>
        <p role="status" aria-label="Voice state">Voice: {voiceLabel}</p>
        <p role={voiceState === "error" ? "alert" : "status"}>
          {voice.errorCode && <strong>{voice.errorCode}: </strong>}{voiceMessage}
        </p>
        <p>Recognition API: <strong>{voiceSupported.apiName ?? "None"}</strong>. Constructor presence does not prove that the browser&apos;s speech service works.</p>
        {(voiceState === "error" || voiceState === "unsupported") && (
          <p>Browser speech recognition is currently unavailable for this attempt. If the microphone test passes, audio capture works but the recognition service still failed. Use manual controls; a native HoloLens Unity/OpenXR client with Windows keyword recognition is an alternative.</p>
        )}
        {voiceSupported.mayUseCloudService && (
          <p>
            Privacy: browser speech recognition may send audio to your browser provider&apos;s
            speech service (for Microsoft Edge, Microsoft) — not to AssemblyPilot. No audio is
            sent to or stored by the AssemblyPilot backend, and no transcripts are stored. Only
            the short-lived recognized command is shown. Voice is off until you enable it.
          </p>
        )}
        <label>
          <input type="checkbox" checked={consent} onChange={(e) => {
            setConsent(e.target.checked);
            if (!e.target.checked) stopVoice(true);
          }} /> I
          understand and consent to browser speech recognition as described above.
        </label>
        <label>
          <input type="checkbox" checked={readAloud} onChange={(e) => setReadAloud(e.target.checked)} /> Read
          instructions aloud (“Read instructions” command)
        </label>
        <div className="form-actions">
          {!voiceBusy ? (
            <button className="button primary" disabled={!voiceSupported.supported || !consent || localOn || localBusy || micTest.state === "testing"} onClick={enableVoice}>
              Enable voice control
            </button>
          ) : (
            <button className="button danger" disabled={voice.state === "stopping"} onClick={() => stopVoice()}>
              {voice.state === "starting" ? "Cancel voice startup" : voice.state === "stopping" ? "Stopping…" : "Stop listening"}
            </button>
          )}
        </div>
        {voiceStatus && <p>{voiceStatus}</p>}
        <div className="ar-microphone-test">
          <p>Microphone test (separate permission): clicking below briefly requests microphone audio access, then immediately stops all test tracks. It does not record, transcribe or upload audio, and does not start speech recognition.</p>
          <button className="button secondary" disabled={voiceBusy || localOn || localBusy || micTest.state === "testing"} onClick={() => void testMicrophone()}>Test microphone access</button>
          <p role="status" aria-label="Microphone test result">{micTest.message}</p>
        </div>
        {lastCommand && <p>Last recognized command: “{lastCommand}”</p>}
        </details>
        <details open={helpVisible} onToggle={(e) => setHelpVisible((e.target as HTMLDetailsElement).open)}>
          <summary>Available voice commands</summary>
          <ul>
            {VOICE_COMMANDS.map((c) => (
              <li key={c.spoken}>“{c.spoken}” — {c.description}</li>
            ))}
          </ul>
          <p>German aliases ({voiceLang === "de-DE" ? "active language" : "set the voice language to German to use"}): {GERMAN_ALIASES.map((g) => `“${g.spoken}”`).join(" · ")}</p>
          <p>Optional prefix: say “AssemblyPilot” before a command, e.g. “AssemblyPilot, next step”.</p>
        </details>
        {!voiceSupported.supported && (
          <p>Voice is unavailable in this browser. Use the large on-page and in-headset buttons. A native HoloLens Unity/OpenXR speech alternative is documented in docs/hololens.md.</p>
        )}
      </fieldset>
      </details>
      <details className="ar-options">
      <summary>Automatic camera checks · {autoOn ? "On" : "Off"}</summary>
      <fieldset className="ar-autonomous">
        <legend>Autonomous Assembly (camera-driven, no voice needed)</legend>
        <p role="status" aria-label="Autonomous assembly state">
          Autonomous Assembly: {autoOn ? autoStateLabel : "off"} — {autoStatus}
        </p>
        <p>
          How it works: one anchored tabletop field, a camera watches the real
          blocks, stable changes trigger ONE Meta inspection, a separate fresh
          frame verifies, and only the server-verified step advances
          automatically. Meta inference never runs on a timer or per frame.
          External camera companion: open this same page on the MacBook, pick
          the external camera and start monitoring there — the HoloLens
          follows the server step without moving its anchored field.
        </p>
        <label>
          Camera source{" "}
          <select value={cameraSource} disabled={autoOn} onChange={(e) => setCameraSource(e.target.value as CameraSource)}>
            <option value="hololens">HoloLens camera (probed in AR)</option>
            <option value="external">External tabletop camera</option>
            <option value="manual">Manual capture</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={assessPlaced} disabled={autoOn} onChange={(e) => setAssessPlaced(e.target.checked)} />{" "}
          Assess blocks already placed when monitoring starts (one controlled inspection)
        </label>
        {cameraSource === "external" && (
          <label>
            External camera{" "}
            <select value={camDeviceId} disabled={autoOn} onChange={(e) => setCamDeviceId(e.target.value)}>
              <option value="">Default camera</option>
              {camDevices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
            </select>
            <button className="button secondary" disabled={autoOn} onClick={() => void listVideoDevices().then(setCamDevices)}>List cameras</button>
          </label>
        )}
        <div className="form-actions">
          {!autoOn ? (
            <button className="button primary" disabled={!step || !online} onClick={() => void startAutonomous()}>Start Autonomous Assembly</button>
          ) : autoPaused ? (
            <button className="button primary" onClick={resumeAutonomous}>Resume Monitoring</button>
          ) : (
            <button className="button secondary" onClick={pauseAutonomous}>Pause Monitoring</button>
          )}
          {autoOn && <button className="button danger" onClick={() => stopAutonomous()}>Stop Autonomous Assembly</button>}
          <button className="button secondary" disabled={!autoOn || cameraSource === "manual"} onClick={() => void runAutoTrigger()}>Inspect Now</button>
          <button className="button secondary" disabled={!active} onClick={() => runtime.current?.confirmOrigin()}>Confirm Assembly Field</button>
          <button className="button secondary" disabled={!active} onClick={() => reanchorField()}>Re-anchor Assembly Field</button>
        </div>
        <label>
          Camera pairing code{" "}
          <input value={pairingCode} onChange={(e) => setPairingCode(e.target.value.toUpperCase())} placeholder="e.g. K7MP2A" />
        </label>
        <button className="button secondary" onClick={() => setPairingCode(newPairingCode())}>Generate pairing code</button>
        <button className="button secondary" disabled={!validPairingCode(pairingCode)} onClick={() => setCompanionOn((v) => !v)}>
          {companionOn ? "Stop external camera companion" : "Act as external camera companion (this device)"}
        </button>
        {companionOn && <p role="status">Companion active: this device captures fresh frames for capture requests with the pairing code and returns validated results to the HoloLens, which stays in AR.</p>}
        <details>
          <summary>Monitoring &amp; field diagnostics (live, no Meta request needed)</summary>
          <p role="status" aria-label="AR field diagnostics">
            {active
              ? `${describeField(fieldDiag)} · lifecycle ${fieldDiag.lifecycle} · native anchor ${fieldDiag.nativeAnchor ? "yes" : "no"} · confirmed ${fieldDiag.anchorConfirmed ? "yes" : "no"} · field mesh ${fieldDiag.fieldMeshExists ? "exists" : "MISSING"} · rendered last frame ${fieldDiag.fieldRendered ? "yes" : "no"} · transform ${fieldDiag.transformValid ? "valid" : "INVALID"} · XR ${fieldDiag.visibilityState} · head tracked ${fieldDiag.viewerTracked ? "yes" : "no"} · re-anchor pending ${fieldDiag.reanchorPending ? "yes" : "no"} · step hologram ${fieldDiag.stepContentAvailable ? "yes" : "none"} · placement ${fieldDiag.placementMode} · distance ${fieldDiag.distanceM?.toFixed(2) ?? "—"} m · gaze angle ${fieldDiag.angleDeg?.toFixed(0) ?? "—"}° · frames ${fieldDiag.framesRendered} · last event: ${fieldDiag.lastEvent}`
              : "AR field: no immersive session on this device."}
          </p>
          <p role="status" aria-label="Autonomous monitoring diagnostics">
            {autoDiag
              ? `State ${autoDiag.machineState} · camera ${autoDiag.camera ? `${autoDiag.camera.state} (${autoDiag.camera.label}; clock: ${autoDiag.camera.clockSource}; frames seen ${autoDiag.camera.framesSeen})` : "—"} · ROI image centre 56%×68% (approximate; not projected from the field) · motion ${autoDiag.detector?.motion ? `shift ${autoDiag.detector.motion.dx},${autoDiag.detector.motion.dy} px · ROI changed ${(autoDiag.detector.motion.roiFraction * 100).toFixed(1)}% · background ${(autoDiag.detector.motion.backgroundFraction * 100).toFixed(1)}%` : "—"} · detector ${autoDiag.detector?.kind ?? "—"}${autoDiag.detector?.pending ? ` (change candidate: ${autoDiag.detector.reason})` : ""}${autoDiag.detector?.latch ? " · activity latched" : ""} · field in view ${autoDiag.fieldInView === null ? "n/a" : autoDiag.fieldInView ? "yes" : "no"} · last selection: ${autoDiag.lastSelection ?? "—"} · last rejection: ${autoDiag.lastRejection ?? "—"} · automatic calls ${autoDiag.budget.stepUsed}/${autoDiag.budget.stepMax} this step, ${autoDiag.budget.sessionUsed}/${autoDiag.budget.sessionMax} session · last failure ${autoDiag.lastFailure ?? "none"} · verification ${verified && online ? "server-verified" : machineRef.current?.nextIntent === "verify" ? "pending (needs separate fresh frame)" : "not verified"}`
              : "Autonomous monitoring is not running."}
          </p>
        </details>
        {lastTrace && (
          <details>
            <summary>Inspection diagnostics (latest request)</summary>
            <p role="status" aria-label="Inspection diagnostics">
              Correlation (snapshot SHA-256): {lastTrace.correlationId ?? "unavailable"} · Inspection: {lastTrace.inspectionId ?? "—"} ·
              Camera: {lastTrace.cameraSource} · Frame: {lastTrace.width ?? "?"}x{lastTrace.height ?? "?"} · fresh {lastTrace.frameFresh ? "YES" : "unknown"} ·
              Meta called: {lastTrace.metaCalled === null ? "—" : lastTrace.metaCalled ? `YES — validated backend response (configured model ${lastTrace.metaModel ?? "?"} · ${lastTrace.metaAttempts ?? "?"} provider attempt(s) · ${lastTrace.metaLatencyMs !== null ? (lastTrace.metaLatencyMs / 1000).toFixed(1) + " s" : "?"})` : "NO — no validated Meta result"} ·
              Semantic: {lastTrace.semanticStatus ?? "—"} · Print gate: {lastTrace.printGate ?? "—"} · Face: {lastTrace.faceStatus ?? "—"} · Geometry: {lastTrace.geometryStatus ?? "—"} ·
              Combined state: {lastTrace.combinedState ?? "—"}
              {lastTrace.uncertainReason ? ` · Uncertain cause (${lastTrace.uncertainCause}): ${lastTrace.uncertainReason}` : ""}
            </p>
            <p>{lastTrace.entries.map((e) => `${e.stage}: ${e.detail}`).join(" → ")}</p>
            <p role="status" aria-label="AR panel capture preview">
              AR panel preview (v{previewVersion}): {previews.current
                ? `capture #${previews.current.id} · ${previews.current.phase} · upload started ${previews.current.sent ? "yes" : "no"} · SHA-256 ${previews.current.fingerprint ?? "computing"} · ${previews.current.fingerprint && previews.current.fingerprint === lastTrace.correlationId ? "same image as this trace" : "different from this trace (newer capture or not sent)"}`
                : "no capture for the current step"}
            </p>
            <button className="button secondary" disabled={!lastFrame} onClick={() => setShowFrame((v) => !v)}>
              {showFrame ? "Hide last sent frame" : "Show Last Sent Frame"}
            </button>
            {showFrame && lastFrame && (
              <figure>
                {/* eslint-disable-next-line @next/next/no-img-element -- exact captured frame, diagnostic only */}
                <img src={lastFrame.dataUrl} width={lastFrame.width} height={lastFrame.height} alt="Exact frame sent for the latest inspection" style={{ maxWidth: "100%" }} />
                <figcaption>
                  Exact frame sent · {lastFrame.source} · {new Date(lastFrame.capturedAt).toLocaleTimeString()} · {lastFrame.width}x{lastFrame.height} · fingerprint {lastFrame.fingerprint.slice(0, 16)}… · in-memory only, not stored
                </figcaption>
              </figure>
            )}
          </details>
        )}
        <p>Assembly field: {active ? `${anchorUi} (${fieldDiag.fieldRendered ? "rendered" : "not rendered"})` : "enter AR to place it"} · Field {runtime.current?.fieldSize.widthM ?? 0.48} m × {runtime.current?.fieldSize.depthM ?? 0.32} m · Anchors are session-local in HoloLens Edge; re-anchor after each new AR session. Registration is approximate — verified status comes only from the backend.</p>
      </fieldset>
      </details>
      <details className="ar-options">
      <summary>Full instructions, reference &amp; inspection results</summary>
      <h3>
        Step {step?.position ?? "—"} — {step?.title}
      </h3>
      <p>Step {step?.position ?? "—"} of {totalSteps || "—"}</p>
      <p id="ar-full-instruction">{step?.instruction}</p>
      <p>
        {verified && online
          ? "Inspection verified — this does not certify AR alignment."
          : online
            ? "Manually viewed / not verified"
            : "Verification status uncertain — connection unavailable"}
      </p>
      {resultSummary && (
        <section aria-label="Latest Meta inspection result" className="ar-inspection-result">
          <h4>Latest Meta inspection result</h4>
          <p role="status"><strong>{resultHeadline(resultSummary, verified && online)?.text}</strong></p>
          <p>
            {verified && online
              ? "Step verified: Yes (server progress)"
              : resultSummary.status === "correct"
                ? "Step verified: No — fresh verification required"
                : resultSummary.kind === "error"
                  ? "Inspection failed — this is not an incorrect assembly"
                  : "Step verified: No"}
          </p>
          {resultSummary.overall?.printGate === "fail" && (
            <>
              <p><strong>Problem: Wrong printed side</strong> — the observed print does not match the required side.</p>
              <p>Expected: {resultSummary.overall.expectedPrint}</p>
              <p>Observed: {resultSummary.overall.observedPrint ?? "Not read"}</p>
              {resultSummary.overall.printAction && <p>Suggested action: {resultSummary.overall.printAction}</p>}
            </>
          )}
          {resultSummary.overall?.printGate === "uncertain" && (
            <>
              <p><strong>Problem: The required printed side or its orientation could not be verified.</strong></p>
              <p>Expected: {resultSummary.overall.expectedPrint}</p>
              <p>Observed: {resultSummary.overall.observedPrint ?? "Not read"}</p>
              {resultSummary.overall.printAction && <p>Suggested action: {resultSummary.overall.printAction}</p>}
            </>
          )}
          {resultSummary.kind === "error" ? (
            <p role="alert">{resultSummary.errorMessage}</p>
          ) : (
            <>
              {resultSummary.explanation && <p>{resultSummary.explanation}</p>}
              {resultSummary.issues.map((issue, i) => (
                <div key={i}>
                  <p><strong>Issue {i + 1} ({issue.type}):</strong> {issue.description}</p>
                  <p>Expected: {issue.expected}</p>
                  <p>Observed: {issue.observed}</p>
                  <p>Suggested fix: {issue.suggested_fix}</p>
                </div>
              ))}
              {resultSummary.correctionPlan.length > 0 && (
                <>
                  <p><strong>Correction plan</strong></p>
                  <ol>{resultSummary.correctionPlan.map((line, i) => <li key={i}>{line}</li>)}</ol>
                </>
              )}
              {resultSummary.activeVision && (
                <p>Additional view needed ({resultSummary.activeVision.requested_view}): {resultSummary.activeVision.reason} — {resultSummary.activeVision.instruction}</p>
              )}
              {resultSummary.nextAction && <p>Next action: {resultSummary.nextAction}</p>}
            </>
          )}
          <p>Latest AI assessment for this step, {new Date(resultSummary.updatedAt).toLocaleTimeString()}. This is separate from officially verified progress.</p>
          <div className="form-actions">
            <button className="button secondary" onClick={() => { setResultErrorsOnly(false); setResultMode("result"); runtime.current?.setViewMode("result"); }}>Show result in AR panel</button>
            <button className="button secondary" onClick={() => { setResultMode("guide"); runtime.current?.setViewMode("guide"); }}>Back to instructions</button>
          </div>
        </section>
      )}
      <h4>Expected assembly reference (guidance only — not proof of your build)</h4>
      {!showReference && refPath ? (
        <p>Reference hidden — say “Show reference” or use the Show reference button to display it again.</p>
      ) : refPath && selectedRef ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={`${step?.id}:${selectedRef.id}`}
          className="reference-image ar-reference"
          src={mediaUrl(refPath)}
          alt={`Expected assembly for ${step?.title}`}
          style={{ objectFit: "contain" }}
          onError={() => setRefError("Expected reference could not be loaded.")}
        />
      ) : (
        <div className="reference-placeholder">
          <strong>No reference photograph for this step</strong>
          <p>Add or select a step reference photo in the project editor. The AR panel shows the same compact guidance without an image.</p>
        </div>
      )}
      {selectedRef && <p>Selected reference: {selectedRef.original_filename} ({selectedRef.width}×{selectedRef.height})</p>}
      {refError && <p role="alert">{refError}</p>}
      <div className="form-actions">
        <button className="button secondary" disabled={!online || step?.position === 1} onClick={() => void navigate(-1)} aria-label="Previous Step">◀ Previous Step</button>
        <button className="button secondary" disabled={!online || step?.position === totalSteps} onClick={() => void navigate(1)} aria-label="Next Step">Next Step ▶</button>
        <button className="button secondary" onClick={() => setShowReference((v) => !v)}>{showReference ? "Hide reference" : "Show reference"}</button>
        <button className="button primary" disabled={!step || !online} onClick={() => void verify()}>Verify Step — camera workspace</button>
        <button className="button secondary" disabled={!step || !online} onClick={() => void verifyAgain()}>Verify Again — fresh verification</button>
      </div>
      <p>
        In AR, use the large panel buttons (Previous / Next / Verify Step / EXIT AR / Re-anchor /
        Recenter / Reference / More text / Help) or voice. Tap the panel above the buttons to
        confirm the tabletop origin. Verification exits AR and opens the existing camera
        workflow — a fresh real photograph is always required; saying “Verify step” never
        verifies a step by itself. If this device cannot capture images, open the same
        verification link on your iPhone/Mac and return here; verified status refreshes
        automatically. To exit without voice: use the large EXIT AR button or the HoloLens
        Start gesture for the system menu. Exiting AR always stops the microphone.
      </p>
      <Link href={verificationUrl}>Verification link for this project and step</Link>
      </details>
      <details className="ar-options">
      <summary>Placement tools &amp; 2D preview</summary>
      {!placement && (
        <>
          <p>No usable 3D model or dimensions for this step. Nothing is drawn as an exact block.</p>
          {/* Only after this step's scene settled: a late scene load would otherwise replace the chosen box. */}
          <button className="button secondary" disabled={!step?.required_blocks.length || loadedFor !== placementKey} onClick={proxy}>
            Use 10 cm alignment box (approximate)
          </button>
        </>
      )}
      <div className="ar-preview">
        <h3>2D preview only — not mixed reality</h3>
        {placement ? (
          <>
            <HologramPreview assembled={hologram.assembled} current={hologram.current} />
            <ol className="hologram-legend">
              {hologram.current.map((p, i) => {
                const r = step?.required_blocks.find((b) => b.block_id === p.target_block_id);
                return (
                  <li key={i}>
                    {r?.block.name} · {r?.block.color} · instance {p.instance} / {r?.required_quantity} · {p.evidence} ·{" "}
                    {p.dimensions.x_mm} × {p.dimensions.y_mm} × {p.dimensions.z_mm} mm · bottom Y {(p.position_m[1] * 1000).toFixed(1)} mm
                  </li>
                );
              })}
            </ol>
            <p>
              Cyan = place in this step · grey = already assembled in earlier steps ({hologram.assembled.length}).
              {sceneExcluded > 0 && ` ${sceneExcluded} outdated earlier block(s) are not drawn — fix them in the project editor.`}
              {" "}Guidance only: it never verifies a step.
            </p>
          </>
        ) : (
          <p>Author confirmed dimensions in the step editor, or explicitly choose an approximate proxy.</p>
        )}
      </div>
      <Link href={`/projects/${projectId}`}>Edit project / AR placements</Link>
      </details>
      {error && <p role="alert">{error}</p>}
      <div ref={host} className="xr-output" aria-label="Immersive XR output" />
    </section>
  );
}
