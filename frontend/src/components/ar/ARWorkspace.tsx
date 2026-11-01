"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { registry } from "@/lib/registry";
import { errorMessage } from "@/lib/api";
import {
  capabilities,
  getPlacement,
  getView,
  setView,
  validPlacement,
  type Placement,
  type ViewedStep,
} from "@/lib/ar/data";
import { getProgress } from "@/lib/inspection";
import type { ProjectDetail } from "@/types/projects";
import type { SpatialSession, Action, Guidance } from "@/lib/ar/runtime";
export function ARWorkspace({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<ProjectDetail | null>(null),
    [view, setViewed] = useState<ViewedStep>({ step_id: null, revision: 0 });
  const router = useRouter();
  const [rawPlacement, setPlacement] = useState<Placement | null>(null),
    [loadedFor, setLoadedFor] = useState("");
  const [verification, setVerification] = useState({
      step: "",
      verified: false,
    }),
    [online, setOnline] = useState(false);
  const [device, setDevice] = useState("Checking");
  const [cap, setCap] = useState({
    available: false,
    message: "Checking this device…",
  });
  const [status, setStatus] = useState("No XR session started."),
    [busy, setBusy] = useState(false),
    [active, setActive] = useState(false),
    [error, setError] = useState("");
  const host = useRef<HTMLDivElement>(null),
    runtime = useRef<SpatialSession | null>(null),
    alive = useRef(true),
    generation = useRef(0);
  const actionRef = useRef<(action: Action) => void>(() => {}),
    info = useRef<Guidance>({
      placement: null,
      text: "Loading",
      detail: "Unverified",
    });
  const step = project?.steps.find((s) => s.id === view.step_id);
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
  const target = step?.required_blocks.find(
    (b) => b.block_id === placement?.target_block_id,
  );
  const verificationUrl = `/?project=${encodeURIComponent(projectId)}&step=${encodeURIComponent(view.step_id ?? "")}`;
  useEffect(() => {
    alive.current = true;
    generation.current++;
    void capabilities().then((c) => {
      if (alive.current) {
        setCap(c);
        setDevice(navigator.userAgent);
      }
    });
    return () => {
      alive.current = false;
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
          v.revision >= old.revision ||
          !p.steps.some((s) => s.id === old.step_id)
            ? v
            : old,
        );
        setVerification({
          step: v.step_id ?? "",
          verified: progress.some(
            (s) => s.step_id === v.step_id && s.status === "verified",
          ),
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
        if (p && !validPlacement(p))
          throw new Error("Invalid AR dimensions or placement");
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
  // Never leave an old step's target visible while its replacement is loading.
  useEffect(() => {
    info.current = {
      placement: online ? placement : null,
      text: step
        ? `Step ${step.position} — ${step.instruction}`
        : "Choose a project step",
      detail: `${placement?.evidence.toUpperCase() ?? "NO MODEL"} · ${verified && online ? "Inspection verified" : "Not verified"} · ${target?.block.color ?? ""} ${target?.block.name ?? ""} · ${placement?.instance ?? "?"}/${target?.required_quantity ?? "?"}`,
    };
    runtime.current?.update(info.current);
  }, [placement, step, target, verified, online]);
  async function navigate(offset: number) {
    if (!project || !online) return;
    const index = project.steps.findIndex((s) => s.id === view.step_id),
      next = project.steps[index + offset];
    if (!next) return;
    setPlacement(null);
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
  async function verify() {
    await runtime.current?.end();
    router.push(verificationUrl);
  }
  useEffect(() => {
    actionRef.current = (a) => {
      if (a === "verify") void verify();
      else void navigate(a === "next" ? 1 : -1);
    };
  });
  async function enter() {
    if (!navigator.xr || !cap.available || busy || !host.current) return;
    setBusy(true);
    setError("");
    const epoch = ++generation.current;
    try {
      // requestSession is invoked directly in this click handler, before any awaited import.
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
            if (alive.current) {
              setActive(false);
              setStatus(
                "XR session ended. Re-enter and re-anchor before continuing.",
              );
            }
          },
        );
        runtime.current = instance;
        await instance.initialize();
        instance.update(info.current);
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
    <section
      className="panel ar-workspace"
      aria-label="Spatial assembly guidance"
    >
      <h2>{project?.name ?? "Spatial guidance"}</h2>
      <p role="status">{cap.message}</p>
      <p>
        Device: {device}. Connection and physical alignment must be tested on
        your HoloLens.
      </p>
      <div className="form-actions">
        <button
          className="button primary"
          disabled={!cap.available || busy || active || !step || !online}
          onClick={() => void enter()}
        >
          Enter immersive AR
        </button>
        {active && (
          <>
            <button
              className="button secondary"
              onClick={() => runtime.current?.reset()}
            >
              Re-anchor tabletop
            </button>
            <button
              className="button secondary"
              onClick={() => void runtime.current?.end()}
            >
              Exit AR
            </button>
          </>
        )}
      </div>
      <p role="status">{status}</p>
      <p>
        {online
          ? "Connected to project state"
          : "Project state unavailable — hologram hidden and verification unknown"}
      </p>
      <h3>
        Step {step?.position ?? "—"} — {step?.title}
      </h3>
      <p>{step?.instruction}</p>
      <p>
        {verified && online
          ? "Inspection verified — this does not certify AR alignment."
          : "Manually viewed / not verified"}
      </p>
      <div className="form-actions">
        <button
          className="button secondary"
          disabled={!online || step?.position === 1}
          onClick={() => void navigate(-1)}
        >
          Previous
        </button>
        <button
          className="button secondary"
          disabled={!online || step?.position === project?.steps.length}
          onClick={() => void navigate(1)}
        >
          Next
        </button>
        <button
          className="button primary"
          disabled={!step || !online}
          onClick={() => void verify()}
        >
          Verify Step — camera workspace
        </button>
      </div>
      <p>
        In AR, aim a supported hand/controller ray or gaze pointer at a floating
        button and select/pinch. Verification exits AR and opens the existing
        camera workflow. If this device cannot capture images, open the same
        verification link on your iPhone/Mac and return here; verified status
        refreshes automatically.
      </p>
      <Link href={verificationUrl}>
        Verification link for this project and step
      </Link>
      {!placement && (
        <>
          <p>
            No usable 3D model or dimensions for this step. Nothing is drawn as
            an exact block.
          </p>
          <button
            className="button secondary"
            disabled={!step?.required_blocks.length}
            onClick={proxy}
          >
            Use 10 cm alignment box (approximate)
          </button>
        </>
      )}
      <div className="ar-preview">
        <h3>2D preview only — not mixed reality</h3>
        {placement ? (
          <>
            <svg
              viewBox={`${-previewExtent} ${-previewExtent} ${previewExtent * 2} ${previewExtent * 2}`}
              aria-label="2D intended placement"
              role="img"
            >
              <path
                d={`M${-previewExtent} 0H${previewExtent} M0 ${-previewExtent}V${previewExtent}`}
                stroke="#879aaa"
              />
              <g
                transform={`translate(${placement.position_m[0] * 1000} ${placement.position_m[2] * 1000}) rotate(${-placement.rotation_deg[1]})`}
              >
                <rect
                  x={-placement.dimensions.x_mm / 2}
                  y={-placement.dimensions.z_mm / 2}
                  width={placement.dimensions.x_mm}
                  height={placement.dimensions.z_mm}
                  fill="#38d9ff"
                  fillOpacity={0.3}
                  stroke="#8af5ff"
                />
              </g>
            </svg>
            <p>
              {target?.block.name} · {target?.block.color} · instance{" "}
              {placement.instance} / {target?.required_quantity} ·{" "}
              {placement.evidence} · {placement.dimensions.x_mm} ×{" "}
              {placement.dimensions.y_mm} × {placement.dimensions.z_mm} mm
            </p>
          </>
        ) : (
          <p>
            Author confirmed dimensions in the step editor, or explicitly choose
            an approximate proxy.
          </p>
        )}
      </div>
      <Link href={`/projects/${projectId}`}>Edit project / AR placements</Link>
      {error && <p role="alert">{error}</p>}
      <div ref={host} className="xr-output" aria-label="Immersive XR output" />
    </section>
  );
}
