export interface HealthResponse {
  status: "ok";
  service: "assemblypilot-backend";
  version: string;
}

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

// HoloLens Edge may lack AbortSignal.timeout/any. Keep cancellation and deadlines
// without requiring those newer browser APIs, and release listeners after parsing.
async function withRequestTimeout<T>(
  timeoutMs: number,
  signal: AbortSignal | null | undefined,
  request: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timer = timeoutMs > 0 ? setTimeout(abort, timeoutMs) : undefined;
  try {
    return await request(controller.signal);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export async function checkHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return withRequestTimeout(5000, signal, async (requestSignal) => {
    const response = await fetch(`${API_URL}/health`, {
      signal: requestSignal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Backend returned HTTP ${response.status}`);
    const body: unknown = await response.json();
    if (
      !body || typeof body !== "object" ||
      !("status" in body) || body.status !== "ok" ||
      !("service" in body) || body.service !== "assemblypilot-backend" ||
      !("version" in body) || typeof body.version !== "string"
    ) throw new Error("Unexpected backend health response");
    return body as HealthResponse;
  });
}

export function mediaUrl(path: string): string {
  // Only accept the backend's registered media route, never a local storage path.
  if (!/^\/api\/media\/[a-zA-Z0-9-]+$/.test(path)) throw new Error("Invalid media reference");
  return `${API_URL}${path}`;
}

function responseMessage(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("detail" in body)) return null;
  const detail = body.detail;
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object" && "message" in detail && typeof detail.message === "string") return detail.message;
  if (Array.isArray(detail)) {
    return detail.map((item: unknown) => {
      if (!item || typeof item !== "object" || !("msg" in item)) return "Invalid field";
      const field = "loc" in item && Array.isArray(item.loc) ? item.loc.slice(1).join(".") : "Field";
      return `${field}: ${String(item.msg)}`;
    }).join("; ");
  }
  return null;
}

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = "ApiError"; }
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  // Explicit caller signals retain their own deadlines (e.g. long inspections).
  return withRequestTimeout(options.signal ? 0 : 15000, options.signal, async (signal) => {
    let response: Response;
    try {
      response = await fetch(`${API_URL}${path}`, {
        ...options,
        headers: { ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...options.headers },
        cache: "no-store",
        signal,
      });
    } catch {
      throw new Error("Cannot reach the backend. Check that it is running, then retry.");
    }
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      throw new ApiError(responseMessage(body) ?? `Request failed (HTTP ${response.status})`, response.status);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please retry.";
}
