import { apiRequest } from "./api";
import type { ProjectDetail } from "@/types/projects";
export interface SetupBlock { key: string; existing_id: string | null; name: string; color: string; quantity: number; printed_text: string; logo_description: string; photo: string | null }
export interface PlanStep { title: string; instruction: string; parts: { block_key: string; quantity: number }[]; print_check: { block_key: string; expected_text: string } | null; reference_suggestion: string; limitations: string[] }
export interface AssemblyPlan { steps: PlanStep[] }
export interface SetupDescription { name: string; description: string; step_instructions: string; blocks: SetupBlock[]; finished_photo: string | null }
export interface SetupCommit extends SetupDescription { request_id: string; confirmed: true; source: "manual" | "meta" | "template"; mode: "simple" | "advanced"; plan: AssemblyPlan; step_photos: Record<string, string> }
function multipart(payload: SetupDescription, photos: Record<string, File>) {
  const body = new FormData(); body.append("payload", JSON.stringify(payload));
  for (const [key, file] of Object.entries(photos)) body.append("photos", file, key);
  return body;
}
export function generatePlan(payload: SetupDescription, photos: Record<string, File>, signal: AbortSignal) {
  return apiRequest<{ plan: AssemblyPlan; model: string }>("/api/setup/draft", { method: "POST", body: multipart(payload, photos), signal: AbortSignal.any([signal, AbortSignal.timeout(190000)]) });
}
export function saveSetup(payload: SetupCommit, photos: Record<string, File>, signal: AbortSignal) {
  return apiRequest<ProjectDetail>("/api/setup/projects", { method: "POST", body: multipart(payload, photos), signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]) });
}

export function validPlan(value: unknown, blocks: SetupBlock[]): value is AssemblyPlan {
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  const text = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
  if (!object(value) || Object.keys(value).length !== 1 || !Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > 20) return false;
  return value.steps.every((s) => {
    if (!object(s) || Object.keys(s).some((key) => !["title", "instruction", "parts", "print_check", "reference_suggestion", "limitations"].includes(key)) || !text(s.title, 160) || !text(s.instruction, 4000) || !Array.isArray(s.parts) || !s.parts.length || s.parts.length > 20 || !Array.isArray(s.limitations) || s.limitations.length > 10 || !s.limitations.every((v) => text(v, 500)) || typeof s.reference_suggestion !== "string" || s.reference_suggestion.length > 1000) return false;
    const ids = new Set<string>();
    for (const p of s.parts) {
      if (!object(p) || typeof p.block_key !== "string" || !Number.isInteger(p.quantity) || Number(p.quantity) < 1 || !blocks.some((b) => b.key === p.block_key && Number(p.quantity) <= b.quantity) || ids.has(p.block_key)) return false;
      ids.add(p.block_key);
    }
    const print = s.print_check;
    return print === null || (object(print) && text(print.expected_text, 500) && s.parts.some((p) => p.block_key === print.block_key && p.quantity === 1));
  });
}
