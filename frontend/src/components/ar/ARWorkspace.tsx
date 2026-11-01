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
  type RecognitionLike,
  type VoiceAction,
  type VoiceSnapshot,
} from "@/lib/ar/voice";
import { LocalVoiceController, backendVoiceApi } from "@/lib/ar/voiceLocal";
import {
  readLastInspection,
  saveVoiceVerifyIntent,
} from "@/lib/ar/voiceVerify";
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
  const [localOn, setLocalOn] = useState(false),
    [localStatus, setLocalStatus] = useState("Local voice off (recommended on HoloLens)."),
    [localConsent, setLocalConsent] = useState(false),
    [localEngine, setLocalEngine] = useState("");
  const localRef = useRef<LocalVoiceController | null>(null);
  const voiceRef = useRef<VoiceController | null>(null);
  const actionRef = useRef<(action: Action | VoiceAction) => void>(() => {});
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
      lastCommand: lastCommand || undefined,
    };
    runtime.current?.update(info.current);
    runtime.current?.setShowReference(showReference);
    runtime.current?.setHelpVisible(helpVisible);
  }, [placement, step, target, verified, online, totalSteps, refPath, voiceLabel, voiceMessage, voice.errorCode, lastCommand, showReference, helpVisible, verificationStatus, localOn, localStatus]);

  async function navigate(offset: number) {
    if (!project || !online) return;
    const index = project.steps.findIndex((s) => s.id === view.step_id),
      next = project.steps[index + offset];
    if (!next) return;
    setPlacement(null);
    runtime.current?.setReferenceImage(null);
    runtime.current?.update({ ...info.current, placement: null });
    try {
      const v = await setView(projectId, next.id, view.revision);
      setViewed(v);
      setVerification({ step: "", verified: false });
      setError("");
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function verify(mode: "inspect" | "verify" = "inspect") {
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
  }
  async function verifyAgain() {
    if (!view.step_id) return;
    const last = readLastInspection(projectId, view.step_id);
    if (!last)
      setStatus("Verify Again: no previous inspection for this step yet — running a first inspection instead.");
    await verify(last ? "verify" : "inspect");
  }
  async function exitAR() {
    stopAllVoice(true);
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    await runtime.current?.end();
    setActive(false);
    setStatus("XR session ended. Microphone stopped. Re-enter and re-anchor before continuing.");
  }
  async function handleAction(a: Action | VoiceAction) {
    switch (a) {
      case "next":
        await navigate(1);
        break;
      case "previous":
        await navigate(-1);
        break;
      case "verify":
        await verify();
        break;
      case "verify-again":
        await verifyAgain();
        break;
      case "exit":
        await exitAR();
        break;
      case "re-anchor":
      case "reanchor":
        runtime.current?.reset();
        break;
      case "recenter":
        runtime.current?.recenterPanel();
        break;
      case "reference":
        setShowReference((v) => {
          runtime.current?.setShowReference(!v);
          return !v;
        });
        break;
      case "show-reference":
        setShowReference(true);
        runtime.current?.setShowReference(true);
        break;
      case "hide-reference":
        setShowReference(false);
        runtime.current?.setShowReference(false);
        break;
      case "show-instructions":
        document.getElementById("ar-full-instruction")?.scrollIntoView({ block: "nearest" });
        break;
      case "read-instructions":
        if (readAloud && step && "speechSynthesis" in window) {
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(new SpeechSynthesisUtterance(step.instruction));
        } else if (!readAloud) {
          setVoiceStatus("Read-aloud is off — enable “Read instructions aloud” to use this command.");
        }
        break;
      case "help":
        setHelpVisible((v) => !v);
        break;
      case "page":
        break; // runtime cycles its own text page
      case "stop-listening":
        stopAllVoice();
        break;
    }
  }
  useEffect(() => {
    actionRef.current = (a) => handleAction(a);
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
          setLastCommand(cmd.phrase);
          setVoiceStatus(`Heard: “${cmd.phrase}”`);
          controller.gate.setPending(true);
          // Always dispatch through the ref so the latest step/view closure runs.
          void (
            actionRef.current as unknown as (a: VoiceAction) => Promise<void>
          )(cmd.action).catch((e) => {
            if (alive.current) setVoiceStatus(`Command failed: ${errorMessage(e)}`);
          }).finally(() => controller.gate.setPending(false));
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
    if (!localConsent || localOn) return;
    localRef.current?.dispose();
    const controller = new LocalVoiceController({
      language: voiceLang.startsWith("de") ? "de" : "en",
      onCommand: async (cmd) => {
        if (!alive.current) return;
        setLastCommand(cmd.phrase);
        setLocalStatus(`Heard: “${cmd.phrase}”`);
        await (
          actionRef.current as unknown as (a: VoiceAction) => Promise<void>
        )(cmd.action);
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
      if (!ok && alive.current) setLocalOn(false);
    });
  }

  async function recordOneLocalCommand() {
    if (!localConsent || localOn) return;
    if (!localRef.current) {
      localRef.current = new LocalVoiceController({
        language: voiceLang.startsWith("de") ? "de" : "en",
        onCommand: async (cmd) => {
          setLastCommand(cmd.phrase);
          setLocalStatus(`Heard: “${cmd.phrase}”`);
          await (
            actionRef.current as unknown as (a: VoiceAction) => Promise<void>
          )(cmd.action);
        },
        onStatus: (s) => {
          if (alive.current) setLocalStatus(s);
        },
        onError: (s) => {
          if (alive.current) setLocalStatus(s);
        },
      });
    }
    await localRef.current.recordOnce();
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
        <p role="status" aria-label="Local microphone state">{localOn ? `Local voice: Listening — ${localStatus}` : `Local voice: Off — ${localStatus}`}</p>
        {localEngine && <p>{localEngine}</p>}
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
            <button className="button primary" disabled={!localConsent} onClick={enableLocalVoice}>
              Enable local voice control
            </button>
          ) : (
            <button className="button danger" onClick={stopLocalVoice}>Stop local listening</button>
          )}
          <button
            className="button secondary"
            disabled={!localConsent || localOn}
            onClick={() => void recordOneLocalCommand()}
          >
            Record one command (push-to-talk)
          </button>
        </div>
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
          Voice language{" "}
          <select value={voiceLang} onChange={(e) => setVoiceLang(e.target.value)} disabled={voiceBusy}>
            <option value="en-US">English (en-US)</option>
            <option value="de-DE">Deutsch (de-DE)</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={readAloud} onChange={(e) => setReadAloud(e.target.checked)} /> Read
          instructions aloud (“Read instructions” command)
        </label>
        <div className="form-actions">
          {!voiceBusy ? (
            <button className="button primary" disabled={!voiceSupported.supported || !consent || micTest.state === "testing"} onClick={enableVoice}>
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
          <button className="button secondary" disabled={voiceBusy || micTest.state === "testing"} onClick={() => void testMicrophone()}>Test microphone access</button>
          <p role="status" aria-label="Microphone test result">{micTest.message}</p>
        </div>
        {lastCommand && <p>Last recognized command: “{lastCommand}”</p>}
        <details>
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
      <h4>Expected assembly reference (guidance only — not proof of your build)</h4>
      {refPath && selectedRef ? (
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
