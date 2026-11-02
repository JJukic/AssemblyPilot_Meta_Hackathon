"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useResource } from "@/hooks/useResource";
import { registry } from "@/lib/registry";
import { getProgress } from "@/lib/inspection";
import { mediaUrl } from "@/lib/api";
import { AssemblyPanel } from "./AssemblyPanel";
import { InspectionPanel } from "@/components/inspection/InspectionPanel";
import { useWorkspaceSession } from "@/components/settings/WorkspaceSession";
import {
  clearVoiceVerifyIntent,
  readVoiceVerifyIntent,
  type VoiceVerifyIntent,
} from "@/lib/ar/voiceVerify";
import type { Assembly, Snapshot } from "@/types/assembly";
import type { GeometrySetup } from "@/types/calibration";

export function CustomAssembly({ projectId, initialStepId = "", snapshot, captureFresh, cameraReady, geometrySetup }: { projectId: string; initialStepId?: string; snapshot: Snapshot | null; captureFresh: () => Snapshot | null; cameraReady: boolean; geometrySetup: GeometrySetup | null }) {
  const { viewedStep, setViewedStep } = useWorkspaceSession();
  const current = viewedStep?.projectId === projectId ? viewedStep.index : null;
  const setCurrent = (index: number) => setViewedStep({ projectId, index });
  const load = useCallback(() => registry.project(projectId), [projectId]);
  const { data, error, reload } = useResource(load);
  const loadProgress = useCallback(() => getProgress(projectId), [projectId]);
  const progress = useResource(loadProgress);
  const refreshProgress = progress.reload;
  const [voiceIntent, setVoiceIntent] = useState<VoiceVerifyIntent | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setVoiceIntent(readVoiceVerifyIntent(projectId)), 0);
    return () => clearTimeout(timer);
  }, [projectId, initialStepId]);
  const specificationRef = useRef<string | null>(null);
  useEffect(() => {
    if (!progress.data) return;
    const version = progress.data.map((item) => `${item.step_id}:${item.specification_id}`).join("|");
    if (specificationRef.current !== null && specificationRef.current !== version) reload();
    specificationRef.current = version;
  }, [progress.data, reload]);
  useEffect(() => {
    const timer = setInterval(refreshProgress, 10000);
    window.addEventListener("focus", refreshProgress);
    return () => { clearInterval(timer); window.removeEventListener("focus", refreshProgress); };
  }, [refreshProgress]);
  if (error) return <section className="panel empty-state"><p role="alert">{error}</p><button className="button secondary" onClick={reload}>Retry project</button><Link href="/projects">Manage projects</Link></section>;
  if (!data) return <section className="panel empty-state" role="status">Loading assembly steps…</section>;
  if (!data.steps.length) return <section className="panel empty-state"><h2>{data.name}</h2><p>This project has no steps yet.</p><Link className="button primary" href={`/projects/${projectId}`}>Add your first step</Link></section>;
  const assembly: Assembly = {
    id: data.id, name: data.name, description: data.description ?? "Your custom assembly project.",
    steps: data.steps.map((step) => ({
      id: step.id, title: step.title, instruction: step.instruction,
      expected_parts: step.required_blocks.map((item) => ({ type: item.block.name, color: item.block.color, count: item.required_quantity })),
      reference_image: step.reference_images[0] ? mediaUrl(step.reference_images[0].url) : null,
    })),
  };
  const currentIndex = Math.min(current ?? Math.max(0, data.steps.findIndex(s => s.id === initialStepId)), assembly.steps.length - 1);
  const stepId = String(assembly.steps[currentIndex].id);
  const stepProgress = progress.data?.find((entry) => entry.step_id === stepId);
  const stepIntent = voiceIntent && voiceIntent.stepId === stepId ? voiceIntent : null;
  return <div className="inspection-column">
    <p className="step-progress" aria-live="polite">Step progress: {stepProgress?.status.replaceAll("_", " ") ?? "not available"}{progress.error && " · Progress could not be refreshed."}</p>
    {stepIntent && <section className="panel" aria-label="Voice verify">
      <h2>Voice {stepIntent.mode === "verify" ? "Verify Again" : "Verify Step"}</h2>
      <p role="status">Capturing a fresh HoloLens camera frame for this step and running the existing Meta {stepIntent.mode === "verify" ? "fresh-image verification" : "inspection"}. The result below is the real backend assessment.</p>
      <div className="form-actions">
        <button className="button secondary" onClick={() => { clearVoiceVerifyIntent(); setVoiceIntent(null); }}>Cancel voice verify</button>
        <Link className="button secondary" href={`/ar?project=${projectId}`}>Return to AR</Link>
      </div>
    </section>}
    <InspectionPanel key={`${data.id}:${stepId}:${snapshot?.capturedAt ?? "no-frame"}:${stepProgress?.specification_id ?? "unknown"}`} specificationId={stepProgress?.specification_id ?? "unknown"} projectId={data.id} projectName={data.name} stepId={stepId} stepTitle={assembly.steps[currentIndex].title} snapshot={snapshot} captureFresh={captureFresh} cameraReady={cameraReady} geometrySetup={geometrySetup} onProgressChange={refreshProgress} onContinue={currentIndex < assembly.steps.length - 1 ? () => setCurrent(currentIndex + 1) : undefined} autoIntent={stepIntent} onAutoIntentDone={() => { clearVoiceVerifyIntent(); setVoiceIntent(null); }} />
    <AssemblyPanel key={data.id} assembly={assembly} currentStep={currentIndex} onStepChange={setCurrent} />
  </div>;
}
