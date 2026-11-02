"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { registry } from "@/lib/registry";
import { errorMessage, mediaUrl } from "@/lib/api";
import {
  capabilities,
  getPlacement,
  getView,
  setView,
  validPlacement,
  type Placement,
  type ViewedStep,
} from "@/lib/ar/data";
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
import { FrameGate } from "@/lib/ar/monitoring";
import type { CameraSource } from "@/lib/ar/monitoring";
import { MonitorCamera, listVideoDevices } from "@/lib/ar/autonomousMonitor";
import {
  inspectingSummary,
  saveInspectionSummary,
  summarizeInspection,
  summarizeVerification,
  errorSummary as autoErrorSummary,
} from "@/lib/ar/inspectionResult";
import { saveLastInspection } from "@/lib/ar/voiceVerify";
import {
  claimExternalRequest, latestExternalResult, newPairingCode, pendingExternalRequests,
  postExternalResult, requestExternalCapture, summaryFromBridge, validPairingCode,
} from "@/lib/ar/cameraBridge";
import type { ProjectDetail } from "@/types/projects";
import type { SpatialSession, Action, Guidance } from "@/lib/ar/runtime";

type SpeechCtor = new () => RecognitionLike;
const CHECKING_SPEECH = {
  supported: false,
  apiName: null,
  secureContext: false,
  mayUseCloudService: false,
  reason: "Checking speech support…",
} as const;
let speechCache: ReturnType<typeof detectSpeechSupport> | null = null;
function detectSpeechSupportCached() {
  if (!speechCache)
    speechCache = detectSpeechSupport(window as unknown as Record<string, unknown>);
  return speechCache;
}

export function ARWorkspace({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<ProjectDetail | null>(null),
    [view, setViewed] = useState<ViewedStep>({ step_id: null, revision: 0 });
  const router = useRouter();
  const [rawPlacement, setPlacement] = useState<Placement | null>(null),
    [loadedFor, setLoadedFor] = useState("");
  const [resultSummary, setResultSummary] = useState<InspectionSummary | null>(null),
    [resultMode, setResultMode] = useState<"guide" | "result">("guide"),
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
  const [pairingCode, setPairingCode] = useState("");
  const [extPending, setExtPending] = useState(false);
  const [companionOn, setCompanionOn] = useState(false);
  const [interactionUi, setInteractionUi] = useState("");
  const machineRef = useRef<AutonomousMachine | null>(null);
  const gateRef = useRef(new FrameGate());
  const monitorRef = useRef<MonitorCamera | null>(null);
  const autoTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoAbort = useRef<AbortController | null>(null);
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
  const placementKey = `${view.step_id}:${spec}`;
  const placement = loadedFor === placementKey ? rawPlacement : null;
  const previewExtent = placement
    ? Math.max(
        200,
        Math.abs(placement.position_m[0]) * 1000 + placement.dimensions.x_mm,
        Math.abs(placement.position_m[2]) * 1000 + placement.dimensions.z_mm,
      )
    : 200;
  const verified = verification.step === view.step_id && verification.verified;
  const target = step?.required_blocks.find((b) => b.block_id === placement?.target_block_id);
  const verificationUrl = `/?project=${encodeURIComponent(projectId)}&step=${encodeURIComponent(view.step_id ?? "")}`;
  const verificationStatus = !online ? "uncertain" : verified ? "verified" : "not_verified";

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
      if (autoTimer.current) clearInterval(autoTimer.current);
      autoAbort.current?.abort();
      monitorRef.current?.stop();
      microphoneSession.active = false;
      voiceRef.current?.dispose();
      voiceRef.current = null;
      localRef.current?.dispose();
      localRef.current = null;
      void runtime.current?.end();
    };
  }, []);
  useEffect(() => {
    let cancelled = false,
      running = false;
    const refresh = async () => {
      if (running) return;
      running = true;
      try {
        const [p, v, progress] = await Promise.all([
          registry.project(projectId),
          getView(projectId),
          getProgress(projectId),
        ]);
        if (cancelled) return;
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
        setOnline(true);
      } catch (e) {
        if (!cancelled) {
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
      setPlacement(null);
      if (!view.step_id) return;
      try {
        const p = await getPlacement(projectId, view.step_id);
        if (p && !validPlacement(p)) throw new Error("Invalid AR dimensions or placement");
        if (!cancelled) {
          setPlacement(p);
          setLoadedFor(`${view.step_id}:${spec}`);
        }
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, view.step_id, spec]);

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

  useEffect(() => {
    const blockLabel = step
      ? step.required_blocks
          .map((b) => `${b.required_quantity} × ${b.block.color} ${b.block.name}`)
          .join(", ") || "No block required"
      : "";
    const headline = resultHeadline(resultSummary, verified && online);
    info.current = {
      placement: online ? placement : null,
      text: step ? `Step ${step.position} — ${step.instruction}` : "Choose a project step",
      detail: `${placement?.evidence.toUpperCase() ?? "NO MODEL"} · ${verified && online ? "Inspection verified" : "Not verified"} · ${target?.block.color ?? ""} ${target?.block.name ?? ""} · ${placement?.instance ?? "?"}/${target?.required_quantity ?? "?"}`,
      stepLabel: step ? `Step ${step.position} of ${totalSteps}` : "No step",
      title: step ? step.title : "Choose a step",
      instruction: step?.instruction ?? "",
      blockLabel: `${blockLabel} · ${placement?.evidence.toUpperCase() ?? "NO MODEL"}${placement ? ` · #${placement.instance}/${target?.required_quantity ?? "?"}` : ""}`,
      verification: verificationStatus as Guidance["verification"],
      hasReference: !!refPath,
      voiceLabel: localOn
        ? `🎤 Local voice listening — ${localStatus}`
        : `Voice: ${voiceLabel}${voice.errorCode ? ` (${voice.errorCode})` : ""} — ${voiceMessage}`,
      anchorLabel: active
        ? `Assembly field: ${anchorUi}${anchorUi === "anchored" ? " — fixed across steps" : ""}`
        : undefined,
      autoLabel: autoOn || extPending ? `Auto ${autoStateLabel}: ${autoStatus}` : undefined,
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
  }, [placement, step, target, verified, online, totalSteps, refPath, voiceLabel, voiceMessage, voice.errorCode, lastCommand, showReference, helpVisible, verificationStatus, localOn, localStatus, diagnostic, captureDiag, active, anchorUi, autoOn, extPending, autoStateLabel, autoStatus, resultSummary, resultMode, resultErrorsOnly]);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      setAnchorUi(runtime.current?.anchorState ?? "unplaced");
      const d = runtime.current?.interaction;
      if (d) setInteractionUi(
        `sources: ${d.sources.map((x) => `${x.handedness}/${x.targetRayMode}${x.tracked ? "" : " (untracked)"}`).join(", ") || "none"} · panel hit: ${d.rayIntersectsPanel ? "yes" : "no"} · hover: ${d.hoveredButton ?? "none"} · last select: ${d.lastSelect ?? "none"} · last action: ${d.lastAction ?? "none"} · last failure: ${d.lastFailure ?? "none"}`,
      );
    }, 500);
    return () => clearInterval(timer);
  }, [active]);
  useEffect(() => {
    if (view.step_id) {
      machineRef.current?.stepChanged(view.step_id);
      autoWorkflow.current = null;
      gateRef.current.reset();
      syncAutoLabel();
    }
  }, [view.step_id]);
  useEffect(() => {
    if (!extPending || !validPairingCode(pairingCode) || !view.step_id) return;
    const stepId = view.step_id;
    const timer = setInterval(() => {
      void (async () => {
        const payload = await latestExternalResult(projectId, stepId, pairingCode).catch(() => null);
        if (!payload) return;
        const summary = summaryFromBridge(payload, projectId, stepId);
        if (!summary) return;
        saveInspectionSummary(summary);
        setResultSummary(summary);
        setResultMode("result");
        runtime.current?.setViewMode("result");
        setExtPending(false);
        setAutoStatus("External camera result received in AR — see the result panel.");
        if (summary.verificationStatus === "verified") await advanceIfVerified();
      })();
    }, 2000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extPending, pairingCode, view.step_id]);
  useEffect(() => {
    if (!companionOn) return;
    const timer = setInterval(() => void runCompanionOnce(), 2000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companionOn, pairingCode, view.step_id, cameraSource, camDeviceId]);
  useEffect(() => {
    if (autoOn && verified) void advanceIfVerified();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOn, verified]);

  async function navigate(offset: number): Promise<ExecutionOutcome> {
    if (!project) return { ok: false, reason: "Project is still loading" };
    if (!online) return { ok: false, reason: "Project state unavailable (offline)" };
    const current = viewRef.current;
    const index = project.steps.findIndex((s) => s.id === current.step_id);
    if (index < 0) return { ok: false, reason: "Current step is unknown" };
    const from = project.steps[index];
    const next = project.steps[index + offset];
    if (!next)
      return {
        ok: false,
        reason: offset < 0 ? "Already at first step" : "Already at last step",
        detail: `Step ${from.position} of ${project.steps.length}`,
      };
    setPlacement(null);
    runtime.current?.setReferenceImage(null);
    runtime.current?.update({ ...info.current, placement: null });
    try {
      let v: ViewedStep;
      try {
        v = await setView(projectId, next.id, current.revision);
      } catch (cause) {
        // Revision conflict: another writer moved the cursor. Reload the
        // freshest view and retry once against that step, never silently.
        if (!(cause instanceof Error) || !/409|changed the viewed step/i.test(cause.message))
          throw cause;
        const fresh = await getView(projectId);
        viewRef.current = fresh;
        setViewed(fresh);
        const freshIndex = project.steps.findIndex((s) => s.id === fresh.step_id);
        const retryTarget = project.steps[freshIndex + offset];
        if (!retryTarget)
          return {
            ok: false,
            reason: "Project state revision conflict",
            detail: `Still at Step ${project.steps[freshIndex]?.position ?? "?"}`,
          };
        v = await setView(projectId, retryTarget.id, fresh.revision);
        viewRef.current = v;
        setViewed(v);
        setVerification({ step: "", verified: false });
        setError("");
        return {
          ok: true,
          detail: `Step ${project.steps[freshIndex].position} → ${retryTarget.position} (after revision reload)`,
        };
      }
      viewRef.current = v;
      setViewed(v);
      setVerification({ step: "", verified: false });
      setError("");
      return { ok: true, detail: `Step ${from.position} → ${next.position}` };
    } catch (e) {
      const message = errorMessage(e);
      setError(message);
      return {
        ok: false,
        reason: /409|changed the viewed step/i.test(message)
          ? "Project state revision conflict"
          : message,
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
        return verifyInAR("inspect");
      case "verify-again":
        return verifyAgain();
      case "exit":
        await exitAR();
        return { ok: true, detail: "XR session ended; microphone stopped" };
      case "re-anchor":
      case "reanchor":
        if (!runtime.current) return { ok: false, reason: "No active AR session — enter AR first" };
        runtime.current.reset();
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
        return { ok: true, detail: "Next text page" };
      case "voice": {
        // In-AR push-to-talk fallback: flush the live utterance when
        // continuous capture runs; otherwise capture exactly one command.
        if (localRef.current?.isListening) {
          await localRef.current.pushToTalk();
          return { ok: true, detail: "Speak now — one command will be transcribed" };
        }
        if (!localConsent)
          return {
            ok: false,
            reason: "Local voice not enabled — enable it with consent before entering AR, or use Next/Previous",
          };
        void recordOneLocalCommand();
        return { ok: true, detail: "Push-to-talk recording — speak one complete command" };
      }
      case "stop-listening":
        stopAllVoice();
        return { ok: true, detail: "Microphone recognition stopped" };
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
    actionRef.current = (a) => handleAction(a);
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

  function enableLocalVoice() {
    if (!localConsent || localOn || localRef.current?.isBusy || voiceBusy || micPending.current) return;
    setLocalBusy(true);
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
  async function advanceIfVerified(): Promise<void> {
    const m = machineRef.current;
    if (advancingRef.current || !viewRef.current.step_id || !project) return;
    advancingRef.current = true;
    try {
      const progress = await getProgress(projectId);
      const row = progress.find((r) => r.step_id === viewRef.current.step_id);
      if (row?.status !== "verified") return;
      if (!m) {
        const index = project.steps.findIndex((x) => x.id === viewRef.current.step_id);
        if (index >= 0 && index === project.steps.length - 1) {
          setAutoStatus("Assembly Complete — every step is verified. The anchored hologram stays until you exit AR.");
          return;
        }
        setAutoStatus("Step verified — advancing to the next step (staying in AR).");
        await navigate(1);
        autoWorkflow.current = null;
        gateRef.current.reset();
        return;
      }
      if (m.state !== "verified") {
        // Verified through the manual/companion path while autonomous is on.
        m.onVerifyResult(projectId, viewRef.current.step_id!, "verified");
      }
      const index = project.steps.findIndex((x) => x.id === viewRef.current.step_id);
      const isLast = index >= 0 && index === project.steps.length - 1;
      if (!m.confirmAdvance(isLast)) return;
      syncAutoLabel();
      if (isLast) {
        setAutoStatus("Assembly Complete — every step is verified. The anchored hologram stays until you exit AR.");
        return;
      }
      setAutoStatus(`Step ${project.steps[index].position} verified — advancing automatically…`);
      const outcome = await navigate(1);
      if (outcome.ok && viewRef.current.step_id) {
        autoWorkflow.current = null;
        gateRef.current.reset();
        m.onAdvanced(viewRef.current.step_id);
      } else {
        setAutoStatus(`Verified, but automatic advance failed: ${outcome.reason ?? "unknown"}. Use Next Step.`);
      }
      syncAutoLabel();
    } catch {
      setAutoStatus("Could not confirm server progress; automatic advance paused until the next update.");
    } finally {
      advancingRef.current = false;
    }
  }

  /** One in-AR inspection/verification against the existing Meta pipeline.
   *  Captures nothing itself — the caller supplies a genuinely fresh frame.
   *  Never ends the XR session. Returns the combined overall outcome. */
  async function performInARInspection(
    intent: "inspect" | "verify",
    frame: import("@/types/assembly").Snapshot,
    stepId: string,
  ): Promise<{ overallStatus: "correct" | "incorrect" | "uncertain" | "error"; verificationStatus?: string }> {
    const controller = new AbortController();
    autoAbort.current = controller;
    saveInspectionSummary(inspectingSummary(projectId, stepId));
    setResultSummary(inspectingSummary(projectId, stepId));
    setResultMode("result");
    runtime.current?.setViewMode("result");
    try {
      if (intent === "verify" && autoWorkflow.current) {
        const verification = await verifySnapshot(projectId, autoWorkflow.current, frame, controller.signal);
        if (controller.signal.aborted) return { overallStatus: "error" };
        autoWorkflow.current = verification.inspection;
        saveLastInspection({ projectId, stepId, inspectionId: verification.inspection.inspection_id });
        const summary = summarizeVerification(verification, projectId);
        saveInspectionSummary(summary);
        setResultSummary(summary);
        return {
          verificationStatus: verification.status,
          overallStatus: verification.status === "verified" ? "correct" : verification.status === "still_incorrect" ? "incorrect" : "uncertain",
        };
      }
      const diagnosis = await inspectSnapshot(projectId, stepId, frame, controller.signal);
      if (controller.signal.aborted) return { overallStatus: "error" };
      const workflow = isWorkflowInspection(diagnosis, stepId) ? diagnosis : null;
      if (workflow) {
        autoWorkflow.current = workflow;
        saveLastInspection({ projectId, stepId, inspectionId: workflow.inspection_id });
      }
      const summary = workflow ? summarizeInspection(workflow, projectId) : null;
      if (summary) { saveInspectionSummary(summary); setResultSummary(summary); }
      const overallStatus = workflow
        ? workflow.state === "correct" ? "correct"
          : ["correction_required", "still_incorrect"].includes(workflow.state) ? "incorrect"
          : "uncertain"
        : diagnosis.status;
      return { overallStatus: overallStatus === "correct" ? "correct" : overallStatus === "incorrect" ? "incorrect" : "uncertain" };
    } catch (cause) {
      if (controller.signal.aborted) return { overallStatus: "error" };
      const summary = autoErrorSummary(projectId, stepId, errorMessage(cause));
      saveInspectionSummary(summary);
      setResultSummary(summary);
      return { overallStatus: "error" };
    } finally {
      if (autoAbort.current === controller) autoAbort.current = null;
    }
  }
  async function runAutoTrigger(manual: boolean): Promise<void> {
    const m = machineRef.current;
    if (!m || !view.step_id || !project) return;
    const trigger = m.requestTrigger(Date.now(), { manual });
    syncAutoLabel();
    if (trigger.intent === "none") {
      if (trigger.reason) setAutoStatus(trigger.reason);
      return;
    }
    if (cameraSource === "manual" || !monitorRef.current?.live) {
      // No live monitor frame: use the existing secure camera handoff.
      const mode = trigger.intent === "verify" ? "verify" : "inspect";
      m.stop();
      machineRef.current = null;
      setAutoOn(false);
      setAutoStatus("Manual capture: opening the camera workspace for one fresh inspection frame.");
      await verify(mode);
      return;
    }
    const monitor = monitorRef.current;
    const frame = monitor.captureSnapshot();
    if (!frame) {
      m.onInspectResult(projectId, view.step_id, "error");
      setAutoStatus("No fresh camera frame was available. Check the camera and try Inspect Now.");
      syncAutoLabel();
      return;
    }
    const stepId = view.step_id;
    setAutoStatus(trigger.intent === "verify" ? "Verifying a fresh frame with Meta AI…" : "Inspecting a fresh frame with Meta AI — do not move the assembly.");
    const d = await performInARInspection(trigger.intent === "verify" ? "verify" : "inspect", frame, stepId);
    if (trigger.intent === "verify" && d.verificationStatus) {
      const outcome = m.onVerifyResult(projectId, stepId, d.verificationStatus as "verified" | "still_incorrect" | "uncertain");
      setAutoStatus(
        d.verificationStatus === "verified" ? "Step Verified — advancing…" :
        d.verificationStatus === "still_incorrect" ? "Still incorrect — follow the correction shown, then keep building; monitoring continues." :
        "Uncertain — another view is needed. Adjust the camera/assembly and wait for the next stable change.",
      );
      syncAutoLabel();
      if (outcome.intent === "advance") await advanceIfVerified();
    } else if (d.overallStatus === "error") {
      if (trigger.intent === "verify") m.onVerifyResult(projectId, stepId, "error");
      else m.onInspectResult(projectId, stepId, "error");
      setAutoStatus("Inspection failed — see the result panel. No step advance. Fix the connection, then Inspect Now.");
      syncAutoLabel();
    } else {
      m.onInspectResult(projectId, stepId, d.overallStatus);
      setAutoStatus(
        d.overallStatus === "correct" ? "ASSEMBLY LOOKS CORRECT — a separate fresh verification frame is still required." :
        d.overallStatus === "incorrect" ? "CORRECTION REQUIRED — see the issue and fix in the panel. Monitoring continues for your correction." :
        "ANOTHER VIEW NEEDED — make the assembly clearly visible; monitoring continues.",
      );
      syncAutoLabel();
    }
  }

  /* -------- Verify Step inside immersive AR (never exits XR) -------- */
  async function verifyInAR(mode: "inspect" | "verify" = "inspect"): Promise<ExecutionOutcome> {
    if (!active) return verify(mode); // explicit camera-workspace flow only outside XR
    if (!view.step_id || !project) return { ok: false, reason: "Current step is unknown" };
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
        const verdict = await monitor.probe(true, 900);
        if (verdict.status === "unavailable" || verdict.status === "stalled") {
          monitor.stop();
          return requestExternalFallback(mode, verdict.reasons.join(" "));
        }
        monitorRef.current = monitor;
      } catch (cause) {
        return requestExternalFallback(mode, errorMessage(cause));
      }
    }
    // 2) Freshness: the frame clock must advance between two samples.
    const first = monitor.sample();
    await new Promise((r) => setTimeout(r, 300));
    const second = monitor.sample();
    if (!first || !second || second.frameTime <= first.frameTime) {
      if (created) { monitor.stop(); if (monitorRef.current === monitor) monitorRef.current = null; }
      return requestExternalFallback(mode, "Camera frames are not advancing inside immersive AR.");
    }
    const frame = monitor.captureSnapshot();
    if (created && !autoOn) { monitor.stop(); if (monitorRef.current === monitor) monitorRef.current = null; }
    if (!frame || frame.width < 160 || frame.height < 120)
      return { ok: false, reason: "Camera unavailable in immersive AR. Connect an external camera or select a supported camera source." };
    setStatus("Inspecting with Meta AI inside AR — the session and anchored field stay active…");
    const intent = mode === "verify" && autoWorkflow.current ? "verify" : "inspect";
    const d = await performInARInspection(intent, frame, stepId);
    if (d.overallStatus === "error")
      return { ok: false, reason: "Inspection failed inside AR — see the result panel; AR and the anchored field are unchanged" };
    if (d.verificationStatus === "verified") {
      await advanceIfVerified();
      return { ok: true, detail: "Step verified by the backend — advancing inside AR" };
    }
    return {
      ok: d.overallStatus !== "incorrect",
      reason: d.overallStatus === "incorrect" ? "Correction required — see the AR result panel" : undefined,
      detail: d.overallStatus === "correct"
        ? "Looks correct — a separate fresh verification is still required (Verify Again)"
        : d.overallStatus === "incorrect" ? "Incorrect — correction shown in the AR panel; remain on this step"
        : "Uncertain — another view needed; AR session unchanged",
    };
  }

  async function requestExternalFallback(mode: "inspect" | "verify", why: string): Promise<ExecutionOutcome> {
    const code = pairingCode && validPairingCode(pairingCode) ? pairingCode : newPairingCode();
    if (code !== pairingCode) setPairingCode(code);
    if (!view.step_id) return { ok: false, reason: "Current step is unknown" };
    try {
      await requestExternalCapture(projectId, view.step_id, code, mode);
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
          await monitor.start(cameraSource === "external" && camDeviceId ? camDeviceId : undefined);
          monitorRef.current = monitor;
        }
        const frame = monitor.captureSnapshot();
        if (!frame) continue;
        const d = await performInARInspection(request.mode === "verify" && autoWorkflow.current ? "verify" : "inspect", frame, request.step_id);
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
  async function startAutonomous() {
    if (!project || !view.step_id || autoOn) return;
    const machine = new AutonomousMachine();
    machineRef.current = machine;
    gateRef.current.reset();
    autoWorkflow.current = null;
    machine.start(projectId, view.step_id);
    setAutoOn(true);
    setAutoPaused(false);
    syncAutoLabel();
    if (cameraSource === "manual") {
      machine.cameraReady(true);
      machine.anchored();
      syncAutoLabel();
      setAutoStatus("Manual camera mode: autonomous advance watches server verification. Use Inspect Now / Verify in the camera workspace; no continuous frames are captured.");
      return;
    }
    const monitor = new MonitorCamera();
    monitorRef.current = monitor;
    try {
      await monitor.start(cameraSource === "external" && camDeviceId ? camDeviceId : undefined);
    } catch (cause) {
      machine.cameraUnavailable();
      syncAutoLabel();
      setAutoStatus(`Camera unavailable: ${errorMessage(cause)}. Choose External tabletop camera (this page can run on the MacBook as companion) or Manual capture.`);
      return;
    }
    setAutoStatus("Camera started — probing whether frames actually advance…");
    const verdict = await monitor.probe(active);
    if (machineRef.current !== machine) return;
    if (verdict.status === "unavailable" || verdict.status === "stalled") {
      machine.cameraUnavailable();
      syncAutoLabel();
      setAutoStatus(`${verdict.reasons.join(" ")} Monitoring is NOT running on this camera. Select External tabletop camera or Manual capture; manual inspection still works.`);
      return;
    }
    machine.cameraReady(true);
    if (!active) machine.anchored(); // companion device: field lives on the HoloLens, synced by server step
    syncAutoLabel();
    setAutoStatus(active
      ? "Camera monitoring active in AR. Confirm the assembly field, then place blocks; stable changes trigger one inspection."
      : "External/companion camera monitoring active. The HoloLens follows the server step; confirm the field there.");
    let misses = 0;
    autoTimer.current = setInterval(() => {
      const m = machineRef.current;
      if (!m || m.busy || m.state === "paused" || m.state === "idle" || m.state === "completed") return;
      if (active) {
        const anchoredNow = runtime.current?.isAnchored ?? false;
        if (anchoredNow && m.state === "anchoring") { m.anchored(); syncAutoLabel(); }
        if (!anchoredNow && ["monitoring", "change_detected", "waiting_for_stability"].includes(m.state) && runtime.current?.anchorState === "tracking_lost") {
          m.anchorLost();
          setAutoStatus("TABLETOP TRACKING UNAVAILABLE — inspections paused. Re-anchor the assembly field.");
          syncAutoLabel();
        }
      }
      const sample = monitorRef.current?.sample() ?? null;
      if (!sample) {
        if (++misses > 10) {
          m.cameraUnavailable();
          setAutoStatus("Camera stopped delivering frames (disconnect or stall). Monitoring paused — no stale frames are used. Reconnect and Resume.");
          syncAutoLabel();
        }
        return;
      }
      misses = 0;
      if (m.state === "correct_awaiting_verification" && gateRef.current.freshFrame(sample)) {
        void runAutoTrigger(false);
        return;
      }
      const decision = gateRef.current.assess(sample);
      if (decision.kind === "changed") { m.changeDetected(); setAutoStatus("Assembly change detected — waiting for the construction to become stable…"); }
      else if (decision.kind === "stabilizing") { m.stabilizing(); setAutoStatus("Waiting for construction to become stable…"); }
      else if (decision.kind === "camera-moved") setAutoStatus("Camera movement detected — not counted as an assembly change.");
      else if (decision.kind === "occluded") setAutoStatus("Assembly appears obstructed — waiting for a clear view.");
      else if (decision.kind === "frozen") { m.cameraUnavailable(); setAutoStatus(decision.reason + " Monitoring paused; choose External or Manual."); }
      else if (decision.kind === "qualified") {
        gateRef.current.noteInspected(decision.hash);
        void runAutoTrigger(false);
      }
      syncAutoLabel();
    }, 600);
  }
  function pauseAutonomous() {
    const m = machineRef.current;
    if (!m) return;
    m.pause();
    setAutoPaused(true);
    syncAutoLabel();
    setAutoStatus("Monitoring paused. No Meta requests will be made until you resume.");
  }
  function resumeAutonomous() {
    const m = machineRef.current;
    if (!m) return;
    if (m.state === "camera_unavailable" && monitorRef.current?.live) m.cameraRecovered();
    m.resume();
    setAutoPaused(false);
    syncAutoLabel();
    setAutoStatus("Monitoring resumed.");
  }
  function stopAutonomous() {
    if (autoTimer.current) clearInterval(autoTimer.current);
    autoTimer.current = null;
    autoAbort.current?.abort();
    monitorRef.current?.stop();
    monitorRef.current = null;
    machineRef.current?.stop();
    machineRef.current = null;
    setAutoOn(false);
    setAutoPaused(false);
    setAutoStateLabel("idle");
    setAutoStatus("Autonomous Assembly stopped. Camera released; no automatic Meta requests will be made.");
  }

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
            stopAllVoice(true);
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
    setPlacement({
      target_block_id: b.block_id,
      instance: 1,
      origin: "tabletop_session",
      method: "manual_authoring",
      evidence: "approximate",
      confirmed: true,
      dimensions: { x_mm: 100, y_mm: 100, z_mm: 100 },
      studs: null,
      position_m: [0, 0, 0],
      rotation_deg: [0, 0, 0],
    });
  }
  return (
    <section className="panel ar-workspace" aria-label="Spatial assembly guidance">
      <h2>{project?.name ?? "Spatial guidance"}</h2>
      <p role="status">{cap.message}</p>
      <p>Device: {device}. Connection and physical alignment must be tested on your HoloLens.</p>
      <div className="form-actions">
        <button className="button primary" disabled={!cap.available || busy || active || !step || !online} onClick={() => void enter()}>
          Enter immersive AR
        </button>
        {active && (
          <>
            <button className="button secondary" onClick={() => runtime.current?.reset()}>Re-anchor tabletop</button>
            <button className="button secondary" onClick={() => runtime.current?.recenterPanel()}>Recenter panel</button>
            <button className="button danger ar-exit-large" onClick={() => void exitAR()}>Exit AR</button>
          </>
        )}
      </div>
      <p role="status">{status}</p>
      {active && (
        <details>
          <summary>XR interaction diagnostics (developer)</summary>
          <p role="status" aria-label="XR interaction diagnostics">{interactionUi || "No XR input source reported yet."}</p>
          <p>If no tracked hand ray is reported, HoloLens Edge has not provided a usable target ray for this session. The panel buttons on this page and the HoloLens Start gesture (Exit AR) remain available; no hand tracking is simulated.</p>
        </details>
      )}
      <p>{online ? "Connected to project state" : "Project state unavailable — hologram hidden and verification unknown"}</p>

      <fieldset className="ar-voice">
        <legend>Hands-free voice control</legend>
        <h3>Local voice control (Mac backend) — recommended on HoloLens</h3>
        <p role="status" aria-label="Local microphone state">{localOn || localBusy ? `Local voice: ${localStatus}` : `Local voice: Off — ${localStatus}`}</p>
        {localEngine && <p>{localEngine}</p>}
        <label>
          Voice language{" "}
          <select value={voiceLang} onChange={(e) => setVoiceLang(e.target.value)} disabled={voiceBusy || localOn || localBusy}>
            <option value="en-US">English (en-US)</option>
            <option value="de-DE">Deutsch (de-DE)</option>
          </select>
        </label>
        <p>
          How it works: short microphone clips from this device are sent over your
          private HTTPS connection to Whisper running locally on your MacBook.
          Clips are transcribed on the Mac and deleted immediately — no cloud
          speech service, no Meta inference, and no audio or transcripts are
          stored. Listening keeps one microphone stream alive and transcribes
          each spoken command while capture continues; you can stop it at any
          time. Enable local voice before entering AR so the same stream is
          kept across XR entry. Inside AR, the panel shows microphone state
          and the 🎤 Speak button is an explicit push-to-talk fallback; Next /
          Previous panel buttons always work.
        </p>
        <label>
          <input type="checkbox" checked={localConsent} onChange={(e) => {
            setLocalConsent(e.target.checked);
            if (!e.target.checked) stopLocalVoice();
          }} /> I agree to local voice transcription on my Mac as described above.
        </label>
        <div className="form-actions">
          {!localOn ? (
            <button className="button primary" disabled={!localConsent || localBusy || voiceBusy || micTest.state === "testing"} onClick={enableLocalVoice}>
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
        <h3>Browser speech recognition (legacy fallback — not reliable on HoloLens)</h3>
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
        <details open={helpVisible} onToggle={(e) => setHelpVisible((e.target as HTMLDetailsElement).open)}>
          <summary>Available voice commands</summary>
          <ul>
            {VOICE_COMMANDS.map((c) => (
              <li key={c.spoken}>“{c.spoken}” — {c.description}</li>
            ))}
          </ul>
          <p>German aliases ({voiceLang === "de-DE" ? "active language" : "set language to Deutsch to use"}): {GERMAN_ALIASES.map((g) => `“${g.spoken}”`).join(" · ")}</p>
          <p>Optional prefix: say “AssemblyPilot” before a command, e.g. “AssemblyPilot, next step”.</p>
        </details>
        {!voiceSupported.supported && (
          <p>Voice is unavailable in this browser. Use the large on-page and in-headset buttons. A native HoloLens Unity/OpenXR speech alternative is documented in docs/hololens.md.</p>
        )}
      </fieldset>


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
          {autoOn && <button className="button danger" onClick={stopAutonomous}>Stop Autonomous Assembly</button>}
          <button className="button secondary" disabled={!autoOn || cameraSource === "manual"} onClick={() => void runAutoTrigger(true)}>Inspect Now</button>
          <button className="button secondary" disabled={!active} onClick={() => runtime.current?.confirmOrigin()}>Confirm Assembly Field</button>
          <button className="button secondary" disabled={!active} onClick={() => runtime.current?.reset()}>Re-anchor Assembly Field</button>
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
        <p>Assembly field: {active ? anchorUi : "enter AR to place it"} · Field {runtime.current?.fieldSize.widthM ?? 0.48} m × {runtime.current?.fieldSize.depthM ?? 0.32} m · Anchors are session-local in HoloLens Edge; re-anchor after each new AR session. Registration is approximate — verified status comes only from the backend.</p>
      </fieldset>
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
        <button className="button secondary" disabled={!online || step?.position === 1} onClick={() => void navigate(-1)}>Previous</button>
        <button className="button secondary" disabled={!online || step?.position === totalSteps} onClick={() => void navigate(1)}>Next</button>
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
      {!placement && (
        <>
          <p>No usable 3D model or dimensions for this step. Nothing is drawn as an exact block.</p>
          <button className="button secondary" disabled={!step?.required_blocks.length} onClick={proxy}>
            Use 10 cm alignment box (approximate)
          </button>
        </>
      )}
      <div className="ar-preview">
        <h3>2D preview only — not mixed reality</h3>
        {placement ? (
          <>
            <svg viewBox={`${-previewExtent} ${-previewExtent} ${previewExtent * 2} ${previewExtent * 2}`} aria-label="2D intended placement" role="img">
              <path d={`M${-previewExtent} 0H${previewExtent} M0 ${-previewExtent}V${previewExtent}`} stroke="#879aaa" />
              <g transform={`translate(${placement.position_m[0] * 1000} ${placement.position_m[2] * 1000}) rotate(${-placement.rotation_deg[1]})`}>
                <rect x={-placement.dimensions.x_mm / 2} y={-placement.dimensions.z_mm / 2} width={placement.dimensions.x_mm} height={placement.dimensions.z_mm} fill="#38d9ff" fillOpacity={0.3} stroke="#8af5ff" />
              </g>
            </svg>
            <p>
              {target?.block.name} · {target?.block.color} · instance {placement.instance} / {target?.required_quantity} ·{" "}
              {placement.evidence} · {placement.dimensions.x_mm} × {placement.dimensions.y_mm} × {placement.dimensions.z_mm} mm
            </p>
          </>
        ) : (
          <p>Author confirmed dimensions in the step editor, or explicitly choose an approximate proxy.</p>
        )}
      </div>
      <Link href={`/projects/${projectId}`}>Edit project / AR placements</Link>
      {error && <p role="alert">{error}</p>}
      <div ref={host} className="xr-output" aria-label="Immersive XR output" />
    </section>
  );
}
