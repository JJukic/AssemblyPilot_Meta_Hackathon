import { createHash } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// The AR page groups secondary controls in collapsed sections (details.ar-options).
// These specs exercise the contents, so the sections are opened on every load;
// the collapsed default itself is covered in ar.spec.ts.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // Nested sections too — except the React-controlled voice command list (its state is under test).
    const open = () => document.querySelectorAll<HTMLDetailsElement>("details.ar-options:not([open]), details.ar-options details:not([open])")
      .forEach((d) => { if (d.querySelector("summary")?.textContent !== "Available voice commands") d.setAttribute("open", ""); });
    new MutationObserver(open).observe(document, { childList: true, subtree: true });
  });
});
const api = "http://127.0.0.1:8000";
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAwAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNXaP/Z", "base64");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function setup(request: APIRequestContext) {
  const block = await (await request.post(`${api}/api/blocks`, { data: { name: "InAR block", color: "yellow" } })).json();
  const project = await (await request.post(`${api}/api/projects`, { data: { name: "In-AR verify" } })).json();
  const step = await (await request.post(`${api}/api/projects/${project.id}/steps`, {
    data: { title: "First", instruction: "Place the yellow block.", required_blocks: [{ block_id: block.id, required_quantity: 1 }] },
  })).json();
  const progress = await (await request.get(`${api}/api/projects/${project.id}/progress`)).json();
  return { block, project, step, specId: progress[0].specification_id };
}

async function fakeCamera(page: Page, a: Awaited<ReturnType<typeof setup>>) {
  const print = {
    schema_version: 1, target_block_id: a.block.id, expected_print: "Involve Me",
    observed_print: "insights", observed_logo: null, observed_registered_side_id: null,
    observed_registered_side_name: null, recognition_status: "mismatch",
    recognition_method: "meta_zero_shot", evidence_quality: "clear", known_alternative: true,
    description: "Wrong printed side.", suggested_action: "Present the registered print “Involve Me” on the required surface, then capture a fresh image.",
    snapshot_id: sha(JPEG), bounding_box: null, reference_image_id: null,
    direction_required: false, direction_supported: false, gate_status: "fail",
  };
  await page.route("**/api/inspect", (r) => r.fulfill({ json: {
    step_id: a.step.id, status: "correct", confidence: 0.9, visible_blocks: [], issues: [],
    explanation: "Shape is correct; printed side is wrong.", next_action: "Fix the printed side.",
    active_vision: null, comparison_reference_id: null,
    analyzed_snapshot: { data_url: `data:image/jpeg;base64,${JPEG.toString("base64")}`, width: 64, height: 48 },
    inspection_id: "insp-1", snapshot_id: sha(JPEG), specification_id: a.specId,
    state: "correction_required", tracked_issues: [],
    correction_plan: [{ issue_id: null, block_id: a.block.id, kind: "print_adjust", instruction: print.suggested_action }],
    segmentations: [], model: "muse-spark-1.3", model_latency_ms: 10,
    inspected_at: new Date().toISOString(), muse_call_count: 1, meta_attempt_count: 1,
    print_recognition: print, face: null, geometry: null,
  } }));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "xr", { value: undefined, configurable: true });
    const canvas = document.createElement("canvas");
    canvas.width = 320; canvas.height = 240;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ccaa00"; ctx.fillRect(0, 0, 320, 240);
    ctx.fillStyle = "#2255aa"; ctx.fillRect(100, 80, 90, 90);
    const stream = canvas.captureStream(10);
    const real = navigator.mediaDevices;
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
      getUserMedia: async (c: MediaStreamConstraints) => (c?.video ? stream : real.getUserMedia(c)),
      enumerateDevices: () => real.enumerateDevices(),
      addEventListener: (...x: unknown[]) => (real.addEventListener as (...a: unknown[]) => void)(...x),
      removeEventListener: (...x: unknown[]) => (real.removeEventListener as (...a: unknown[]) => void)(...x),
    } });
  });
}

test("external companion captures for an in-AR request and returns the validated result without verifying", async ({ page, request }) => {
  test.setTimeout(60000);
  const a = await setup(request);
  await fakeCamera(page, a);
  const created = await request.post(`${api}/api/ar-camera/requests`, {
    data: { project_id: a.project.id, step_id: a.step.id, code: "CAM123", mode: "inspect" },
  });
  expect(created.status()).toBe(201);
  await page.goto(`/ar?project=${a.project.id}`);
  await expect(page.getByRole("heading", { name: "Step 1 — First" })).toBeVisible();
  await page.getByLabel(/Camera pairing code/).fill("CAM123");
  await page.getByRole("button", { name: /Act as external camera companion/ }).click();
  await expect(page.getByText(/Companion captured a fresh frame/)).toBeVisible({ timeout: 20000 });
  const latest = await (await request.get(`${api}/api/ar-camera/result`, {
    params: { project_id: a.project.id, step_id: a.step.id, code: "CAM123" },
  })).json();
  expect(latest.result.summary.overall.kind).toBe("incorrect");
  expect(latest.result.summary.overall.observedPrint).toBe("insights");
  expect((await (await request.get(`${api}/api/projects/${a.project.id}/progress`)).json())
    .every((s: { status: string }) => s.status !== "verified")).toBe(true);
  // The local AR page also surfaces the same overall result.
  await expect(page.getByRole("region", { name: "Latest Meta inspection result" }))
    .toContainText("Incorrect — Correction Required", { timeout: 10000 });
});
