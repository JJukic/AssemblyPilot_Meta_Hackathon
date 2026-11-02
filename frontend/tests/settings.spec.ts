import { expect, test, type Page } from "@playwright/test";
import type { CalibrationProfile } from "../src/types/calibration";

const navigation = (page: Page) => page.getByRole("navigation", { name: "Main navigation" });
const calibration = (page: Page) => page.locator(".calibration-panel");
const debug = (page: Page) => page.getByRole("region", { name: "Edge Detection Debug Mode", exact: true });
async function openCalibration(page: Page) {
  if (await calibration(page).getAttribute("open") === null) await calibration(page).locator("summary").click();
}
async function startCamera(page: Page) {
  await page.getByRole("button", { name: "Start camera", exact: true }).click();
  await expect(page.getByRole("status", { name: "Camera: Connected" })).toBeVisible();
}

test("Settings follows Projects and owns calibration and debugging exclusively", async ({ page }) => {
  await page.goto("/");
  await expect(navigation(page).getByRole("link")).toHaveText(["Workspace", "Block library", "Projects", "Settings"]);
  await expect(navigation(page).getByRole("link", { name: "Workspace", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(calibration(page)).toHaveCount(0);
  await expect(debug(page)).toHaveCount(0);
  await navigation(page).getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(navigation(page).locator('[aria-current="page"]')).toHaveText("Settings");
  await expect(page.getByRole("heading", { name: "Camera", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Debugging", exact: true })).toBeVisible();
  await openCalibration(page);
  await expect(calibration(page).getByRole("heading", { name: "Camera Calibration", exact: true })).toBeVisible();
  await expect(debug(page)).toBeVisible();
  await expect(debug(page).getByRole("checkbox", { name: "Enable edge debug mode" })).not.toBeChecked();
  await expect(debug(page).getByText("Edge debug mode: Disabled", { exact: true })).toBeVisible();
  await expect(page.getByText(/Calibrated geometry: Disabled/)).toBeVisible();
  await navigation(page).getByRole("link", { name: "Workspace", exact: true }).click();
  await expect(calibration(page)).toHaveCount(0);
  await expect(debug(page)).toHaveCount(0);
});

test("direct Settings URL and refresh work without starting the camera", async ({ page }) => {
  let cameraRequests = 0;
  await page.exposeFunction("cameraRequested", () => { cameraRequests++; });
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      await (window as unknown as { cameraRequested: () => Promise<void> }).cameraRequested();
      return original(constraints);
    };
  });
  await page.goto("/settings");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "Camera: Stopped" })).toBeVisible();
  expect(cameraRequests).toBe(0);
});

test("navigation keeps desktop order and wraps on small screens without overflow", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/projects");
  const projects = (await navigation(page).getByRole("link", { name: "Projects", exact: true }).boundingBox())!;
  const settings = (await navigation(page).getByRole("link", { name: "Settings", exact: true }).boundingBox())!;
  expect(settings.x).toBeGreaterThan(projects.x + projects.width);
  expect(settings.y).toBe(projects.y);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await navigation(page).getByRole("link", { name: "Settings", exact: true }).click();
    for (const link of await navigation(page).getByRole("link").all()) await expect(link).toBeVisible();
    await openCalibration(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/settings-${width}.png`, fullPage: true });
    await navigation(page).getByRole("link", { name: "Projects", exact: true }).click();
    await expect(navigation(page).locator('[aria-current="page"]')).toHaveText("Projects");
  }
});

test("camera, snapshot and setting values survive Workspace and Settings navigation", async ({ page }) => {
  const uploads: string[] = [];
  page.on("request", (request) => { if (request.method() === "POST") uploads.push(request.url()); });
  await page.goto("/");
  await startCamera(page);
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  const image = await page.getByAltText("Latest captured LEGO assembly").getAttribute("src");
  const track = await page.locator("video").evaluateHandle((video: HTMLVideoElement) => (video.srcObject as MediaStream).getVideoTracks()[0]);
  await navigation(page).getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("status", { name: "Camera: Connected" })).toBeVisible();
  expect(await page.locator("video").evaluate((video: HTMLVideoElement) => video.videoWidth > 0 && video.srcObject !== null)).toBe(true);
  await openCalibration(page);
  await page.getByLabel("Lens identification").fill("Fixed test lens");
  await page.getByLabel("Focus / zoom / crop / stabilization configuration").fill("Fixed focus, no crop");
  await page.getByLabel("Measured pattern width (mm)").fill("140");
  await page.getByLabel("Measured pattern height (mm)").fill("100");
  await debug(page).getByRole("checkbox", { name: "Enable edge debug mode" }).check();
  await expect(debug(page).getByLabel("Gaussian blur")).toHaveValue("3");
  await expect(debug(page).getByLabel("Low Canny threshold")).toHaveValue("50");
  await expect(debug(page).getByLabel("High Canny threshold")).toHaveValue("150");
  await debug(page).getByLabel("Gaussian blur").selectOption("5");
  await debug(page).getByLabel("Low Canny threshold").fill("30");
  await debug(page).getByLabel("High Canny threshold").fill("90");
  await navigation(page).getByRole("link", { name: "Workspace", exact: true }).click();
  await expect(page.getByAltText("Latest captured LEGO assembly")).toHaveAttribute("src", image!);
  expect(await track.evaluate((track) => track.readyState)).toBe("live");
  await navigation(page).getByRole("link", { name: "Settings", exact: true }).click();
  await openCalibration(page);
  await expect(page.getByLabel("Lens identification")).toHaveValue("Fixed test lens");
  await expect(page.getByLabel("Measured pattern width (mm)")).toHaveValue("140");
  await expect(page.getByLabel("Measured pattern height (mm)")).toHaveValue("100");
  await expect(debug(page).getByText("Edge debug mode: Enabled", { exact: true })).toBeVisible();
  await expect(debug(page).getByLabel("Gaussian blur")).toHaveValue("5");
  await expect(debug(page).getByLabel("Low Canny threshold")).toHaveValue("30");
  await expect(debug(page).getByLabel("High Canny threshold")).toHaveValue("90");
  expect(uploads).toEqual([]);
  // A fresh snapshot retains the original reset behavior and defaults.
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await expect(debug(page).getByRole("checkbox", { name: "Enable edge debug mode" })).not.toBeChecked();
  await navigation(page).getByRole("link", { name: "Projects", exact: true }).click();
  expect(await track.evaluate((track) => track.readyState)).toBe("ended");
});

const profile: CalibrationProfile = {
  schema_version: 1, id: "saved-profile", created_at: "2026-11-01T12:00:00Z", opencv_version: "4.14.0", board_id: "test-board",
  camera: { device_label: "Synthetic camera", lens: "Fixed lens", configuration: JSON.stringify({ notes: "Fixed focus" }), width: 1920, height: 1080 },
  accepted_views: 12, reprojection_rms_px: .3, per_view_rms_px: Array(12).fill(.3), coverage_fraction: .4, normal_spread_degrees: 40,
  measured_width_mm: 140, measured_height_mm: 100,
};
async function savedProfiles(page: Page) {
  await page.route("**/api/calibration/status", (route) => route.fulfill({ json: {
    board: { squares_x: 7, squares_y: 5, square_mm: 20, marker_mm: 15, dictionary: "DICT_4X4_50" },
    board_id: "test-board", opencv_version: "4.14.0", profiles: [profile], invalid_profile_count: 0,
  } }));
}

test("saved profiles reload through the same API and confirmation is never persisted", async ({ page }) => {
  await savedProfiles(page);
  await page.goto("/settings");
  await openCalibration(page);
  await page.getByRole("button", { name: "Precision Capture", exact: true }).click();
  await page.getByLabel("Calibration profile").selectOption(profile.id);
  await expect(page.getByLabel("Lens identification")).toHaveValue("Fixed lens");
  await expect(page.getByLabel("Focus / zoom / crop / stabilization configuration")).toHaveValue("Fixed focus");
  await page.getByRole("checkbox", { name: /I confirm the camera/ }).check();
  await expect(page.getByText(/Calibrated geometry: Enabled/)).toBeVisible();
  await navigation(page).getByRole("link", { name: "Workspace", exact: true }).click();
  await navigation(page).getByRole("link", { name: "Settings", exact: true }).click();
  await openCalibration(page);
  await expect(page.getByLabel("Calibration profile")).toHaveValue(profile.id);
  await expect(page.getByRole("checkbox", { name: /I confirm the camera/ })).toBeChecked();
  await page.reload();
  await openCalibration(page);
  await page.getByRole("button", { name: "Precision Capture", exact: true }).click();
  await expect(page.getByLabel("Calibration profile").locator("option")).toHaveCount(2);
  await expect(page.getByLabel("Calibration profile")).toHaveValue("");
  await expect(page.getByRole("checkbox", { name: /I confirm the camera/ })).not.toBeChecked();
  await expect(page.getByText(/Calibrated geometry: Disabled/)).toBeVisible();
});

test("confirmed calibration is passed unchanged to Workspace inspection and camera stop invalidates it", async ({ page }) => {
  await savedProfiles(page);
  const project = { id: "settings-project", name: "Settings test", steps: [
    { id: "settings-step", title: "Place the block", instruction: "Place it.", required_blocks: [], reference_images: [] },
  ] };
  await page.route("**/api/projects", (route) => route.fulfill({ json: [project] }));
  await page.route("**/api/projects/settings-project", (route) => route.fulfill({ json: project }));
  await page.route("**/api/projects/settings-project/progress", (route) => route.fulfill({ json: [
    { step_id: "settings-step", specification_id: "a".repeat(64), status: "not_started", verified_at: null },
  ] }));
  let calls = 0;
  await page.route("**/api/inspect", (route) => {
    calls++;
    const body = route.request().postDataBuffer()!.toString("latin1");
    expect(body).toContain('name="geometry_profile_id"\r\n\r\nsaved-profile');
    expect(body).toContain('name="geometry_configuration_confirmed"\r\n\r\ntrue');
    const camera = JSON.parse(body.split('name="geometry_camera"\r\n\r\n')[1].split("\r\n")[0]);
    expect(camera).toEqual(profile.camera);
    return route.fulfill({ status: 422, json: { detail: "Synthetic inspection boundary reached" } });
  });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Assembly project", exact: true }).selectOption(project.id);
  await startCamera(page);
  await navigation(page).getByRole("link", { name: "Settings", exact: true }).click();
  await openCalibration(page);
  await page.getByRole("button", { name: "Precision Capture", exact: true }).click();
  await page.getByLabel("Calibration profile").selectOption(profile.id);
  await page.getByRole("checkbox", { name: /I confirm the camera/ }).check();
  await navigation(page).getByRole("link", { name: "Workspace", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Assembly project", exact: true })).toHaveValue(project.id);
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await page.getByRole("button", { name: "Inspect with Meta AI", exact: true }).click();
  await expect(page.getByRole("region", { name: "Meta AI inspection", exact: true }).getByRole("alert")).toContainText("Synthetic inspection boundary reached");
  expect(calls).toBe(1);
  await page.getByRole("button", { name: "Stop camera", exact: true }).click();
  await navigation(page).getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByText(/Calibrated geometry: Disabled/)).toBeVisible();
});
