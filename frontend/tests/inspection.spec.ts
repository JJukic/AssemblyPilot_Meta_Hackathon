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
  issues: [{ type: "wrong_orientation", block_id: null, description: "The visible studs face sideways.", expected: "Studs upward", observed: "Studs sideways", suggested_fix: "Rotate the brick so the studs face upward.", bounding_box: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 } }],
  explanation: "The visible orientation differs from the step instruction.", next_action: "Rotate the brick and capture a new frame.",
};

let analyzedSnapshot: { data_url: string; width: number; height: number };
function inspectionResponse(overrides: Record<string, unknown> = {}) {
  return { ...diagnosis, active_vision: null, analyzed_snapshot: analyzedSnapshot, model: "muse-spark-1.3", model_latency_ms: 1234, inspected_at: "2026-10-27T10:00:00Z", ...overrides };
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/projects", (route) => route.fulfill({ json: [project] }));
  await page.route("**/api/projects/inspection-project", (route) => route.fulfill({ json: project }));
  await page.goto("/");
  await page.getByRole("combobox", { name: "Assembly project", exact: true }).selectOption(project.id);
  await expect(page.getByRole("heading", { name: "Inspect the base", exact: true })).toBeVisible();
  analyzedSnapshot = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 400; canvas.height = 200;
    const context = canvas.getContext("2d")!; context.fillStyle = "#3073aa"; context.fillRect(0, 0, 400, 200);
    return { data_url: canvas.toDataURL("image/jpeg"), width: 400, height: 200 };
  });
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
    await route.fulfill({ json: inspectionResponse() });
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
    return calls === 1 ? route.fulfill({ json: inspectionResponse() }) : route.fulfill({ status: 503, json: { detail: { code: "meta_not_configured", message: "Set MODEL_API_KEY in the backend environment to enable inspection." } } });
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
    await route.fulfill({ json: inspectionResponse() });
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


test("boxes align on the exact returned image and history survives new captures and navigation", async ({ page }) => {
  await page.route("**/api/inspect", (route) => route.fulfill({ json: inspectionResponse() }));
  await capture(page);
  await page.getByRole("button", { name: "Inspect with Meta AI" }).click();
  const panel = page.getByRole("region", { name: "Meta AI inspection" });
  await expect(panel.getByAltText("Analyzed snapshot")).toHaveAttribute("src", analyzedSnapshot.data_url);
  await expect(panel.locator("rect[data-issue-index]")).toHaveCount(1);
  const verifyAlignment = async () => {
    // SVG getBBox measures the coordinate rectangle, excluding its 2px visible stroke.
    const ratios = await panel.locator(".diagnostic-image-stage").evaluate((stage) => {
      const image = stage.querySelector("img")!.getBoundingClientRect();
      const rect = stage.querySelector("rect")!;
      const bounds = rect.getBBox(); const matrix = rect.getScreenCTM()!;
      const top = new DOMPoint(bounds.x, bounds.y).matrixTransform(matrix);
      const bottom = new DOMPoint(bounds.x + bounds.width, bounds.y + bounds.height).matrixTransform(matrix);
      return { x: (top.x - image.x) / image.width, y: (top.y - image.y) / image.height,
        width: (bottom.x - top.x) / image.width, height: (bottom.y - top.y) / image.height };
    });
    expect(ratios.x).toBeCloseTo(.1, 5);
    expect(ratios.y).toBeCloseTo(.2, 5);
    expect(ratios.width).toBeCloseTo(.3, 5);
    expect(ratios.height).toBeCloseTo(.4, 5);
  };
  await verifyAlignment();
  await page.setViewportSize({ width: 390, height: 844 });
  await verifyAlignment();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole("region", { name: "Observation workspace" }).locator(".diagnostic-boxes")).toHaveCount(0);
  const captured = await page.getByAltText("Latest captured LEGO assembly").getAttribute("src");
  expect(captured).not.toBe(analyzedSnapshot.data_url);
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await expect(panel.locator(".diagnostic-overlay")).toHaveCount(0);
  const history = page.getByRole("region", { name: "Inspection history", exact: true });
  await expect(history.locator(".history-entry")).toHaveCount(1);
  await history.locator(".history-entry").click();
  await expect(history.getByAltText("Analyzed snapshot")).toHaveAttribute("src", analyzedSnapshot.data_url);
  await expect(history.getByText(/Meta request: 1.23 s/)).toBeVisible();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Projects", exact: true }).click();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Workspace", exact: true }).click();
  await expect(history.locator(".history-entry")).toHaveCount(1);
  await history.getByRole("button", { name: "Clear history" }).click();
  await expect(history.locator(".history-entry")).toHaveCount(0);
});

test("Active Vision requests a specific view without automatic capture or inference", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/inspect", (route) => {
    calls++;
    return route.fulfill({ json: inspectionResponse(calls === 1 ? {
      status: "uncertain", issues: [], explanation: "The rear connection is hidden.",
      active_vision: { reason: "The rear connection is hidden.", requested_view: "back", instruction: "Move behind the base at stud height to expose the rear connection." },
    } : { status: "correct", issues: [] }) });
  });
  await capture(page);
  await page.getByRole("button", { name: "Inspect with Meta AI" }).click();
  await expect(page.getByRole("heading", { name: "Uncertain", exact: true })).toBeVisible();
  await expect(page.getByText("Move behind the base at stud height to expose the rear connection.")).toBeVisible();
  await expect(page.locator(".diagnostic-boxes")).toHaveCount(0);
  expect(calls).toBe(1);
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await expect(page.getByText("Move behind the base at stud height to expose the rear connection.")).toHaveCount(0);
  expect(calls).toBe(1);
  await page.getByRole("button", { name: "Inspect with Meta AI" }).click();
  await expect(page.getByRole("heading", { name: "Correct", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inspect the base", exact: true })).toBeVisible();
  await expect(page.locator(".history-entry")).toHaveCount(2);
});

test("malformed and missing-part coordinates are rejected before display or history", async ({ page }) => {
  const invalid = [
    { ...diagnosis.issues[0], bounding_box: { x: .8, y: 0, width: .5, height: .2 } },
    { ...diagnosis.issues[0], bounding_box: { x: 0, y: 0, width: 0, height: .2 } },
    { ...diagnosis.issues[0], type: "missing_part" },
  ];
  let calls = 0;
  await page.route("**/api/inspect", (route) => route.fulfill({ json: inspectionResponse({ issues: [invalid[calls++]] }) }));
  await capture(page);
  for (let index = 0; index < invalid.length; index++) {
    await page.getByRole("button", { name: "Inspect with Meta AI" }).click();
    await expect.poll(() => calls).toBe(index + 1);
    await expect(page.getByRole("region", { name: "Meta AI inspection" }).getByRole("alert")).toContainText("invalid diagnosis");
    await expect(page.locator(".diagnostic-boxes")).toHaveCount(0);
    await expect(page.locator(".history-entry")).toHaveCount(0);
  }
});

test("history is capped at ten and refreshing clears photos", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/inspect", (route) => { calls++; return route.fulfill({ json: inspectionResponse({ status: "correct", issues: [] }) }); });
  await capture(page);
  for (let index = 0; index < 11; index++) {
    await page.getByRole("button", { name: "Inspect with Meta AI" }).click();
    await expect.poll(() => calls).toBe(index + 1);
    await expect(page.getByRole("heading", { name: "Correct", exact: true })).toBeVisible();
  }
  await expect(page.locator(".history-entry")).toHaveCount(10);
  await page.reload();
  await expect(page.locator(".history-entry")).toHaveCount(0);
  await expect(page.getByAltText("Analyzed snapshot")).toHaveCount(0);
});

test("incorrect snapshot dimensions suppress otherwise valid overlays", async ({ page }) => {
  await page.route("**/api/inspect", (route) => route.fulfill({ json: inspectionResponse({ analyzed_snapshot: { ...analyzedSnapshot, width: 200 } }) }));
  await capture(page);
  await page.getByRole("button", { name: "Inspect with Meta AI" }).click();
  await expect(page.getByRole("region", { name: "Meta AI inspection" }).getByRole("alert")).toContainText("Boxes are hidden");
  await expect(page.locator(".diagnostic-boxes")).toHaveCount(0);
});

async function samResponse(page: Page, status = "matched") {
  const { snapshotId, mask } = await page.evaluate(async (snapshot) => {
    const bytes = Uint8Array.from(atob(snapshot.data_url.split(",")[1]), (char) => char.charCodeAt(0));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const snapshotId = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const canvas = document.createElement("canvas"); canvas.width = 120; canvas.height = 80;
    const context = canvas.getContext("2d")!; context.fillStyle = "rgba(239,68,68,.4)"; context.fillRect(0, 0, 120, 80);
    return { snapshotId, mask: canvas.toDataURL("image/png") };
  }, analyzedSnapshot);
  const instance = { instance_id: "2", left: 50, top: 50, mask: { encoding: "png", width: 120, height: 80, data_url: mask } };
  return inspectionResponse({
    inspection_id: "synthetic-sam-inspection", snapshot_id: snapshotId,
    segmentations: [{ issue_index: 0, status, concept: "blue building block", prompt_kind: "concept",
      message: status === "ambiguous" ? "Localization is ambiguous. No SAM instance is highlighted." : "Synthetic SAM test status.",
      latency_ms: 2200, selected_instance_id: status === "matched" ? "2" : null,
      result: ["matched", "ambiguous", "no_match"].includes(status) ? { snapshot_id: snapshotId, model: "sam-3.1", width: 400, height: 200,
        instances: status === "no_match" ? [] : status === "ambiguous" ? [instance, { ...instance, instance_id: "3", left: 200 }] : [instance] } : null,
    }],
  });
}

test("SAM masks and boxes align on desktop/mobile; original comparison and recapture stay isolated", async ({ page }) => {
  const response = await samResponse(page);
  await page.route("**/api/inspect", (route) => route.fulfill({ json: response }));
  await capture(page);
  await page.getByRole("button", { name: "Inspect with Meta AI" }).click();
  const panel = page.getByRole("region", { name: "Meta AI inspection" });
  const mask = panel.getByAltText("SAM mask for issue 1");
  await expect(mask).toBeVisible();
  await expect(panel.locator('rect[data-source="sam"]')).toHaveCount(1);
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const imageBounds = (await panel.getByAltText("Analyzed snapshot").boundingBox())!;
    const maskBounds = (await mask.boundingBox())!;
    expect((maskBounds.x - imageBounds.x) / imageBounds.width).toBeCloseTo(.125, 3);
    expect((maskBounds.y - imageBounds.y) / imageBounds.height).toBeCloseTo(.25, 3);
    expect(maskBounds.width / imageBounds.width).toBeCloseTo(.3, 3);
    expect(maskBounds.height / imageBounds.height).toBeCloseTo(.4, 3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await panel.getByRole("checkbox", { name: "Show Segmentation" }).uncheck();
  await expect(mask).toHaveCount(0);
  await expect(panel.locator('rect[data-source="sam"]')).toHaveCount(1);
  await panel.getByRole("checkbox", { name: "Show Segmentation" }).check();
  await panel.getByRole("button", { name: "Show original" }).click();
  await expect(mask).toHaveCount(0);
  await expect(panel.locator("rect[data-issue-index]")).toHaveCount(0);
  await expect(panel.getByAltText("Analyzed snapshot")).toBeVisible();
  await panel.getByRole("button", { name: "Show annotated" }).click();
  await expect(mask).toBeVisible();
  await expect(page.getByRole("region", { name: "Observation workspace" }).locator(".segmentation-mask")).toHaveCount(0);
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await expect(panel.locator(".segmentation-mask")).toHaveCount(0);
  const history = page.getByRole("region", { name: "Inspection history", exact: true });
  await history.locator(".history-entry").click();
  await expect(history.getByAltText("SAM mask for issue 1")).toBeVisible();
  await expect(history.getByText(/SAM localization: 2.20 s/)).toBeVisible();
});

test("ambiguous, empty, unavailable and disabled SAM preserve Muse diagnosis and its box", async ({ page }) => {
  const statuses = ["ambiguous", "no_match", "unavailable", "disabled"];
  const responses = await Promise.all(statuses.map((status) => samResponse(page, status)));
  let calls = 0;
  await page.route("**/api/inspect", (route) => route.fulfill({ json: responses[calls++] }));
  await capture(page);
  const panel = page.getByRole("region", { name: "Meta AI inspection" });
  for (const status of statuses) {
    await page.getByRole("button", { name: "Inspect with Meta AI" }).click();
    await expect(panel.getByText(`Segmentation · ${status.replaceAll("_", " ")}`, { exact: true })).toBeVisible();
    await expect(panel.getByRole("heading", { name: "Incorrect", exact: true })).toBeVisible();
    await expect(panel.locator(".segmentation-mask")).toHaveCount(0);
    await expect(panel.locator('rect[data-source="muse"]')).toHaveCount(1);
    await expect(panel.getByRole("checkbox", { name: "Show Segmentation" })).toBeDisabled();
  }
});

test("SAM snapshot identity, mask dimensions and ambiguous selection are rejected before history", async ({ page }) => {
  const base = await samResponse(page);
  const payloads: Record<string, unknown>[] = [];
  const wrongHash: Record<string, unknown> = structuredClone(base); wrongHash.snapshot_id = "a".repeat(64); payloads.push(wrongHash);
  const wrongMask = structuredClone(base) as ReturnType<typeof inspectionResponse> & { segmentations: { result: { instances: { mask: { width: number } }[] } }[] };
  wrongMask.segmentations[0].result.instances[0].mask.width = 121; payloads.push(wrongMask);
  const ambiguous = await samResponse(page, "ambiguous") as ReturnType<typeof inspectionResponse> & { segmentations: { selected_instance_id: string }[] };
  ambiguous.segmentations[0].selected_instance_id = "2"; payloads.push(ambiguous);
  const wrongImage = structuredClone(base); wrongImage.analyzed_snapshot = { ...analyzedSnapshot, data_url: analyzedSnapshot.data_url.replace(/.$/, "A") }; payloads.push(wrongImage);
  let calls = 0;
  await page.route("**/api/inspect", (route) => route.fulfill({ json: payloads[calls++] }));
  await capture(page);
  const panel = page.getByRole("region", { name: "Meta AI inspection" });
  for (let index = 0; index < payloads.length; index++) {
    await page.getByRole("button", { name: "Inspect with Meta AI" }).click();
    await expect.poll(() => calls).toBe(index + 1);
    await expect(panel.getByRole("alert")).toBeVisible();
    await expect(panel.locator(".segmentation-mask")).toHaveCount(0);
    await expect(page.locator(".history-entry")).toHaveCount(0);
  }
});
