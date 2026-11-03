import type { ReferenceImage } from "@/types/blocks";
import type { ProjectStep } from "@/types/projects";

/**
 * The backend orders a step's images with the explicitly selected reference
 * first (see StepReferenceSelection / images_for). Index 0 is therefore the
 * selected expected assembly photograph, never a block-library photo.
 * Fallback: when no selection row exists the backend returns chronological
 * order, so index 0 is the earliest registered step photo.
 */
export function selectedStepReference(
  step: Pick<ProjectStep, "reference_images"> | null | undefined,
): ReferenceImage | null {
  if (!step?.reference_images?.length) return null;
  return step.reference_images[0] ?? null;
}

const TRUSTED_MEDIA = /^\/api\/media\/[a-zA-Z0-9-]+$/;

/** Only the existing trusted backend media endpoint may be loaded in XR. */
export function isTrustedMediaPath(path: string | null | undefined): boolean {
  return typeof path === "string" && TRUSTED_MEDIA.test(path);
}

export function trustedReferencePath(
  image: ReferenceImage | null | undefined,
): string | null {
  if (!image) return null;
  return isTrustedMediaPath(image.url) ? image.url : null;
}

/** Fit `iw x ih` inside `bw x bh` preserving aspect ratio (never stretch). */
export function fitRect(
  iw: number,
  ih: number,
  bw: number,
  bh: number,
): { x: number; y: number; w: number; h: number } {
  if (!(iw > 0) || !(ih > 0) || !(bw > 0) || !(bh > 0))
    return { x: 0, y: 0, w: bw, h: bh };
  const scale = Math.min(bw / iw, bh / ih);
  const w = Math.round(iw * scale);
  const h = Math.round(ih * scale);
  return { x: Math.round((bw - w) / 2), y: Math.round((bh - h) / 2), w, h };
}
