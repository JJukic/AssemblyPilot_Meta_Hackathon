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
import { LocalVoiceController, backendVoiceApi } from "@/lib/ar/voiceLocal";
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
import { getProgress } from "@/lib/inspection";
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
  const viewRef = useRef<ViewedStep>({ step_id: null, revision: 0 });
  const [localOn, setLocalOn] = useState(false),
    [localBusy, setLocalBusy] = useState(false),
    [localStatus, setLocalStatus] = useState("Local voice off (recommended on HoloLens)."),
    [localConsent, setLocalConsent] = useState(false),
    [localEngine, setLocalEngine] = useState("");
  const localRef = useRef<LocalVoiceController | null>(null);
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
  }, [placement, step, target, verified, online, totalSteps, refPath, voiceLabel, voiceMessage, voice.errorCode, lastCommand, showReference, helpVisible, verificationStatus, localOn, localStatus, diagnostic, resultSummary, resultMode, resultErrorsOnly]);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

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
    const outcome = await verify(last ? "verify" : "inspect");
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
        return verify();
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
        if (alive.current) setActive(true);
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
          stored. Listening runs in bounded windows; you can stop it at any
          time. If microphone access during immersive AR is unreliable on your
          headset, enable local voice before entering AR or use the one-command
          push-to-talk button.
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
