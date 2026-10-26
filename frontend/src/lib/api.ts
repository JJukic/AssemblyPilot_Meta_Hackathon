export interface HealthResponse {
  status: "ok";
  service: "assemblypilot-backend";
  version: string;
}

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

export async function checkHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const timeout = AbortSignal.timeout(5000);
  const response = await fetch(`${API_URL}/health`, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
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

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: { ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...options.headers },
      cache: "no-store",
      signal: options.signal ?? AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error("Cannot reach the backend. Check that it is running, then retry.");
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new Error(responseMessage(body) ?? `Request failed (HTTP ${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please retry.";
}
