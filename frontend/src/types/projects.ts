import type { BuildingBlock, ReferenceImage } from "./blocks";
import type { StudOffsetConstraint } from "./geometry";

export interface ProjectInput { name: string; description: string | null }
export interface Project extends ProjectInput {
  id: string;
  created_at: string;
  updated_at: string;
  step_count: number;
}
export interface StepBlockInput { block_id: string; required_quantity: number }
export interface StepInput {
  title: string;
  instruction: string;
  position?: number;
  required_blocks: StepBlockInput[];
  spatial_constraint?: Omit<StudOffsetConstraint, "id"> | null;
}
export interface ProjectStep extends StepInput {
  id: string;
  project_id: string;
  position: number;
  required_blocks: (StepBlockInput & { block: BuildingBlock })[];
  reference_images: ReferenceImage[];
  spatial_constraint: StudOffsetConstraint | null;
  created_at: string;
  updated_at: string;
}
export interface ProjectDetail extends Project { steps: ProjectStep[] }
