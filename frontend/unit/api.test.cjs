/* eslint-disable @typescript-eslint/no-require-imports -- Isolated TS client harness. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const source = ts.transpileModule(
  fs.readFileSync(require.resolve("../src/lib/api.ts"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } },
).outputText;
const health = { status: "ok", service: "assemblypilot-backend", version: "0.1.0" };

function client(fetch, apiUrl = "") {
  const timers = new Map();
  const exports = {};
  vm.runInNewContext(source, {
    exports, fetch, AbortController, FormData, Error,
    // Simulate Edge without the static AbortSignal methods.
    AbortSignal: {},
    process: { env: { NEXT_PUBLIC_API_URL: apiUrl } },
    setTimeout(callback, ms) { timers.set(callback, ms); return callback; },
    clearTimeout(timer) { timers.delete(timer); },
  });
  return { ...exports, timers };
}

function pendingFetch(_url, { signal }) {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(new Error("aborted"));
    else signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
}

test("health and saved projects use same-origin HTTPS paths without static AbortSignal APIs", async () => {
  const calls = [];
  const projects = [{ id: "saved", name: "Lego Tower", step_count: 4 }];
  const api = client(async (url, options) => {
    calls.push({ url, options });
    return Response.json(url === "/health" ? health : projects);
  });
  assert.deepEqual(await api.checkHealth(), health);
  assert.deepEqual(await api.apiRequest("/api/projects"), projects);
  assert.deepEqual(calls.map(({ url }) => url), ["/health", "/api/projects"]);
  assert.ok(calls.every(({ options }) => options.cache === "no-store"));
  assert.equal(api.timers.size, 0);
});

test("health keeps its five-second deadline and releases cancellation listeners", async () => {
  const controller = new AbortController();
  let listeners = 0;
  const add = controller.signal.addEventListener.bind(controller.signal);
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = (...args) => { listeners++; return add(...args); };
  controller.signal.removeEventListener = (...args) => { listeners--; return remove(...args); };
  const api = client(pendingFetch);
  const result = api.checkHealth(controller.signal);
  assert.deepEqual([...api.timers.values()], [5000]);
  for (const callback of api.timers.keys()) callback();
  await assert.rejects(result, /aborted/);
  assert.equal(api.timers.size, 0);
  assert.equal(listeners, 0);
});

test("health respects caller cancellation and already-aborted signals", async () => {
  const api = client(pendingFetch);
  const controller = new AbortController();
  const result = api.checkHealth(controller.signal);
  controller.abort();
  await assert.rejects(result, /aborted/);
  await assert.rejects(api.checkHealth(controller.signal), /aborted/);
  assert.equal(api.timers.size, 0);
});

test("project requests time out and retain the existing connection error", async () => {
  const api = client(pendingFetch);
  const result = api.apiRequest("/api/projects");
  assert.deepEqual([...api.timers.values()], [15000]);
  for (const callback of api.timers.keys()) callback();
  await assert.rejects(result, /Cannot reach the backend/);
  assert.equal(api.timers.size, 0);
});

test("caller-owned deadlines are not shortened for long requests", async () => {
  const api = client(pendingFetch);
  const controller = new AbortController();
  const result = api.apiRequest("/api/projects", { signal: controller.signal });
  assert.equal(api.timers.size, 0);
  controller.abort();
  await assert.rejects(result, /Cannot reach the backend/);
});

test("health still rejects invalid responses and API errors retain status/detail", async () => {
  const api = client(async () => Response.json({ status: "wrong" }));
  await assert.rejects(api.checkHealth(), /Unexpected backend health response/);
  const failure = client(async () => Response.json({ detail: "Missing project" }, { status: 404 }));
  await assert.rejects(failure.apiRequest("/api/projects/missing"), (error) =>
    error instanceof failure.ApiError && error.status === 404 && error.message === "Missing project");
  assert.equal(api.timers.size, 0);
  assert.equal(failure.timers.size, 0);
});

test("explicit API origins and media validation retain existing behavior", async () => {
  let requested;
  const api = client(async (url) => { requested = url; return new Response(null, { status: 204 }); }, "https://api.example/");
  assert.equal(await api.apiRequest("/api/projects"), undefined);
  assert.equal(requested, "https://api.example/api/projects");
  assert.equal(api.mediaUrl("/api/media/image-1"), "https://api.example/api/media/image-1");
  assert.throws(() => api.mediaUrl("https://other.example/image"), /Invalid media reference/);
});
