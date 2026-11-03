import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// The AR page groups secondary controls in collapsed sections (details.ar-options).
// These specs exercise the contents, so the sections are opened on every load;
// the collapsed default itself is covered in ar.spec.ts.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // Nested sections too — except the React-controlled voice command list (its state is under test).
    const open = () => document.querySelectorAll<HTMLDetailsElement>("details.ar-options:not([open]), details.ar-options details:not([open])")
      .forEach((d) => { if (d.querySelector("summary")?.textContent !== "Available voice commands") d.setAttribute("open", ""); });
    new MutationObserver(open).observe(document, { childList: true, subtree: true });
  });
});
const api = "http://127.0.0.1:8000";

async function project2(request: APIRequestContext) {
  const block = await (await request.post(`${api}/api/blocks`, { data: { name: "Auto block", color: "blue" } })).json();
  const project = await (await request.post(`${api}/api/projects`, { data: { name: "Autonomous audit" } })).json();
  for (const title of ["First", "Second"]) {
    await request.post(`${api}/api/projects/${project.id}/steps`, {
      data: { title, instruction: `Instruction for ${title}.`, required_blocks: [{ block_id: block.id, required_quantity: 1 }] },
    });
  }
  return project;
}

async function fakeCamera(page: Page) {
  const state = { inspects: 0 };
  await page.route("**/api/inspect", (r) => {
    state.inspects++;
    return r.fulfill({ status: 422, json: { detail: "mocked invalid inspection" } });
  });
  await page.route("**/api/verify", (r) => r.fulfill({ status: 422, json: { detail: "mocked" } }));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "xr", { value: undefined, configurable: true });
    const canvas = document.createElement("canvas");
    canvas.width = 320; canvas.height = 240;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#336699"; ctx.fillRect(0, 0, 320, 240);
    ctx.fillStyle = "#ffcc00"; ctx.fillRect(120, 90, 60, 60);
    const stream = canvas.captureStream(10);
    (window as unknown as { __fakeStream: MediaStream }).__fakeStream = stream;
    const real = navigator.mediaDevices;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async (c: MediaStreamConstraints) => (c?.video ? stream : real.getUserMedia(c)),
        enumerateDevices: () => real.enumerateDevices(),
        addEventListener: (...a: unknown[]) => (real.addEventListener as (...x: unknown[]) => void)(...a),
        removeEventListener: (...a: unknown[]) => (real.removeEventListener as (...x: unknown[]) => void)(...a),
      },
    });
  });
  return state;
}

/** Open a (possibly already opened) section without toggling it closed. */
async function openSection(page: Page, summary: string) {
  await page.getByText(summary, { exact: true }).waitFor({ state: "attached" });
  await page.evaluate((text) => document.querySelectorAll("details").forEach((d) => {
    if (d.querySelector("summary")?.textContent === text) d.open = true;
  }), summary);
}
const autoStatus = (page: Page) => page.getByRole("status", { name: "Autonomous assembly state" });

test("autonomous monitoring never inspects an unchanged scene; Inspect Now makes exactly one guarded request", async ({ page, request }) => {
  test.setTimeout(60000);
  const project = await project2(request);
  const state = await fakeCamera(page);
  await page.goto(`/ar?project=${project.id}`);
  await expect(page.getByRole("heading", { name: "Step 1 — First" })).toBeVisible();
  await page.getByRole("button", { name: "Start Autonomous Assembly" }).click();
  await expect(autoStatus(page)).toContainText("Watching for physical assembly changes", { timeout: 20000 });
  await page.waitForTimeout(3000);
  expect(state.inspects).toBe(0);
  await page.getByRole("button", { name: "Inspect Now" }).click();
  // 422 from the mocked backend is a REJECTED request — never a visual verdict.
  await expect(autoStatus(page)).toContainText("REQUEST REJECTED", { timeout: 20000 });
  expect(state.inspects).toBe(1);
  // Transport failure must be diagnosable as "Meta not successfully assessed",
  // never as a genuine uncertain visual judgment.
  await openSection(page, "Inspection diagnostics (latest request)");
  await expect(page.locator('[aria-label="Inspection diagnostics"]'))
    .toContainText("Meta called: NO", { timeout: 10000 });
  await expect(page.getByRole("heading", { name: "Step 1 — First" })).toBeVisible();
  await page.getByRole("button", { name: "Pause Monitoring" }).click();
  await expect(autoStatus(page)).toContainText("paused");
  await page.getByRole("button", { name: "Resume Monitoring" }).click();
  await page.getByRole("button", { name: "Stop Autonomous Assembly" }).click();
  await expect(autoStatus(page)).toContainText("stopped");
});

test("manual camera mode enables autonomous advance watching without continuous capture", async ({ page, request }) => {
  test.setTimeout(60000);
  const project = await project2(request);
  await fakeCamera(page);
  await page.goto(`/ar?project=${project.id}`);
  await expect(page.getByRole("heading", { name: "Step 1 — First" })).toBeVisible();
  await page.getByLabel(/Camera source/).selectOption("manual");
  await page.getByRole("button", { name: "Start Autonomous Assembly" }).click();
  await expect(autoStatus(page)).toContainText("MANUAL CAMERA MODE", { timeout: 15000 });
  await page.getByRole("button", { name: "Stop Autonomous Assembly" }).click();
  await expect(autoStatus(page)).toContainText("stopped");
});

test("initial assessment: already-placed stable construction is assessed once, never repeatedly", async ({ page, request }) => {
  test.setTimeout(60000);
  const a = await project2(request);
  const state = await fakeCamera(page);
  await page.goto(`/ar?project=${a.id}`);
  await expect(page.getByRole("heading", { name: "Step 1 — First" })).toBeVisible();
  await page.getByLabel(/Assess blocks already placed/).check();
  await page.getByRole("button", { name: "Start Autonomous Assembly" }).click();
  // The one-time assessment may run before "Watching" is ever shown (it needs only a stable view).
  await expect.poll(() => state.inspects, { timeout: 20000 }).toBe(1);
  await page.waitForTimeout(3000);
  expect(state.inspects).toBe(1);
  await page.getByRole("button", { name: "Stop Autonomous Assembly" }).click();
});

test("capture preview: the panel preview record is the exact uploaded JPEG (same SHA-256 as the request body)", async ({ page, request }) => {
  test.setTimeout(60000);
  const project = await project2(request);
  await fakeCamera(page);
  const uploads: string[] = [];
  await page.route("**/api/inspect", async (r) => {
    const body = r.request().postDataBuffer() ?? Buffer.alloc(0);
    const marker = body.indexOf('name="image"');
    const start = body.indexOf("\r\n\r\n", marker) + 4;
    const boundary = body.subarray(0, body.indexOf("\r\n"));
    const end = body.indexOf(boundary, start) - 2;
    const { createHash } = await import("node:crypto");
    uploads.push(createHash("sha256").update(body.subarray(start, end)).digest("hex"));
    return r.fulfill({ status: 422, json: { detail: "mocked invalid inspection" } });
  });
  await page.goto(`/ar?project=${project.id}`);
  await expect(page.getByRole("heading", { name: "Step 1 — First" })).toBeVisible();
  await page.getByRole("button", { name: "Start Autonomous Assembly" }).click();
  await expect(autoStatus(page)).toContainText("Watching for physical assembly changes", { timeout: 20000 });
  await page.getByRole("button", { name: "Inspect Now" }).click();
  await expect.poll(() => uploads.length, { timeout: 20000 }).toBe(1);
  await openSection(page, "Inspection diagnostics (latest request)");
  const preview = page.getByRole("status", { name: "AR panel capture preview" });
  await expect(preview).toContainText(`SHA-256 ${uploads[0]}`, { timeout: 10000 });
  await expect(preview).toContainText("upload started yes");
  await expect(preview).toContainText("same image as this trace");
  await expect(page.getByRole("status", { name: "Inspection diagnostics" })).toContainText(uploads[0]);
  expect(uploads.length).toBe(1);
  await page.getByRole("button", { name: "Stop Autonomous Assembly" }).click();
});

test("Stop releases the camera and stops automatic requests; rapid Start/Stop never restarts monitoring", async ({ page, request }) => {
  test.setTimeout(60000);
  const project = await project2(request);
  const state = await fakeCamera(page);
  await page.goto(`/ar?project=${project.id}`);
  await expect(page.getByRole("heading", { name: "Step 1 — First" })).toBeVisible();
  const trackState = () => page.evaluate(() => (window as unknown as { __fakeStream: MediaStream }).__fakeStream.getVideoTracks()[0].readyState);
  // Rapid: Start immediately followed by Stop (camera may still be opening).
  await page.getByRole("button", { name: "Start Autonomous Assembly" }).click();
  await page.getByRole("button", { name: "Stop Autonomous Assembly" }).click();
  await expect(autoStatus(page)).toContainText("stopped");
  await page.waitForTimeout(2500);
  await expect(autoStatus(page)).toContainText("off"); // no silent restart
  expect(await trackState()).toBe("ended");
  expect(state.inspects).toBe(0);
});
