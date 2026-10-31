import { expect, test, type Page } from "@playwright/test";
import type { WorkflowInspection, VerificationResponse, StepProgress } from "../src/types/workflow";

// Synthetic API fixtures only. Production code never substitutes model answers.
const project = { id: "loop-project", name: "Correction test tower", description: "Test only", steps: [
  { id: "loop-step", title: "Attach the top", instruction: "Align the top block.", required_blocks: [], reference_images: [] },
  { id: "next-step", title: "Inspect the finish", instruction: "Inspect the finish.", required_blocks: [], reference_images: [] },
] };
const issue = { type: "misplaced_part" as const, block_id: "blue-block", description: "Visible top block offset",
  expected: "Aligned edges", observed: "Offset edges", suggested_fix: "Align the visible top edges.", bounding_box: { x: .1, y: .2, width: .3, height: .4 } };

async function observation(page: Page, id: string, status: "correct" | "incorrect" | "uncertain", previous?: WorkflowInspection): Promise<WorkflowInspection> {
  const snapshot = await page.evaluate(async (color) => {
    const canvas = document.createElement("canvas"); canvas.width = 400; canvas.height = 200;
    const context = canvas.getContext("2d")!; context.fillStyle = color; context.fillRect(0, 0, 400, 200);
    const data_url = canvas.toDataURL("image/jpeg");
    const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(atob(data_url.split(",")[1]), (char) => char.charCodeAt(0)));
    return { data_url, hash: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("") };
  }, previous ? "#309040" : "#3073aa");
  const active_vision = status === "uncertain" ? { reason: "The rear connection is hidden.", requested_view: "back" as const, instruction: "Move behind the top block to expose its rear connection." } : null;
  const tracks = previous ? previous.tracked_issues.map((item) => ({ ...item, resolution: status === "correct" ? "resolved" as const : status === "incorrect" ? "unresolved" as const : "uncertain" as const,
    evidence: "Synthetic new-image evidence", current_issue_index: status === "incorrect" ? 0 : null })) : status === "incorrect" ? [{ issue_id: "finding-1", original_inspection_id: id,
    original_snapshot_id: snapshot.hash, original: issue, resolution: "open" as const, evidence: issue.observed, current_issue_index: 0 }] : [];
  return { step_id: "loop-step", status, confidence: null, issues: status === "incorrect" ? [issue] : [], visible_blocks: [],
    explanation: "Synthetic visual assessment", next_action: "Review the current evidence.", active_vision,
    segmentations: [], analyzed_snapshot: { data_url: snapshot.data_url, width: 400, height: 200 }, snapshot_id: snapshot.hash, inspection_id: id, specification_id: "a".repeat(64),
    model: "muse-spark-1.3", model_latency_ms: 1200, inspected_at: "2026-10-28T09:00:00Z", muse_call_count: 1, meta_attempt_count: 1,
    state: status === "correct" ? previous ? "verified" : "correct" : status === "incorrect" ? previous ? "still_incorrect" : "correction_required" : "uncertain",
    tracked_issues: tracks, correction_plan: status === "correct" ? [] : active_vision ? [{ issue_id: null, block_id: null, kind: "capture", instruction: active_vision.instruction }] :
      [{ issue_id: "finding-1", block_id: "blue-block", kind: "adjust", instruction: issue.suggested_fix }],
  };
}
function verification(before: WorkflowInspection, after: WorkflowInspection): VerificationResponse {
  return { verification_id: "verification-1", previous_inspection_id: before.inspection_id,
    status: after.state as VerificationResponse["status"], inspection: after,
    issue_assessments: after.tracked_issues.map((item) => ({ previous_issue_id: item.issue_id,
      resolution: item.resolution as "resolved" | "unresolved" | "uncertain", explanation: item.evidence, current_issue_index: item.current_issue_index })) };
}
async function setup(page: Page) {
  let progress: StepProgress = { step_id: "loop-step", specification_id: "a".repeat(64), status: "not_started", verified_at: null };
  await page.route("**/api/projects", (route) => route.fulfill({ json: [project] }));
  await page.route("**/api/projects/loop-project", (route) => route.fulfill({ json: project }));
  await page.route("**/api/projects/loop-project/progress", (route) => route.fulfill({ json: [progress] }));
  await page.goto("/");
  await page.getByRole("combobox", { name: "Assembly project", exact: true }).selectOption(project.id);
  await expect(page.getByText("Step progress: not started", { exact: true })).toBeVisible();
  return { setProgress: (value: StepProgress) => { progress = value; } };
}
async function capture(page: Page) {
  await page.getByRole("button", { name: "Start camera", exact: true }).click();
  await expect(page.getByRole("status", { name: "Camera: Connected" })).toBeVisible();
  await page.getByRole("button", { name: "Capture", exact: true }).click();
}
async function begin(page: Page, initial: WorkflowInspection) {
  await page.route("**/api/inspect", (route) => route.fulfill({ json: initial }));
  await capture(page);
  await page.getByRole("button", { name: "Inspect with Meta AI", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Correction Required", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "I've corrected it", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ready to Verify", exact: true })).toBeVisible();
}

function uploadedJpeg(body: Buffer) {
  return body.subarray(body.indexOf(Buffer.from([255, 216])), body.lastIndexOf(Buffer.from([255, 217])) + 2);
}

test("correction → genuinely new capture → verified → explicit advancement with persisted progress", async ({ page }) => {
  const progress = await setup(page);
  const initial = await observation(page, "initial", "incorrect");
  const after = await observation(page, "second", "correct", initial);
  let initialUpload: Buffer; let calls = 0;
  await page.route("**/api/inspect", (route) => { initialUpload = uploadedJpeg(route.request().postDataBuffer()!); return route.fulfill({ json: initial }); });
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/verify", async (route) => {
    calls++;
    const request = route.request(); const body = request.postDataBuffer()!;
    expect(body.toString("latin1")).toContain('name="previous_inspection_id"');
    expect(body.toString("latin1")).toContain("initial");
    expect(request.headers()["authorization"]).toBeUndefined();
    expect(uploadedJpeg(body).equals(initialUpload)).toBe(false);
    await gate;
    progress.setProgress({ step_id: "loop-step", specification_id: initial.specification_id, status: "verified", verified_at: after.inspected_at });
    await route.fulfill({ json: verification(initial, after) });
  });
  await capture(page);
  await page.getByRole("button", { name: "Inspect with Meta AI", exact: true }).click();
  const workflow = page.getByRole("region", { name: "Correction and verification" });
  await expect(workflow.getByText(issue.suggested_fix)).toBeVisible();
  await page.getByRole("button", { name: "I've corrected it", exact: true }).click();
  expect(calls).toBe(0);
  await expect(page.getByRole("button", { name: "Continue to Next Step" })).toHaveCount(0);
  const videoTime = await page.locator("video").evaluate((video: HTMLVideoElement) => video.currentTime);
  await page.waitForFunction((time) => document.querySelector("video")!.currentTime > time + .2, videoTime);
  await page.getByRole("button", { name: "Capture & Verify", exact: true }).click();
  await expect(workflow.getByRole("heading", { name: "Verifying Assembly…" })).toBeVisible();
  await expect(page.getByAltText("Fresh verification snapshot")).toBeVisible();
  await expect(page.getByRole("status", { name: "Camera: Connected" })).toBeVisible();
  release();
  await expect(workflow.getByRole("heading", { name: "Step Verified", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Attach the top", exact: true })).toBeVisible();
  await expect(page.getByText("Step progress: verified", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Meta AI inspection" }).getByAltText("Analyzed snapshot")).toHaveAttribute("src", after.analyzed_snapshot.data_url);
  await expect(page.locator(".diagnostic-boxes")).toHaveCount(0);
  await page.getByText("Finding history (1)", { exact: true }).click();
  await expect(page.locator(".finding-history")).toContainText("resolved");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/verification-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Continue to Next Step" }).click();
  await expect(page.getByRole("heading", { name: "Inspect the finish", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Step Verified", exact: true })).toHaveCount(0);
  await expect(page.locator(".history-entry")).toHaveCount(2);
  expect(calls).toBe(1);
  await page.reload();
  await page.getByRole("combobox", { name: "Assembly project", exact: true }).selectOption(project.id);
  await expect(page.getByText("Step progress: verified", { exact: true })).toBeVisible();
  await expect(page.locator(".history-entry")).toHaveCount(0);
});

for (const [status, heading] of [["incorrect", "Correction Still Required"], ["uncertain", "Another View Needed"]] as const) {
  test(`verification ${status} preserves evidence and requires another explicit scan`, async ({ page }) => {
    await setup(page);
    const initial = await observation(page, "initial", "incorrect");
    const after = await observation(page, "second", status, initial);
    let calls = 0;
    await page.route("**/api/verify", (route) => { calls++; return route.fulfill({ json: verification(initial, after) }); });
    await begin(page, initial);
    await page.getByRole("button", { name: "Capture & Verify", exact: true }).click();
    const workflow = page.getByRole("region", { name: "Correction and verification" });
    await expect(workflow.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue to Next Step" })).toHaveCount(0);
    if (status === "uncertain") await expect(page.getByRole("complementary", { name: "Additional camera view needed" })).toContainText("Move behind the top block");
    await expect(page.getByRole("heading", { name: "Attach the top", exact: true })).toBeVisible();
    expect(calls).toBe(1);
  });
}

for (const failure of ["provider", "expired", "malformed"] as const) {
  test(`${failure} verification never records success or loses the camera`, async ({ page }) => {
    await setup(page);
    const initial = await observation(page, "initial", "incorrect");
    const after = await observation(page, "second", "correct", initial);
    await page.route("**/api/verify", (route) => failure === "malformed" ? route.fulfill({ json: { ...verification(initial, after), issue_assessments: [] } }) :
      route.fulfill({ status: failure === "expired" ? 410 : 503, json: { detail: failure === "expired" ? "Inspection session expired. Start a new inspection." : "AI verification is temporarily unavailable. Please retry." } }));
    await begin(page, initial);
    await page.getByRole("button", { name: "Capture & Verify", exact: true }).click();
    const panel = page.getByRole("region", { name: "Meta AI inspection" });
    await expect(panel.getByRole("alert")).toContainText(failure === "expired" ? "session expired" : failure === "malformed" ? "Invalid verification evidence" : "temporarily unavailable");
    await expect(page.getByRole("heading", { name: "Step Verified", exact: true })).toHaveCount(0);
    await expect(page.locator(".history-entry")).toHaveCount(1);
    await expect(page.getByRole("status", { name: "Camera: Connected" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Inspect with Meta AI", exact: true })).toBeEnabled();
  });
}

for (const change of ["step", "capture", "specification"] as const) {
  test(`${change} change discards a late verification answer`, async ({ page }) => {
    const progress = await setup(page);
    const initial = await observation(page, "initial", "incorrect");
    const after = await observation(page, "second", "correct", initial);
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/verify", async (route) => { await gate; await route.fulfill({ json: verification(initial, after) }); });
    await begin(page, initial);
    await page.getByRole("button", { name: "Capture & Verify", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Verifying Assembly…" })).toBeVisible();
    if (change === "step") await page.getByRole("button", { name: "Next step", exact: true }).click();
    else if (change === "capture") await page.getByRole("button", { name: "Capture", exact: true }).click();
    else {
      await page.route("**/api/projects/loop-project", (route) => route.fulfill({ json: { ...project,
        steps: [{ ...project.steps[0], title: "Updated expected layout" }, project.steps[1]],
      } }));
      progress.setProgress({ step_id: "loop-step", specification_id: "b".repeat(64), status: "not_started", verified_at: null });
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    }
    await expect(page.getByRole("heading", { name: "Verifying Assembly…" })).toHaveCount(0);
    if (change === "specification") await expect(page.getByRole("heading", { name: "Updated expected layout", exact: true })).toBeVisible();
    release();
    await expect(page.getByRole("heading", { name: "Step Verified", exact: true })).toHaveCount(0);
    await expect(page.locator(".history-entry")).toHaveCount(1);
  });
}

test("camera must be running; an initial correct diagnosis is not verified progress", async ({ page }) => {
  await setup(page);
  const initial = await observation(page, "initial", "correct");
  await page.route("**/api/inspect", (route) => route.fulfill({ json: initial }));
  await capture(page);
  await page.getByRole("button", { name: "Inspect with Meta AI", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ready for a verification scan", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Step Verified", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Stop camera", exact: true }).click();
  await page.getByRole("button", { name: "Prepare a new scan", exact: true }).click();
  await expect(page.getByRole("button", { name: "Capture & Verify", exact: true })).toBeDisabled();
});

test("semantic correct cannot override measured geometric incorrect and overlay stays on its snapshot", async ({ page }) => {
  await setup(page);
  const result = await observation(page, "geometry-initial", "correct");
  const target = Array.from({ length: 8 }, (_, index) => ({ block_id: "blue-block", role: "target" as const,
    image: { x_px: 210 + (index % 4) * 20, y_px: 80 + Math.floor(index / 4) * 20 },
    board: { x_mm: 66 + (index % 4) * 8, y_mm: 40 + Math.floor(index / 4) * 8, z_mm: 19.2 } }));
  const reference = Array.from({ length: 8 }, (_, index) => ({ block_id: "yellow-block", role: "reference" as const,
    image: { x_px: 110 + (index % 4) * 20, y_px: 80 + Math.floor(index / 4) * 20 },
    board: { x_mm: 50 + (index % 4) * 8, y_mm: 40 + Math.floor(index / 4) * 8, z_mm: 9.6 } }));
  result.geometry = {
    schema_version: 1, step_id: result.step_id, constraint_id: "constraint-1",
    measurement_status: "measured", geometry_status: "incorrect", constraint_type: "relative_stud_offset",
    axis: "longitudinal", expected_studs: 2, observed_studs: 1, deviation_studs: -1,
    uncertainty_studs: .1, stud_pitch_mm: 8, observed_mm: 8, deviation_mm: -8, tolerance_studs: .15,
    evidence: { calibration_profile_id: "profile-1", snapshot_id: result.snapshot_id,
      calibration_valid: true, board_pose_valid: true, target_feature_count: 8, reference_feature_count: 8,
      features: [...target, ...reference], reference_axis: { origin: { x_mm: 62, y_mm: 44, z_mm: 9.6 }, unit_x: 1, unit_y: 0 },
      reference_axis_image: { start: { x_px: 110, y_px: 90 }, end: { x_px: 170, y_px: 90 } } },
    analyzed_snapshot: result.analyzed_snapshot,
    guidance: "Move the blue target one stud toward board +X.",
    limitations: ["Synthetic browser fixture; no physical accuracy claim."],
  };
  result.state = "correction_required";
  result.correction_plan = [{ issue_id: null, block_id: "blue-block", kind: "geometry_adjust", instruction: result.geometry.guidance }];
  await page.route("**/api/inspect", (route) => route.fulfill({ json: result }));
  await capture(page);
  await page.getByRole("button", { name: "Inspect with Meta AI", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Correction Required", exact: true })).toBeVisible();
  const geometry = page.getByRole("region", { name: "Geometric Verification" });
  await expect(geometry).toContainText("incorrect");
  await expect(geometry).toContainText("1.00 studs");
  await expect(geometry.getByAltText("Exact snapshot used for geometric verification")).toHaveAttribute("src", result.analyzed_snapshot.data_url);
  await expect(geometry.locator(".geometry-stud")).toHaveCount(16);
  await expect(geometry.locator(".geometry-axis")).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Observation workspace" }).locator(".geometry-stud")).toHaveCount(0);
});

for (const status of ["correct", "incorrect", "uncertain"] as const) test(`face ${status} is distinct from semantic correctness`, async ({ page }) => {
  await setup(page);
  const result = await observation(page, "face-initial", "correct");
  result.face = { schema_version: 1, status, expected_face_id: "front", observed_face_id: status === "incorrect" ? "back" : "front",
    matched_reference_image_id: "reference", matching_score: .9, method: "orb_ransac_canny", snapshot_id: result.snapshot_id,
    analyzed_snapshot: result.analyzed_snapshot, quadrilateral: [[40,40],[300,40],[300,160],[40,160]],
    directional_evidence: status !== "uncertain", guidance: status === "incorrect" ? "Turn the required face toward board negative Y." : "Review face direction evidence." };
  result.state = status === "incorrect" ? "correction_required" : status;
  if (status !== "correct") result.correction_plan = [{ issue_id: null, block_id: null, kind: status === "incorrect" ? "face_adjust" : "face_capture", instruction: result.face.guidance }];
  await page.route("**/api/inspect", (route) => route.fulfill({ json: result }));
  await capture(page);
  await page.getByRole("button", { name: "Inspect with Meta AI", exact: true }).click();
  const face = page.getByRole("region", { name: "Face orientation", exact: true });
  await expect(face).toContainText(`Face orientation: ${status}`);
  await expect(face.locator("polygon")).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Observation workspace" }).locator("polygon")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Step Verified", exact: true })).toHaveCount(0);
});

for (const fallback of [false, true]) test(`fresh verification preserves SAM ${fallback ? "fallback" : "mask provenance"} and Phase 4 findings`, async ({ page }) => {
  await setup(page);
  const initial = await observation(page, "sam-initial", "incorrect");
  const after = await observation(page, "sam-verification", "incorrect", initial);
  const mask = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 30; canvas.height = 20;
    const ctx = canvas.getContext("2d")!; ctx.fillStyle = "rgba(255,0,0,.5)"; ctx.fillRect(0, 0, 30, 20);
    return canvas.toDataURL("image/png");
  });
  for (const result of [initial, after]) result.segmentations = [{
    issue_index: 0, status: fallback && result === after ? "unavailable" : "matched",
    concept: "blue building block", prompt_kind: "concept", latency_ms: 100,
    message: fallback && result === after ? "SAM unavailable; Muse diagnosis retained." : "Test-only SAM localization",
    selected_instance_id: fallback && result === after ? null : "instance-1",
    result: fallback && result === after ? null : {
      snapshot_id: result.snapshot_id, width: 400, height: 200, model: "sam-3.1",
      instances: [{ instance_id: "instance-1", left: 40, top: 40, mask: { encoding: "png", width: 30, height: 20, data_url: mask } }],
    },
  }];
  await page.route("**/api/verify", (route) => route.fulfill({ json: verification(initial, after) }));
  await begin(page, initial);
  const panel = page.getByRole("region", { name: "Meta AI inspection", exact: true });
  await expect(panel.getByAltText("SAM mask for issue 1")).toBeVisible();
  await page.getByRole("button", { name: "Capture & Verify", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Correction Still Required", exact: true })).toBeVisible();
  await expect(panel.getByAltText("Analyzed snapshot")).toHaveAttribute("src", after.analyzed_snapshot.data_url);
  if (fallback) {
    await expect(panel.getByAltText("SAM mask for issue 1")).toHaveCount(0);
    await expect(panel.locator('rect[data-source="muse"]')).toHaveCount(1);
    await expect(panel.locator(".segmentation-status")).toContainText("SAM unavailable; Muse diagnosis retained.");
  } else {
    await expect(panel.getByAltText("SAM mask for issue 1")).toBeVisible();
  }
  await panel.getByText("Finding history (1)", { exact: true }).click();
  await expect(panel.getByText("unresolved · misplaced part", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Observation workspace" }).locator(".segmentation-mask")).toHaveCount(0);
  await expect(page.getByText("Step progress: not started", { exact: true })).toBeVisible();
});

for (const invalid of ["hash", "coordinates", "score"] as const) test(`invalid face ${invalid} cannot render or verify`, async ({ page }) => {
  await setup(page);
  const result = await observation(page, "invalid-face", "correct");
  result.face = { schema_version: 1, status: "correct", expected_face_id: "front", observed_face_id: "front",
    matched_reference_image_id: "reference", matching_score: invalid === "score" ? 2 : .9, method: "orb_ransac_canny",
    snapshot_id: invalid === "hash" ? "0".repeat(64) : result.snapshot_id, analyzed_snapshot: result.analyzed_snapshot,
    quadrilateral: [[invalid === "coordinates" ? -1 : 40, 40], [300, 40], [300, 160], [40, 160]],
    directional_evidence: true, guidance: "Synthetic face evidence" };
  await page.route("**/api/inspect", (route) => route.fulfill({ json: result }));
  await capture(page);
  await page.getByRole("button", { name: "Inspect with Meta AI", exact: true }).click();
  await expect(page.getByRole("region", { name: "Meta AI inspection" }).getByRole("alert")).toBeVisible();
  await expect(page.getByRole("region", { name: "Face orientation", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Step Verified", exact: true })).toHaveCount(0);
});

async function contourObservation(page: Page) {
  const result = await observation(page, "contours", "incorrect");
  const mask = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 120; canvas.height = 80;
    canvas.getContext("2d")!.fillRect(0, 0, 120, 80);
    return canvas.toDataURL("image/png");
  });
  result.segmentations = [{ issue_index: 0, status: "matched", concept: "blue building block", prompt_kind: "concept",
    message: "Synthetic mask", latency_ms: 1, selected_instance_id: "part",
    result: { snapshot_id: result.snapshot_id, width: 400, height: 200, model: "sam-3.1", instances: [
      { instance_id: "part", left: 40, top: 40, mask: { encoding: "png", width: 120, height: 80, data_url: mask } },
    ] }, outline: { kind: "sam_outline", status: "available", snapshot_id: result.snapshot_id,
      width: 400, height: 200, message: "Synthetic selected mask boundary",
      paths: [{ points: [[40, 40], [159, 40], [159, 119], [40, 119]], closed: true }] },
  }];
  result.face = { schema_version: 1, status: "uncertain", expected_face_id: "front", observed_face_id: "front",
    matched_reference_image_id: "reference", matching_score: .9, method: "orb_ransac_canny", snapshot_id: result.snapshot_id,
    analyzed_snapshot: result.analyzed_snapshot, quadrilateral: [[40,40],[300,40],[300,160],[40,160]],
    directional_evidence: false, guidance: "Board direction remains unresolved.",
    contours: ["canny_edges", "reference_match"].map((kind) => ({ kind: kind as "canny_edges" | "reference_match",
      status: "available", snapshot_id: result.snapshot_id, width: 400, height: 200,
      message: kind === "canny_edges" ? "Raw ROI edges" : "Verified reference correspondences",
      paths: [{ points: [[80, 60], [100, 80]], closed: false }] })),
  };
  result.correction_plan.push({ issue_id: null, block_id: null, kind: "face_capture", instruction: result.face.guidance });
  return result;
}

test("contour modes toggle independently, align responsively and clear on a fresh capture", async ({ page }) => {
  await setup(page);
  const result = await contourObservation(page);
  await page.route("**/api/inspect", (route) => route.fulfill({ json: result }));
  await capture(page);
  await page.getByRole("button", { name: "Inspect with Meta AI", exact: true }).click();
  const panel = page.getByRole("region", { name: "Meta AI inspection" });
  const diagnostic = panel.locator(".diagnostic-overlay");
  const face = panel.getByRole("region", { name: "Face orientation", exact: true });
  await expect(face).toBeVisible();
  await expect(panel.locator("[data-contour-kind]")).toHaveCount(0);
  await diagnostic.getByRole("checkbox", { name: "SAM Outline", exact: true }).check();
  await face.getByRole("checkbox", { name: "Canny Edges", exact: true }).check();
  await face.getByRole("checkbox", { name: "Reference Match", exact: true }).check();
  await expect(panel.locator("[data-contour-kind]")).toHaveCount(3);
  await expect(face.locator('[data-contour-kind="canny_edges"] path')).toHaveAttribute("stroke-dasharray", "3 2");
  await expect(face.locator('[data-contour-kind="reference_match"] path')).not.toHaveAttribute("stroke-dasharray");
  await diagnostic.getByRole("checkbox", { name: "Bounding Box", exact: true }).uncheck();
  await expect(diagnostic.locator("rect[data-source]")).toHaveCount(0);
  await expect(diagnostic.locator('[data-contour-kind="sam_outline"]')).toHaveCount(1);
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const bounds = (await diagnostic.getByAltText("Analyzed snapshot").boundingBox())!;
    // Test the geometric point, not the painted stroke's expanded bounding rectangle.
    const outline = await diagnostic.locator('[data-contour-kind="sam_outline"] path').evaluate((node: SVGPathElement) => {
      const point = node.getPointAtLength(0).matrixTransform(node.getScreenCTM()!);
      return { x: point.x, y: point.y };
    });
    expect((outline.x - bounds.x) / bounds.width).toBeCloseTo(.1, 3);
    expect((outline.y - bounds.y) / bounds.height).toBeCloseTo(.2, 3);
    const faceBounds = (await face.getByAltText("Exact face inspection snapshot").boundingBox())!;
    const edgeBounds = await face.locator('[data-contour-kind="canny_edges"] path').evaluate((node: SVGPathElement) => {
      const point = node.getPointAtLength(0).matrixTransform(node.getScreenCTM()!);
      return { x: point.x, y: point.y };
    });
    expect((edgeBounds.x - faceBounds.x) / faceBounds.width).toBeCloseTo(.2, 3);
    expect((edgeBounds.y - faceBounds.y) / faceBounds.height).toBeCloseTo(.3, 3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await face.getByRole("checkbox", { name: "Canny Edges", exact: true }).uncheck();
  await expect(face.locator('[data-contour-kind="reference_match"]')).toHaveCount(1);
  await expect(face.locator('[data-contour-kind="canny_edges"]')).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Observation workspace" }).locator(".contour-overlay")).toHaveCount(0);
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await expect(panel.locator("[data-contour-kind]")).toHaveCount(0);
});

for (const invalid of ["snapshot", "bounds", "dimensions", "budget"] as const) test(`invalid contour ${invalid} rejected before display`, async ({ page }) => {
  await setup(page);
  const result = await contourObservation(page);
  const layer = result.face!.contours![0];
  if (invalid === "snapshot") layer.snapshot_id = "0".repeat(64);
  if (invalid === "bounds") layer.paths[0].points[0][0] = -1;
  if (invalid === "dimensions") layer.width = 800;
  if (invalid === "budget") layer.paths = Array.from({ length: 65 }, () => layer.paths[0]);
  await page.route("**/api/inspect", (route) => route.fulfill({ json: result }));
  await capture(page);
  await page.getByRole("button", { name: "Inspect with Meta AI", exact: true }).click();
  const panel = page.getByRole("region", { name: "Meta AI inspection" });
  await expect(panel.getByRole("alert")).toBeVisible();
  await expect(panel.locator("[data-contour-kind]")).toHaveCount(0);
});

test("missing contour evidence stays unavailable without additional inference", async ({ page }) => {
  await setup(page);
  const result = await contourObservation(page);
  result.segmentations = [];
  result.face!.contours = [];
  let calls = 0;
  await page.route("**/api/inspect", (route) => { calls++; return route.fulfill({ json: result }); });
  await capture(page);
  await page.getByRole("button", { name: "Inspect with Meta AI", exact: true }).click();
  const panel = page.getByRole("region", { name: "Meta AI inspection" });
  const face = panel.getByRole("region", { name: "Face orientation", exact: true });
  for (const name of ["Canny Edges", "Reference Match", "SAM Outline"]) {
    await expect(face.getByRole("checkbox", { name, exact: true })).toBeDisabled();
    await expect(face.getByText(`${name} unavailable:`, { exact: false })).toBeVisible();
  }
  expect(calls).toBe(1);
});

test("independent edge debugging preserves the current correction workflow", async ({ page }) => {
  await setup(page);
  const initial = await observation(page, "edge-preserved", "incorrect");
  await begin(page, initial);
  const debug = page.getByRole("region", { name: "Edge Detection Debug Mode" });
  await debug.getByRole("checkbox", { name: "Enable edge debug mode" }).check();
  await debug.getByRole("button", { name: "Detect edges", exact: true }).click();
  await expect(debug.getByAltText("Detected Canny edge image")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ready to Verify", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Meta AI inspection" }).getByAltText("Analyzed snapshot")).toHaveAttribute("src", initial.analyzed_snapshot.data_url);
  await expect(page.getByRole("heading", { name: "Step Verified", exact: true })).toHaveCount(0);
});

for (const kind of ["match", "mismatch", "uncertain", "direction"] as const) {
  test(`printed recognition ${kind} remains separate from the final gate and exact image`, async ({ page }) => {
    await setup(page);
    const result = await observation(page, "print-test", "correct");
    const uncertain = kind === "uncertain" || kind === "direction";
    result.print_recognition = {
      schema_version: 1, target_block_id: "yellow", expected_print: "Involve Me",
      observed_print: kind === "mismatch" ? "insights" : kind === "uncertain" ? null : "Involve Me",
      observed_logo: null, observed_registered_side_id: null, observed_registered_side_name: null,
      recognition_status: kind === "direction" ? "match" : kind,
      recognition_method: "meta_zero_shot", evidence_quality: kind === "uncertain" ? "unreadable" : "clear",
      known_alternative: kind === "mismatch", description: "Synthetic printed evidence.",
      suggested_action: "Capture the printed side in diffuse light.", snapshot_id: result.snapshot_id,
      bounding_box: kind === "uncertain" ? null : { x: .2, y: .3, width: .4, height: .2 },
      reference_image_id: null, direction_required: kind === "direction", direction_supported: false,
      gate_status: uncertain ? "uncertain" : kind === "match" ? "pass" : "fail",
    };
    result.state = uncertain ? "uncertain" : kind === "match" ? "correct" : "correction_required";
    if (kind !== "match") result.correction_plan.push({ issue_id: null, block_id: "yellow", kind: uncertain ? "print_capture" : "print_adjust", instruction: result.print_recognition.suggested_action });
    let calls = 0;
    await page.route("**/api/inspect", (route) => { calls++; return route.fulfill({ json: result }); });
    await capture(page);
    await page.getByRole("button", { name: "Inspect with Meta AI", exact: true }).click();
    const panel = page.getByRole("region", { name: "Printed Text & Logo Inspection" });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Expected: Involve Me");
    await expect(panel).toContainText(`Print Recognition: ${result.print_recognition.recognition_status}`);
    await expect(panel.getByAltText("Exact print inspection snapshot")).toHaveAttribute("src", result.analyzed_snapshot.data_url);
    if (kind === "direction") await expect(panel).toContainText("Physical direction: Uncertain");
    if (kind === "uncertain") {
      await expect(panel).toContainText("No reliable printed region");
      await expect(panel.locator("svg")).toHaveCount(0);
    } else {
      const box = panel.locator("svg rect");
      await expect(box).toHaveAttribute("x", "200");
      await expect(box).toHaveAttribute("width", "400");
      await page.setViewportSize({ width: 390, height: 844 });
      const imageBounds = await panel.getByAltText("Exact print inspection snapshot").boundingBox();
      const svgBounds = await panel.locator("svg").boundingBox();
      expect(svgBounds!.width).toBeCloseTo(imageBounds!.width, 1);
      expect(svgBounds!.height).toBeCloseTo(imageBounds!.height, 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.getByRole("button", { name: "Capture", exact: true }).click();
    await expect(panel).toHaveCount(0);
    expect(calls).toBe(1);
  });
}

test("stale printed result hash is rejected before drawing its region", async ({ page }) => {
  await setup(page);
  const result = await observation(page, "print-stale", "correct");
  result.print_recognition = {
    schema_version: 1, target_block_id: "yellow", expected_print: "Involve Me", observed_print: "Involve Me",
    observed_logo: null, observed_registered_side_id: null, observed_registered_side_name: null,
    recognition_status: "match", recognition_method: "meta_zero_shot", evidence_quality: "clear", known_alternative: false,
    description: "Synthetic stale evidence", suggested_action: "Review", snapshot_id: "0".repeat(64),
    bounding_box: { x: .2, y: .2, width: .2, height: .2 }, reference_image_id: null,
    direction_required: false, direction_supported: false, gate_status: "pass",
  };
  await page.route("**/api/inspect", (route) => route.fulfill({ json: result }));
  await capture(page);
  await page.getByRole("button", { name: "Inspect with Meta AI", exact: true }).click();
  await expect(page.getByRole("region", { name: "Meta AI inspection" }).getByRole("alert")).toBeVisible();
  await expect(page.getByRole("region", { name: "Printed Text & Logo Inspection" })).toHaveCount(0);
});
