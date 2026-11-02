import { createHash } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
const api = "http://127.0.0.1:8000";
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAwAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDxyiiiv3E8wKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/9k=", "base64");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function setup(request: APIRequestContext) {
  const block = await (await request.post(`${api}/api/blocks`, { data: { name: "Result block", color: "blue" } })).json();
  const project = await (await request.post(`${api}/api/projects`, { data: { name: "Result bridge" } })).json();
  const step = await (await request.post(`${api}/api/projects/${project.id}/steps`, {
    data: { title: "Result step", instruction: "Place the blue block.", required_blocks: [{ block_id: block.id, required_quantity: 1 }] },
  })).json();
  const progress = await (await request.get(`${api}/api/projects/${project.id}/progress`)).json();
  const specId = progress.find((s: { step_id: string }) => s.step_id === step.id).specification_id;
  return { project, step, specId, block };
}

function result(opts: {
  stepId: string; specId: string; status: string; state: string; jpeg?: Buffer;
  explanation: string; issues?: object[]; plan?: object[]; next: string;
  vision?: object | null; id?: string;
}) {
  const jpeg = opts.jpeg ?? JPEG;
  return {
    step_id: opts.stepId, status: opts.status, confidence: 0.9, visible_blocks: [],
    issues: opts.issues ?? [], explanation: opts.explanation, next_action: opts.next,
    active_vision: opts.vision ?? null, comparison_reference_id: null,
    analyzed_snapshot: { data_url: `data:image/jpeg;base64,${jpeg.toString("base64")}`, width: 64, height: 48 },
    inspection_id: opts.id ?? "insp-1", snapshot_id: sha(jpeg), specification_id: opts.specId,
    state: opts.state,
    tracked_issues: (opts.issues ?? []).map((issue, i) => ({
      issue_id: `track-${i + 1}`, original_inspection_id: opts.id ?? "insp-1",
      original_snapshot_id: sha(jpeg), original: issue, resolution: "open",
      evidence: (issue as { observed: string }).observed, current_issue_index: i,
    })),
    correction_plan: opts.plan ?? [], segmentations: [],
    model: "muse-spark-1.3", model_latency_ms: 10, inspected_at: new Date().toISOString(),
    muse_call_count: 1, meta_attempt_count: 1,
  };
}
const ISSUE = {
  type: "wrong_color", block_id: null,
  description: "The top block is red instead of blue.",
  expected: "A blue block on top.", observed: "A red block on top.",
  suggested_fix: "Replace the red block with the blue block.", bounding_box: null,
};

async function intent(page: Page, a: { project: { id: string }; step: { id: string } }) {
  await page.addInitScript(
    ({ projectId, stepId }) => sessionStorage.setItem("assemblypilot.voice-verify",
      JSON.stringify({ mode: "inspect", projectId, stepId, requestedAt: new Date().toISOString() })),
    { projectId: a.project.id, stepId: a.step.id },
  );
}

test("incorrect Meta result is shown in camera workspace and again inside AR after return", async ({ page, request }) => {
  const a = await setup(request);
  await page.route("**/api/inspect", (r) => r.fulfill({ json: result({
    stepId: a.step.id, specId: a.specId, status: "incorrect", state: "correction_required",
    explanation: "The assembly does not match the expected step.", issues: [ISSUE],
    plan: [{ issue_id: "track-1", block_id: null, kind: "adjust", instruction: "Replace the red block with the blue block." }],
    next: "Fix the top block, then verify again.",
  }) }));
  await intent(page, a);
  await page.goto(`/?project=${a.project.id}&step=${a.step.id}`);
  await expect(page.getByText("Replace the red block with the blue block.").first()).toBeVisible({ timeout: 20000 });
  await page.getByRole("link", { name: "Return to AR with result" }).click();
  const card = page.getByRole("region", { name: "Latest Meta inspection result" });
  await expect(card).toBeVisible({ timeout: 10000 });
  await expect(card).toContainText("Incorrect — Correction Required");
  await expect(card).toContainText("Expected: A blue block on top.");
  await expect(card).toContainText("Observed: A red block on top.");
  await expect(card).toContainText("Correction plan");
  await expect(card).toContainText("Step verified: No");
  expect((await (await request.get(`${api}/api/projects/${a.project.id}/progress`)).json())
    .every((s: { status: string }) => s.status !== "verified")).toBe(true);
});

test("correct assessment in AR is not falsely shown as verified progress", async ({ page, request }) => {
  const a = await setup(request);
  await page.route("**/api/inspect", (r) => r.fulfill({ json: result({
    stepId: a.step.id, specId: a.specId, status: "correct", state: "correct",
    explanation: "The blue block is in place.", next: "Run a fresh verification scan.",
  }) }));
  await intent(page, a);
  await page.goto(`/?project=${a.project.id}&step=${a.step.id}`);
  await expect(page.getByText("The blue block is in place.")).toBeVisible({ timeout: 20000 });
  await page.getByRole("link", { name: "Return to AR with result" }).click();
  const card = page.getByRole("region", { name: "Latest Meta inspection result" });
  await expect(card).toContainText("AI Assessment: Correct");
  await expect(card).toContainText("Step verified: No — fresh verification required");
});

test("uncertain result shows the requested view; failed inspection shows an error, not incorrect", async ({ page, request }) => {
  const a = await setup(request);
  await page.route("**/api/inspect", (r) => r.fulfill({ json: result({
    stepId: a.step.id, specId: a.specId, status: "uncertain", state: "uncertain",
    explanation: "The top of the build is hidden.", next: "Take another photo.",
    plan: [{ issue_id: null, block_id: null, kind: "capture", instruction: "Take a top-down photo." }],
    vision: { reason: "The top is hidden", requested_view: "top_down", instruction: "Take a top-down photo." },
  }) }));
  await intent(page, a);
  await page.goto(`/?project=${a.project.id}&step=${a.step.id}`);
  await expect(page.getByText(/Take a top-down photo/).first()).toBeVisible({ timeout: 20000 });
  await page.getByRole("link", { name: "Return to AR with result" }).click();
  const card = page.getByRole("region", { name: "Latest Meta inspection result" });
  await expect(card).toContainText("Uncertain — Another View Needed");
  await expect(card).toContainText("top_down");
});

test("inspection failure is preserved as Inspection Failed in AR (previous success cannot pose as current)", async ({ page, request }) => {
  const a = await setup(request);
  await page.route("**/api/inspect", (r) => r.fulfill({ status: 503, json: { detail: { code: "meta_unavailable", message: "MODEL_API_KEY is not configured" } } }));
  await intent(page, a);
  await page.goto(`/?project=${a.project.id}&step=${a.step.id}`);
  await expect(page.getByRole("region", { name: "Meta AI inspection" }).getByRole("alert"))
    .toContainText("MODEL_API_KEY", { timeout: 20000 });
  await page.goto(`/ar?project=${a.project.id}`);
  const card = page.getByRole("region", { name: "Latest Meta inspection result" });
  await expect(card).toContainText("Inspection Failed");
  await expect(card).not.toContainText("AI Assessment: Correct");
});

test("wrong printed side: semantic correct must never present as overall Correct (desktop + AR)", async ({ page, request }) => {
  const a = await setup(request);
  const jpeg = JPEG;
  const print = {
    schema_version: 1, target_block_id: a.block.id, expected_print: "Involve Me",
    observed_print: "insights", observed_logo: null, observed_registered_side_id: null,
    observed_registered_side_name: "insights side", recognition_status: "mismatch",
    recognition_method: "meta_zero_shot", evidence_quality: "clear", known_alternative: true,
    description: "The visible printed side reads insights, which differs from the required Involve Me side.",
    suggested_action: "Present the registered print \u201cInvolve Me\u201d on the required surface, then capture a fresh image.",
    snapshot_id: sha(jpeg), bounding_box: null, reference_image_id: null,
    direction_required: false, direction_supported: false, gate_status: "fail",
  };
  await page.route("**/api/inspect", (r) => r.fulfill({ json: {
    ...result({
      stepId: a.step.id, specId: a.specId, status: "correct", state: "correction_required",
      explanation: "The block shape, color and arrangement are correct. The visible printed side reads insights.",
      next: "Correct the printed side, then verify again.",
      plan: [{ issue_id: null, block_id: a.block.id, kind: "print_adjust", instruction: print.suggested_action }],
    }),
    print_recognition: print, face: null, geometry: null,
  } }));
  await intent(page, a);
  await page.goto(`/?project=${a.project.id}&step=${a.step.id}`);
  const overall = page.getByRole("region", { name: "Overall assembly result" });
  await expect(overall).toContainText("OVERALL ASSEMBLY RESULT: INCORRECT", { timeout: 20000 });
  await expect(overall).toContainText("Expected:");
  await expect(overall).toContainText("Involve Me");
  await expect(overall).toContainText("insights");
  await expect(page.getByRole("region", { name: "Printed Text & Logo Inspection" })).toContainText("FAIL");
  await page.getByRole("link", { name: "Return to AR with result" }).click();
  const card = page.getByRole("region", { name: "Latest Meta inspection result" });
  await expect(card).toContainText("Incorrect \u2014 Correction Required");
  await expect(card).toContainText("Wrong printed side");
  await expect(card).toContainText("Expected: Involve Me");
  await expect(card).toContainText("Observed: insights");
  await expect(card).toContainText("Step verified: No");
  expect((await (await request.get(`${api}/api/projects/${a.project.id}/progress`)).json())
    .every((s: { status: string }) => s.status !== "verified")).toBe(true);
});
