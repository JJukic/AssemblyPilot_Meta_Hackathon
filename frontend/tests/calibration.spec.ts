import { expect, test, type Page } from "@playwright/test";
import type { CaptureAssessment, CalibrationProfile } from "../src/types/calibration";

async function start(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Start camera", exact: true }).click();
  await expect(page.getByRole("status", { name: "Camera: Connected" })).toBeVisible();
  await page.locator("summary").filter({ hasText: "Camera Calibration & Precision Capture" }).click();
  await page.getByLabel("Lens identification").fill("Synthetic lens");
  await page.getByLabel("Focus / zoom / crop / stabilization configuration").fill("Fixed synthetic configuration");
}
async function evidence(page: Page, index: number): Promise<CaptureAssessment> {
  const image = await page.evaluate(async (index) => {
    const video = document.querySelector("video")!;
    const c = document.createElement("canvas"); c.width = video.videoWidth; c.height = video.videoHeight;
    const ctx = c.getContext("2d")!; ctx.fillStyle = `rgb(${index * 12}, 80, 90)`; ctx.fillRect(0, 0, c.width, c.height);
    const url = c.toDataURL("image/jpeg");
    const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(atob(url.split(",")[1]), (char) => char.charCodeAt(0)));
    return { width: c.width, height: c.height, url, hash: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("") };
  }, index);
  return { schema_version: 1, board_id: "synthetic-board", analyzed_snapshot: image.url, snapshot_sha256: image.hash,
    width: image.width, height: image.height, board_status: "detected", marker_count: 17, corner_count: 12,
    corners: Array.from({ length: 12 }, (_, id) => ({ id, x_px: 30 + id * 10, y_px: 30 + id * 5 })),
    board_visibility: .5, sharpness: 100, calibration_status: "missing", pose: null,
    suitable_for_top_down_capture: false, sample_acceptable: true,
    guidance: ["Synthetic calibration board detected."],
    geometry: { measurement_status: "not_measured", calibration_valid: false, limitations: ["Synthetic test only"] } };
}

test("real OpenCV endpoint rejects synthetic webcam without markers and enables semantic capture explicitly", async ({ page }) => {
  let metaCalls = 0;
  await page.route("**/api/inspect", (route) => { metaCalls++; return route.abort(); });
  await start(page);
  await page.getByRole("button", { name: "Capture calibration sample", exact: true }).click();
  await expect(page.getByText("Sample rejected. Follow the guidance and capture again.")).toBeVisible();
  await expect(page.getByText("Calibration board not detected.", { exact: true })).toBeVisible();
  await expect(page.getByAltText("Exact snapshot analyzed for ChArUco corners")).toBeVisible();
  await expect(page.getByAltText("Latest captured LEGO assembly")).toHaveCount(0);
  await page.getByRole("button", { name: "Precision Capture", exact: true }).click();
  await page.getByRole("button", { name: "Capture & assess perspective", exact: true }).click();
  await expect(page.getByText("Camera calibration is missing.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Use this capture for AI inspection" }).click();
  await expect(page.getByAltText("Latest captured LEGO assembly")).toBeVisible();
  expect(metaCalls).toBe(0);
});

test("collects samples, rejects duplicates, requires measurements and saves profile", async ({ page }) => {
  await start(page);
  let index = 0; const fixtures: CaptureAssessment[] = [];
  for (let i = 0; i < 12; i++) fixtures.push(await evidence(page, i));
  await page.route("**/api/calibration/validate-capture", (route) => route.fulfill({ json: fixtures[index] }));
  const capture = page.getByRole("button", { name: "Capture calibration sample", exact: true });
  await capture.click();
  await expect(page.getByText("1 / 20 samples accepted", { exact: false })).toBeVisible();
  await capture.click();
  await expect(page.getByText("Sample rejected: duplicate image.", { exact: false })).toBeVisible();
  for (index = 1; index < 12; index++) {
    await capture.click();
    await expect(page.getByText(`${index + 1} / 20 samples accepted`, { exact: false })).toBeVisible();
  }
  const calibrate = page.getByRole("button", { name: "Calibrate & save profile" });
  await expect(calibrate).toBeDisabled();
  await page.getByLabel("Measured pattern width (mm)").fill("140");
  await page.getByLabel("Measured pattern height (mm)").fill("100");
  await page.getByRole("checkbox", { name: /I confirm the camera/ }).check();
  let calibrationCalls = 0;
  await page.route("**/api/calibration/calibrate", async (route) => {
    calibrationCalls++;
    const body = route.request().postDataBuffer()!.toString("latin1");
    expect(body.match(/name="images"/g)).toHaveLength(12);
    expect(body).toContain("140");
    const camera = JSON.parse(body.split('name="camera"\r\n\r\n')[1].split("\r\n")[0]);
    const profile: CalibrationProfile = { schema_version: 1, id: "synthetic-profile", created_at: new Date().toISOString(),
      opencv_version: "4.14.0", board_id: "synthetic-board", camera, accepted_views: 12,
      reprojection_rms_px: .3, per_view_rms_px: Array(12).fill(.3), coverage_fraction: .4, normal_spread_degrees: 40,
      measured_width_mm: 140, measured_height_mm: 100 };
    await route.fulfill({ status: 201, json: profile });
  });
  await calibrate.click();
  await expect(page.getByRole("heading", { name: "Calibration saved" })).toBeVisible();
  expect(calibrationCalls).toBe(1);
  await page.getByRole("button", { name: "Precision Capture", exact: true }).click();
  await expect(page.getByLabel("Calibration profile")).toHaveValue("synthetic-profile");
  await expect(page.getByRole("checkbox", { name: /I confirm the camera/ })).not.toBeChecked();
});

test("precision guidance uses exact snapshot corners, never live video, and stays readable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  const result = await evidence(page, 1);
  result.calibration_status = "compatible"; result.geometry.calibration_valid = true;
  result.pose = { rvec: [0, 0, 0], translation_mm: [0, 0, 300], viewing_angle_degrees: 40, reprojection_rms_px: .2 };
  result.guidance = ["Tilt the camera less for a top-down inspection."];
  await page.route("**/api/calibration/validate-capture", (route) => route.fulfill({ json: result }));
  await page.getByRole("button", { name: "Precision Capture", exact: true }).click();
  await page.getByRole("button", { name: "Capture & assess perspective", exact: true }).click();
  await expect(page.getByText("Tilt the camera less for a top-down inspection.", { exact: true })).toBeVisible();
  await expect(page.locator(".calibration-snapshot svg circle")).toHaveCount(12);
  await expect(page.locator(".live-frame svg circle")).toHaveCount(0);
  await expect(page.getByAltText("Exact snapshot analyzed for ChArUco corners")).toHaveAttribute("src", result.analyzed_snapshot);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/calibration-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Stop camera", exact: true }).click();
  await expect(page.getByAltText("Exact snapshot analyzed for ChArUco corners")).toHaveCount(0);
});

test("invalid geometry, backend errors and retry do not leave stale overlays", async ({ page }) => {
  await start(page);
  const valid = await evidence(page, 3);
  let result = valid;
  await page.route("**/api/calibration/validate-capture", (route) => route.fulfill({ json: result }));
  const capture = page.getByRole("button", { name: "Capture calibration sample", exact: true });
  await capture.click();
  await expect(page.locator(".calibration-snapshot svg circle")).toHaveCount(12);
  result = { ...valid, corners: [{ id: 1, x_px: -1, y_px: 20 }] };
  await capture.click();
  await expect(page.locator(".calibration-panel").getByRole("alert")).toContainText("Invalid geometry");
  await expect(page.locator(".calibration-snapshot")).toHaveCount(0);
  await page.route("**/api/calibration/validate-capture", (route) => route.fulfill({ status: 503, json: { detail: "Calibration storage unavailable" } }));
  await capture.click();
  await expect(page.locator(".calibration-panel").getByRole("alert")).toContainText("Calibration storage unavailable");
  await expect(capture).toBeEnabled();
});

test("camera restart discards in-flight calibration evidence", async ({ page }) => {
  await start(page);
  const result = await evidence(page, 4);
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/calibration/validate-capture", async (route) => { await gate; await route.fulfill({ json: result }).catch(() => {}); });
  await page.getByRole("button", { name: "Capture calibration sample", exact: true }).click();
  await expect(page.getByRole("button", { name: "Processing camera evidence…" })).toBeDisabled();
  await page.getByRole("button", { name: "Stop camera", exact: true }).click();
  release();
  await expect(page.getByAltText("Exact snapshot analyzed for ChArUco corners")).toHaveCount(0);
  await page.getByRole("button", { name: "Start camera", exact: true }).click();
  await expect(page.getByRole("status", { name: "Camera: Connected" })).toBeVisible();
  await page.locator("summary").filter({ hasText: "Camera Calibration & Precision Capture" }).click();
  await expect(page.getByText("0 / 20 samples accepted", { exact: false })).toBeVisible();
});
