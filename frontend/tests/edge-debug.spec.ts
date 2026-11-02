import { expect, test, type Page } from "@playwright/test";

async function capture(page: Page) {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Start camera", exact: true }).click();
  await expect(page.getByRole("status", { name: "Camera: Connected" })).toBeVisible();
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  const panel = page.getByRole("region", { name: "Edge Detection Debug Mode" });
  await panel.getByRole("checkbox", { name: "Enable edge debug mode" }).check();
  await expect(panel.getByRole("button", { name: "Detect edges", exact: true })).toBeEnabled();
  return panel;
}

test("independent Canny supports ROI, thresholds, exact JPEG and responsive optional overlay", async ({ page }) => {
  let modelCalls = 0;
  page.on("request", (request) => { if (/\/api\/(inspect|verify|segment)(?:\?|$)/.test(request.url())) modelCalls++; });
  const panel = await capture(page);
  const image = panel.getByAltText("Original edge debug snapshot");
  const originalURL = await image.getAttribute("src");
  await image.scrollIntoViewIfNeeded();
  const box = (await image.boundingBox())!;
  await page.mouse.move(box.x + box.width * .15, box.y + box.height * .2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .65, box.y + box.height * .75, { steps: 5 });
  await page.mouse.up();
  await expect(panel.getByRole("status")).toContainText("ROI:");
  await panel.getByLabel("Low Canny threshold").fill("20");
  await panel.getByLabel("High Canny threshold").fill("80");
  await panel.getByLabel("Gaussian blur").selectOption("5");
  const response = page.waitForResponse("**/api/vision/edges");
  await panel.getByRole("button", { name: "Detect edges", exact: true }).click();
  const evidence = await (await response).json();
  expect(evidence.options.blur_kernel).toBe(5);
  expect(evidence.options.low_threshold).toBe(20);
  expect(evidence.options.high_threshold).toBe(80);
  expect(evidence.analyzed_snapshot.data_url).toBe(originalURL);
  expect(evidence.applied_roi.width).toBeLessThan(evidence.analyzed_snapshot.width);
  expect(evidence.edge_pixel_count).toBeGreaterThan(0);
  await expect(panel.getByAltText("Detected Canny edge image")).toBeVisible();
  const toggle = panel.getByRole("checkbox", { name: "Raw Canny edges overlay" });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(panel.locator('[data-contour-kind="canny_edges"]')).toHaveCount(1);
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const imageBox = (await image.boundingBox())!;
    const first = await panel.locator('[data-contour-kind="canny_edges"] path').first().evaluate((path: SVGPathElement) => {
      const point = path.getPointAtLength(0).matrixTransform(path.getScreenCTM()!);
      return { x: point.x, y: point.y };
    });
    const [x, y] = evidence.contours.paths[0].points[0];
    expect((first.x - imageBox.x) / imageBox.width).toBeCloseTo(x / evidence.analyzed_snapshot.width, 3);
    expect((first.y - imageBox.y) / imageBox.height).toBeCloseTo(y / evidence.analyzed_snapshot.height, 3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await panel.getByRole("button", { name: "Use full image" }).click();
  await expect(panel.getByAltText("Detected Canny edge image")).toHaveCount(0);
  await expect(panel.locator('[data-contour-kind="canny_edges"]')).toHaveCount(0);
  await expect(panel.getByRole("status")).toContainText("Full image:");
  expect(modelCalls).toBe(0);
});

for (const change of ["snapshot", "settings"] as const) test(`late edge response cannot survive changed ${change}`, async ({ page }) => {
  let ready!: () => void, release!: () => void, finish!: () => void;
  const received = new Promise<void>((resolve) => { ready = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const finished = new Promise<void>((resolve) => { finish = resolve; });
  await page.route("**/api/vision/edges", async (route) => {
    const upstream = await route.fetch(); ready(); await gate;
    await route.fulfill({ response: upstream }).catch(() => {}); finish();
  });
  const panel = await capture(page);
  await panel.getByRole("button", { name: "Detect edges", exact: true }).click();
  await received;
  if (change === "snapshot") await page.getByRole("button", { name: "Capture", exact: true }).click();
  else await panel.getByLabel("Low Canny threshold").fill("30");
  release(); await finished;
  await expect(panel.getByAltText("Detected Canny edge image")).toHaveCount(0);
  await expect(panel.locator('[data-contour-kind="canny_edges"]')).toHaveCount(0);
  if (change === "snapshot") await expect(panel.getByRole("checkbox", { name: "Enable edge debug mode" })).not.toBeChecked();
});

for (const fault of ["backend", "identity"] as const) test(`edge extraction ${fault} failure shows error without fabricated overlay`, async ({ page }) => {
  await page.route("**/api/vision/edges", async (route) => {
    if (fault === "backend") return route.fulfill({ status: 422, json: { detail: "OpenCV edge extraction failed. Adjust settings." } });
    const response = await route.fetch();
    const result = await response.json(); result.snapshot_id = "0".repeat(64);
    return route.fulfill({ json: result });
  });
  const panel = await capture(page);
  await panel.getByRole("button", { name: "Detect edges", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText(fault === "backend" ? "extraction failed" : "does not match");
  await expect(panel.getByAltText("Detected Canny edge image")).toHaveCount(0);
  await expect(panel.locator('[data-contour-kind="canny_edges"]')).toHaveCount(0);
  await expect(page.getByAltText("Latest captured LEGO assembly")).toBeVisible();
});
