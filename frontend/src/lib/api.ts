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
