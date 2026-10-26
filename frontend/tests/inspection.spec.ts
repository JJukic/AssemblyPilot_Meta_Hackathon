import { expect, test, type Page } from "@playwright/test";

// Synthetic fixtures are confined to tests; no model endpoint is reachable from this suite.
const project = {
  id: "inspection-project", name: "Inspection test project", description: "Synthetic browser fixture",
  steps: [
    { id: "inspection-step", title: "Inspect the base", instruction: "Check the blue base.", required_blocks: [], reference_images: [] },
    { id: "second-step", title: "Inspect the top", instruction: "Check the top.", required_blocks: [], reference_images: [] },
  ],
};
const diagnosis = {
  step_id: "inspection-step", status: "incorrect", confidence: null,
  visible_blocks: [{ block_id: null, description: "A blue brick", estimated_count: 1 }],
  issues: [{ type: "wrong_orientation", block_id: null, description: "The visible studs face sideways.", suggested_fix: "Rotate the brick so the studs face upward.", bounding_box: null }],
  explanation: "The visible orientation differs from the step instruction.", next_action: "Rotate the brick and capture a new frame.",
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/projects", (route) => route.fulfill({ json: [project] }));
  await page.route("**/api/projects/inspection-project", (route) => route.fulfill({ json: project }));
  await page.goto("/");
  await page.getByRole("combobox", { name: "Assembly project", exact: true }).selectOption(project.id);
  await expect(page.getByRole("heading", { name: "Inspect the base", exact: true })).toBeVisible();
});

async function capture(page: Page) {
  await page.getByRole("button", { name: "Start camera" }).click();
  await expect(page.getByRole("status", { name: "Camera: Connected" })).toBeVisible();
  await page.getByRole("button", { name: "Capture", exact: true }).click();
}

test("explicit inspection uploads the snapshot and IDs, renders diagnosis and never advances", async ({ page }) => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/inspect", async (route) => {
    calls++;
    const request = route.request();
    expect(request.headers()["content-type"]).toContain("multipart/form-data");
    const multipart = request.postDataBuffer()!.toString("latin1");
    expect(multipart).toContain('name="project_id"');
    expect(multipart).toContain(project.id);
    expect(multipart).toContain('name="step_id"');
    expect(multipart).toContain("inspection-step");
    expect(multipart).toContain("Content-Type: image/jpeg");
    expect(request.headers()["authorization"]).toBeUndefined();
    await gate;
    await route.fulfill({ json: diagnosis });
  });
  const button = page.getByRole("button", { name: "Inspect with Meta AI", exact: true });
  await expect(button).toBeDisabled();
  await capture(page);
  await expect(button).toBeEnabled();
  expect(calls).toBe(0);
  await button.click();
  await expect(page.getByRole("button", { name: "Inspecting with Meta…" })).toBeDisabled();
  release();
  await expect(page.getByRole("heading", { name: "Incorrect", exact: true })).toBeVisible();
  await expect(page.getByText("Confidence not provided.")).toBeVisible();
  await expect(page.getByText("Estimated count: 1")).toBeVisible();
  await expect(page.getByText(diagnosis.issues[0].suggested_fix)).toBeVisible();
  await expect(page.getByText(diagnosis.next_action)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inspect the base", exact: true })).toBeVisible();
  expect(calls).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/inspection-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Incorrect", exact: true })).toHaveCount(0);
  expect(calls).toBe(1);
});

test("failed retry clears a previous result and shows the backend error", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/inspect", (route) => {
    calls++;
    return calls === 1 ? route.fulfill({ json: diagnosis }) : route.fulfill({ status: 503, json: { detail: { code: "meta_not_configured", message: "Set MODEL_API_KEY in the backend environment to enable inspection." } } });
  });
  await capture(page);
  await page.getByRole("button", { name: "Inspect with Meta AI" }).click();
  await expect(page.getByRole("heading", { name: "Incorrect", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Inspect with Meta AI" }).click();
  await expect(page.getByRole("region", { name: "Meta AI inspection" }).getByRole("alert")).toContainText("Set MODEL_API_KEY");
  await expect(page.getByRole("heading", { name: "Incorrect", exact: true })).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Camera: Connected" })).toBeVisible();
});

test("changing steps cancels pending display and late answers cannot migrate", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/inspect", async (route) => {
    await gate;
    await route.fulfill({ json: diagnosis });
  });
  await capture(page);
  await page.getByRole("button", { name: "Inspect with Meta AI" }).click();
  await expect(page.getByRole("button", { name: "Inspecting with Meta…" })).toBeVisible();
  await page.getByRole("button", { name: "Next step", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Inspect the top", exact: true })).toBeVisible();
  release();
  await expect(page.getByRole("button", { name: "Inspect with Meta AI" })).toBeEnabled();
  await expect(page.getByRole("heading", { name: "Incorrect", exact: true })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Assembly project", exact: true }).selectOption("");
  await expect(page.getByRole("region", { name: "Meta AI inspection" })).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Camera: Connected" })).toBeVisible();
});
