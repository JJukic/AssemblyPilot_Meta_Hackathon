import type { AssemblyStep } from "@/types/assembly";

export function ProgressTracker({ steps, current, onSelect }: {
  steps: AssemblyStep[]; current: number; onSelect: (index: number) => void;
}) {
  return (
    <nav aria-label="Assembly steps" className="progress-tracker">
      {steps.map((step, index) => (
        <button key={step.id} className={`step-marker ${index === current ? "active" : ""}`}
          aria-label={`Step ${index + 1}: ${step.title}`} aria-current={index === current ? "step" : undefined}
          onClick={() => onSelect(index)}>
          <span>{String(index + 1).padStart(2, "0")}</span>
        </button>
      ))}
    </nav>
  );
}
