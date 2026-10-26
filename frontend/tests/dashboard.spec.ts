import { expect, test } from "@playwright/test";

// Browser camera tests use Chromium's synthetic camera, never a physical device.
test.beforeEach(async ({ page }) => {
  await page.route("**/health", (route) => route.fulfill({
    json: { status: "ok", service: "assemblypilot-backend", version: "0.1.0" },
  }));
});

test("renders the dashboard and all five manually navigable steps", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Build with a clearer view." })).toBeVisible();
  await expect(page.getByRole("status", { name: "Backend: Connected" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Build the base" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous", exact: true })).toBeDisabled();
  await expect(page.getByText("Reference photograph needed")).toBeVisible();
  for (const title of ["Connect the foundation", "Add the left support", "Add the right support", "Bridge the supports"]) {
    await page.getByRole("button", { name: "Next step", exact: true }).click();
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Next step", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Step 1: Build the base", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Build the base" })).toBeVisible();
  await expect(page.getByText("Steps are not AI verified.", { exact: false })).toBeVisible();
});

test("starts, captures a JPEG, stops tracks, and restarts the synthetic camera", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Capture", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Start camera" }).click();
  await expect(page.getByRole("status", { name: "Camera: Connected" })).toBeVisible();
  await expect(page.getByLabel("Camera source").locator("option")).not.toHaveCount(1);
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  const snapshot = page.getByAltText("Latest captured LEGO assembly");
  await expect(snapshot).toHaveAttribute("src", /^data:image\/jpeg;base64,/);
  await expect(page.getByText(/\d+ × \d+ px · JPEG/)).toBeVisible();
  const stream = await page.locator("video").evaluateHandle((video) => (video as HTMLVideoElement).srcObject as MediaStream);
  const track = await stream.evaluateHandle((stream) => stream.getVideoTracks()[0]);
  await page.getByRole("button", { name: "Stop camera" }).click();
  expect(await track.evaluate((track) => track.readyState)).toBe("ended");
  await expect(page.getByRole("status", { name: "Camera: Stopped" })).toBeVisible();
  await expect(snapshot).toBeVisible();
  await page.getByRole("button", { name: "Start camera" }).click();
  await expect(page.getByRole("status", { name: "Camera: Connected" })).toBeVisible();
});

test("camera still works with a disconnected backend", async ({ page }) => {
  await page.route("**/health", (route) => route.abort());
  await page.goto("/");
  await expect(page.getByRole("status", { name: "Backend: Disconnected" })).toBeVisible();
  await page.getByRole("button", { name: "Start camera" }).click();
  await expect(page.getByRole("status", { name: "Camera: Connected" })).toBeVisible();
});

test("shows checking while health request is pending and rejects wrong services", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/health", async (route) => {
    await gate;
    await route.fulfill({ json: { status: "ok", service: "wrong-service", version: "1" } });
  });
  await page.goto("/");
  await expect(page.getByRole("status", { name: "Backend: Checking" })).toBeVisible();
  release();
  await expect(page.getByRole("status", { name: "Backend: Disconnected" })).toBeVisible();
});

test("reports permission denial without enabling capture", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("Denied", "NotAllowedError"); };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Start camera" }).click();
  await expect(page.getByRole("region", { name: "Observation workspace" }).getByRole("alert")).toContainText("Camera permission was denied");
  await expect(page.getByRole("button", { name: "Capture", exact: true })).toBeDisabled();
});

test("reports disconnection and permits a new start", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start camera" }).click();
  await expect(page.getByRole("status", { name: "Camera: Connected" })).toBeVisible();
  await page.locator("video").evaluate((video) => {
    const track = ((video as HTMLVideoElement).srcObject as MediaStream).getVideoTracks()[0];
    track.stop();
    track.dispatchEvent(new Event("ended"));
  });
  await expect(page.getByRole("region", { name: "Observation workspace" }).getByRole("alert")).toContainText("Camera disconnected");
  await expect(page.getByRole("button", { name: "Start camera" })).toBeEnabled();
  await page.getByRole("button", { name: "Start camera" }).click();
  await expect(page.getByRole("status", { name: "Camera: Connected" })).toBeVisible();
});

test("switching sources releases the previous camera", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start camera" }).click();
  await expect(page.getByRole("status", { name: "Camera: Connected" })).toBeVisible();
  const track = await page.locator("video").evaluateHandle((video) =>
    ((video as HTMLVideoElement).srcObject as MediaStream).getVideoTracks()[0]);
  await page.getByLabel("Camera source").selectOption("");
  await expect.poll(() => track.evaluate((track) => track.readyState)).toBe("ended");
  await expect(page.getByRole("status", { name: "Camera: Connected" })).toBeVisible();
});

test("late permission response cannot restart a stopped camera", async ({ page }) => {
  await page.addInitScript(() => {
    const media = navigator.mediaDevices;
    const original = media.getUserMedia.bind(media);
    media.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      const w = window as unknown as { releaseCamera: () => void; lateStream: MediaStream };
      w.lateStream = stream;
      await new Promise<void>((resolve) => { w.releaseCamera = resolve; });
      return stream;
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Start camera" }).click();
  await page.waitForFunction(() => "releaseCamera" in window);
  await page.getByRole("button", { name: "Stop camera" }).click();
  await page.evaluate(() => (window as unknown as { releaseCamera: () => void }).releaseCamera());
  await expect(page.getByRole("status", { name: "Camera: Stopped" })).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { lateStream: MediaStream }).lateStream.getVideoTracks()[0].readyState
  )).toBe("ended");
});

test("mobile layout has no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Assembly guide" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
