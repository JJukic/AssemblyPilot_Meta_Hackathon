import { expect, test, type Page } from "@playwright/test";
import type { SetupDescription } from "../src/lib/setup";
const api = "http://127.0.0.1:8000";

async function start(page: Page, name: string) {
  await page.route("**/api/blocks", (route) => route.request().method() === "GET" ? route.fulfill({ json: [] }) : route.continue());
  await page.goto("/setup");
  await page.getByLabel("Project name", { exact: true }).fill(name);
  await page.getByLabel("Assembly description", { exact: true }).fill("Place the yellow block on the table. Its text must read Involve Me.");
  await page.getByRole("button", { name: "Set up manually", exact: true }).click();
  await expect(page.getByText("Your block library is empty.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Add custom block", exact: true }).click();
  await page.getByLabel("Block name", { exact: true }).fill(`${name} block`);
  await page.getByLabel("Color", { exact: true }).fill("yellow");
}
async function review(page: Page) {
  await page.getByRole("button", { name: "Choose inspection mode" }).click();
  await page.getByRole("button", { name: "Review project", exact: true }).click();
}
function descriptionFromBody(body: string): SetupDescription {
  return JSON.parse(body.match(/name="payload"\r\n\r\n([\s\S]*?)\r\n--/)![1]);
}
function draft(data: SetupDescription) {
  return { model: "muse-spark-1.3", requires_confirmation: true, plan: { steps: [{ title: "Inspect your block", instruction: "Place your block on a flat surface.", parts: [{ block_key: data.blocks[0].key, quantity: 1 }], print_check: null, reference_suggestion: "Take a side view.", limitations: ["Hidden connections are not verified."] }] } };
}

test("empty library → manual text rule → confirmed project → real camera inspection request", async ({ page }) => {
  await start(page, "Wizard manual");
  await page.getByLabel("Printed text (optional)", { exact: true }).fill("Involve Me");
  await page.getByRole("button", { name: "Continue manually" }).click();
  await page.getByRole("combobox", { name: "Printed-text target", exact: true }).selectOption({ label: "Wizard manual block" });
  await expect(page.getByRole("textbox", { name: "Expected printed text", exact: false })).toHaveValue("Involve Me");
  await review(page);
  const save = page.getByRole("button", { name: "Confirm and create project" });
  await expect(save).toBeDisabled();
  for (const viewport of [{ width: 1600, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/setup-review-${viewport.width}.png`, fullPage: true });
  }
  await page.getByRole("checkbox", { name: "I reviewed", exact: false }).check();
  const savedResponse = page.waitForResponse((r) => r.url().endsWith("/api/setup/projects") && r.status() === 201);
  await save.click();
  const project = await (await savedResponse).json();
  expect(project.steps[0].simple_print.expected_text).toBe("Involve Me");
  expect(project.steps[0].spatial_constraint).toBeNull();
  await page.getByRole("link", { name: "Start Inspection", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Assembly project", exact: true })).toHaveValue(project.id);
  await expect(page.getByRole("heading", { name: "Step 1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start camera", exact: true }).click();
  await expect(page.getByRole("status", { name: "Camera: Connected" })).toBeVisible();
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  const inspection = page.waitForRequest((r) => r.url().endsWith("/api/inspect"));
  await page.getByRole("button", { name: "Inspect with Meta AI", exact: true }).click();
  expect((await inspection).postDataBuffer()!.toString()).toContain(project.steps[0].id);
  // Disposable backend deliberately has no key. This exercises the real request/error path.
  await expect(page.getByRole("region", { name: "Meta AI inspection" }).getByRole("alert")).toContainText("MODEL_API_KEY");
});

test("existing library selection and edited AI draft require confirmation before any persistence", async ({ page, request }) => {
  const block = await (await request.post(`${api}/api/blocks`, { data: { name: "Wizard existing", color: "blue" } })).json();
  await page.route("**/api/blocks", (route) => route.fulfill({ json: [block] }));
  let saves = 0;
  page.on("request", (r) => { if (r.url().endsWith("/api/setup/projects")) saves++; });
  await page.route("**/api/setup/draft", (route) => route.fulfill({ json: draft(descriptionFromBody(route.request().postDataBuffer()!.toString())) }));
  await page.goto("/setup");
  await page.getByLabel("Project name", { exact: true }).fill("Wizard AI");
  await page.getByLabel("Assembly description", { exact: true }).fill("Place the blue block on a table.");
  await page.getByRole("button", { name: "Generate Assembly Plan with Meta AI" }).click();
  await page.getByRole("checkbox", { name: "Wizard existing · blue" }).check();
  await page.getByRole("button", { name: "Generate Assembly Plan with Meta AI" }).click();
  await expect(page.getByLabel("Step title", { exact: true })).toHaveValue("Inspect your block");
  await page.getByRole("textbox", { name: "Instruction", exact: true }).fill("Place the blue block beside the mat.");
  await review(page);
  expect(saves).toBe(0);
  await expect(page.getByText("Place the blue block beside the mat.", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "I reviewed", exact: false }).check();
  await page.getByRole("button", { name: "Confirm and create project" }).click();
  await expect(page.getByRole("link", { name: "Start Inspection", exact: true })).toBeVisible();
  expect(saves).toBe(1);
});

for (const fault of ["unavailable", "invalid"] as const) test(`Meta ${fault} preserves the draft and supports manual fallback`, async ({ page }) => {
  await start(page, `Wizard ${fault}`);
  await page.route("**/api/setup/draft", (route) => {
    if (fault === "unavailable") return route.fulfill({ status: 503, json: { detail: "Meta unavailable. Continue manually." } });
    const reply = draft(descriptionFromBody(route.request().postDataBuffer()!.toString()));
    reply.plan.steps[0].parts[0].block_key = "invented";
    return route.fulfill({ json: reply });
  });
  await page.getByRole("button", { name: "Generate Assembly Plan with Meta AI" }).click();
  await expect(page.getByRole("region", { name: "Assembly setup wizard", exact: true }).getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Block name", { exact: true })).toHaveValue(`Wizard ${fault} block`);
  await page.getByRole("button", { name: "Continue manually" }).click();
  await expect(page.getByRole("textbox", { name: "Instruction", exact: true })).toHaveValue(/yellow block/);
  await review(page);
  await expect(page.getByText("Manual plan", { exact: true })).toBeVisible();
});

test("lost save response retries the same request without duplicate projects", async ({ page, request }) => {
  await start(page, "Wizard retry");
  await page.getByRole("button", { name: "Continue manually" }).click();
  await review(page);
  let attempts = 0;
  await page.route("**/api/setup/projects", async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    if (++attempts === 1) return route.fulfill({ status: 503, json: { detail: "Simulated lost response" } });
    await route.fulfill({ response });
  });
  await page.getByRole("checkbox", { name: "I reviewed", exact: false }).check();
  await page.getByRole("button", { name: "Confirm and create project" }).click();
  // Each save first runs the REAL backend project creation (route.fetch) before the
  // simulated loss; under the parallel full suite that alone can exceed the 5 s default.
  await expect(page.getByRole("region", { name: "Assembly setup wizard", exact: true }).getByRole("alert"))
    .toContainText("draft is retained", { timeout: 20_000 });
  await page.getByRole("button", { name: "Confirm and create project" }).click();
  await expect(page.getByRole("link", { name: "Start Inspection", exact: true })).toBeVisible({ timeout: 20_000 });
  const projects = await (await request.get(`${api}/api/projects`)).json();
  expect(projects.filter((p: { name: string }) => p.name === "Wizard retry")).toHaveLength(1);
});

test("template exposes advanced tools and keeps references and rule confirmation explicit", async ({ page }) => {
  await page.goto("/setup");
  const photo = await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 160; c.height = 100; return c.toDataURL("image/png").split(",")[1]; });
  await page.getByLabel("Finished assembly photo (optional)", { exact: true }).setInputFiles({ name: "test.png", mimeType: "image/png", buffer: Buffer.from(photo, "base64") });
  await page.getByRole("button", { name: "Ready-made demonstration template" }).click();
  await page.getByRole("button", { name: "Continue manually" }).click();
  await expect(page.getByRole("region", { name: "Assembly step 1", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Assembly step 2", exact: true })).toBeVisible();
  await page.getByLabel("Step 2 reference photo", { exact: true }).setInputFiles({ name: "test.png", mimeType: "image/png", buffer: Buffer.from(photo, "base64") });
  await page.getByRole("region", { name: "Assembly step 2", exact: true }).getByRole("button", { name: "Move step up" }).click();
  await expect(page.getByRole("region", { name: "Assembly step 1", exact: true }).getByAltText("Step 1 reference photo", { exact: true })).toBeVisible();
  await page.getByRole("region", { name: "Assembly step 1", exact: true }).getByRole("button", { name: "Move step down" }).click();
  await page.getByRole("button", { name: "Choose inspection mode" }).click();
  await page.getByRole("radio", { name: "Advanced Mode", exact: false }).check();
  await expect(page.getByText("Precision setup available after confirmation")).toBeVisible();
  await page.getByRole("button", { name: "Review project", exact: true }).click();
  await expect(page.getByAltText("Step 2 selected reference", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "I reviewed", exact: false }).check();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("radio", { name: "Simple Mode", exact: false }).check();
  await page.getByRole("button", { name: "Review project", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "I reviewed", exact: false })).not.toBeChecked();
});

test("block photograph stays local until generation or confirmed save and releases camera", async ({ page }) => {
  await start(page, "Wizard camera");
  let uploads = 0;
  page.on("request", (r) => { if (r.method() === "POST") uploads++; });
  await page.getByRole("button", { name: "Photograph block 1 reference photo" }).click();
  const camera = page.getByRole("region", { name: "Reference camera", exact: true });
  await camera.getByRole("button", { name: "Start camera", exact: true }).click();
  await expect(camera.getByRole("button", { name: "Capture", exact: true })).toBeEnabled();
  await camera.getByRole("button", { name: "Capture", exact: true }).click();
  await camera.getByRole("button", { name: "Save as reference", exact: true }).click();
  await expect(camera).toHaveCount(0);
  await expect(page.getByAltText("Block 1 reference photo", { exact: true })).toBeVisible();
  expect(uploads).toBe(0);
});
