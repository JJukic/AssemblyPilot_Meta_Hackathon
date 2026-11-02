import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
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

const autoStatus = (page: Page) => page.getByRole("status", { name: "Autonomous assembly state" });

test("autonomous monitoring never inspects an unchanged scene; Inspect Now makes exactly one guarded request", async ({ page, request }) => {
  test.setTimeout(60000);
  const project = await project2(request);
  const state = await fakeCamera(page);
  await page.goto(`/ar?project=${project.id}`);
  await expect(page.getByRole("heading", { name: "Step 1 — First" })).toBeVisible();
  await page.getByRole("button", { name: "Start Autonomous Assembly" }).click();
  await expect(autoStatus(page)).toContainText("monitoring active", { timeout: 20000 });
  await page.waitForTimeout(3000);
  expect(state.inspects).toBe(0);
  await page.getByRole("button", { name: "Inspect Now" }).click();
  await expect(autoStatus(page)).toContainText("Inspection failed", { timeout: 20000 });
  expect(state.inspects).toBe(1);
  // Transport failure must be diagnosable as "Meta not successfully assessed",
  // never as a genuine uncertain visual judgment.
  await page.getByText("Inspection diagnostics (latest request)").click();
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
  await expect(autoStatus(page)).toContainText("Manual camera mode", { timeout: 15000 });
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
  await expect(autoStatus(page)).toContainText("monitoring active", { timeout: 20000 });
  await expect.poll(() => state.inspects, { timeout: 20000 }).toBe(1);
  await page.waitForTimeout(3000);
  expect(state.inspects).toBe(1);
  await page.getByRole("button", { name: "Stop Autonomous Assembly" }).click();
});
