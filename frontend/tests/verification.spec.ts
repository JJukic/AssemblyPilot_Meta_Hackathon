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
