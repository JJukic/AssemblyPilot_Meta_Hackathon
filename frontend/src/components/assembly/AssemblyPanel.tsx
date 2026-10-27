"use client";

import { ArrowLeft, ArrowRight, Box, Layers3 } from "lucide-react";
import { useState } from "react";
import type { Assembly } from "@/types/assembly";
import { ProgressTracker } from "./ProgressTracker";
import { ReferenceImage } from "./ReferenceImage";

export function AssemblyPanel({ assembly, currentStep, onStepChange }: {
  assembly: Assembly; currentStep?: number; onStepChange?: (index: number) => void;
}) {
  const [internalCurrent, setInternalCurrent] = useState(0);
  const current = currentStep ?? internalCurrent;
  const setCurrent = onStepChange ?? setInternalCurrent;
  const step = assembly.steps[current];
  return (
    <section className="panel assembly-panel" aria-labelledby="assembly-heading">
      <div className="panel-heading">
        <div className="heading-with-icon"><Layers3 size={19} /><h2 id="assembly-heading">Assembly guide</h2></div>
        <span className="tag">MANUAL</span>
      </div>
      <div className="assembly-content">
        <p className="eyebrow">{assembly.id === "demo-lego" ? "PRACTICE BUILD" : "CUSTOM BUILD"}</p>
        <h3 className="assembly-name">{assembly.name}</h3>
        <p className="muted assembly-description">{assembly.description}</p>
        <ProgressTracker steps={assembly.steps} current={current} onSelect={setCurrent} />
        <div className="instruction" aria-live="polite" aria-atomic="true">
          <p className="step-count">STEP {String(current + 1).padStart(2, "0")} <span>/ {String(assembly.steps.length).padStart(2, "0")}</span></p>
          <h3>{step.title}</h3>
          <p>{step.instruction}</p>
          <h4>PARTS TO ADD</h4>
          <ul className="parts-list">
            {step.expected_parts.map((part, index) => (
              <li key={`${part.color}-${part.type}-${index}`}>
                <span className="part-icon"><Box size={19} /></span>
                <span><strong>{part.type}</strong><small>{part.color}</small></span>
                <span className="part-count">×{part.count}</span>
              </li>
            ))}
          </ul>
        </div>
        <h4 className="reference-label">REFERENCE</h4>
        <ReferenceImage key={step.id} path={step.reference_image} title={step.title} />
        <div className="step-navigation">
          <button className="button secondary" disabled={current === 0} onClick={() => setCurrent(current - 1)}><ArrowLeft size={15} /> Previous</button>
          <button className="button primary" disabled={current === assembly.steps.length - 1} onClick={() => setCurrent(current + 1)}>Next step <ArrowRight size={15} /></button>
        </div>
        <p className="manual-note">Navigate at your own pace. Steps are not AI verified.</p>
      </div>
    </section>
  );
}
