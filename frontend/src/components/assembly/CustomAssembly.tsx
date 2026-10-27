"use client";
import Link from "next/link";
import { useCallback, useState } from "react";
import { useResource } from "@/hooks/useResource";
import { registry } from "@/lib/registry";
import { mediaUrl } from "@/lib/api";
import { AssemblyPanel } from "./AssemblyPanel";
import { InspectionPanel } from "@/components/inspection/InspectionPanel";
import type { Assembly, Snapshot } from "@/types/assembly";

export function CustomAssembly({ projectId, snapshot }: { projectId: string; snapshot: Snapshot | null }) {
  const [current, setCurrent] = useState(0);
  const load = useCallback(() => registry.project(projectId), [projectId]);
  const { data, error, reload } = useResource(load);
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
  const currentIndex = Math.min(current, assembly.steps.length - 1);
  const stepId = String(assembly.steps[currentIndex].id);
  return <div className="inspection-column">
    <InspectionPanel key={`${data.id}:${stepId}:${snapshot?.capturedAt ?? "no-frame"}`} projectId={data.id} projectName={data.name} stepId={stepId} stepTitle={assembly.steps[currentIndex].title} snapshot={snapshot} />
    <AssemblyPanel key={data.id} assembly={assembly} currentStep={currentIndex} onStepChange={setCurrent} />
  </div>;
}
