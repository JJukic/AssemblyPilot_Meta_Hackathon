import { apiRequest } from "./api";
import type { BlockInput, BuildingBlock, ReferenceImage } from "@/types/blocks";
import type { Project, ProjectDetail, ProjectInput, ProjectStep, StepInput } from "@/types/projects";

const json = (method: string, data: unknown) => ({ method, body: JSON.stringify(data) });
export const registry = {
  blocks: (filters?: { search?: string; color?: string; category?: string }) => {
    const query = new URLSearchParams(filters).toString();
    return apiRequest<BuildingBlock[]>(`/api/blocks${query ? `?${query}` : ""}`);
  },
  saveBlock: (data: BlockInput, id?: string) => apiRequest<BuildingBlock>(`/api/blocks${id ? `/${id}` : ""}`, json(id ? "PUT" : "POST", data)),
  deleteBlock: (id: string) => apiRequest<void>(`/api/blocks/${id}`, { method: "DELETE" }),
  projects: () => apiRequest<Project[]>("/api/projects"),
  project: (id: string) => apiRequest<ProjectDetail>(`/api/projects/${id}`),
  saveProject: (data: ProjectInput, id?: string) => apiRequest<Project>(`/api/projects${id ? `/${id}` : ""}`, json(id ? "PUT" : "POST", data)),
  deleteProject: (id: string) => apiRequest<void>(`/api/projects/${id}`, { method: "DELETE" }),
  saveStep: (projectId: string, data: StepInput, id?: string) => apiRequest<ProjectStep>(`/api/projects/${projectId}/steps${id ? `/${id}` : ""}`, json(id ? "PUT" : "POST", data)),
  deleteStep: (projectId: string, id: string) => apiRequest<void>(`/api/projects/${projectId}/steps/${id}`, { method: "DELETE" }),
  reorderSteps: (projectId: string, ids: string[]) => apiRequest<ProjectStep[]>(`/api/projects/${projectId}/steps/order`, json("PUT", { step_ids: ids })),
  uploadImage: (endpoint: string, file: File) => {
    const body = new FormData(); body.append("image", file);
    return apiRequest<ReferenceImage>(endpoint, { method: "POST", body });
  },
  deleteImage: (id: string) => apiRequest<void>(`/api/media/${id}`, { method: "DELETE" }),
};
