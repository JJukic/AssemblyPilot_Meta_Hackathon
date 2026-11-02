import { createHash } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
const E2E_API = "http://127.0.0.1:8000"; // same disposable test API as the other specs

/* Guided demo flow (button-only, mocked Meta — zero paid calls):
 * Bereit → Prüfen → falsch (rot) → Erneut prüfen → korrekt (+ separate
 * verification frame) → Nächster Schritt → unsicher → Position bestätigen. */

const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==", "base64");
const shot = (n: number) => Buffer.concat([JPEG, Buffer.from([n])]);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const BRICK = { x_mm: 31.8, y_mm: 9.6, z_mm: 15.8 };

async function demo(request: APIRequestContext) {
  const block = await (await request.post(`${E2E_API}/api/blocks`, { data: { name: "2x4 Stein", color: "red" } })).json();
  const project = await (await request.post(`${E2E_API}/api/projects`, { data: { name: "AR-Demo guided" } })).json();
  for (const [title, x] of [["Roten 2×4-Stein setzen", 0], ["Zweiten 2×4-Stein setzen", 0.04]] as const) {
    const step = await (await request.post(`${E2E_API}/api/projects/${project.id}/steps`, {
      data: { title, instruction: "Lege den roten 2×4-Stein auf die grüne Markierung.", required_blocks: [{ block_id: block.id, required_quantity: 1 }] },
    })).json();
    const put = await request.put(`${E2E_API}/api/projects/${project.id}/steps/${step.id}/ar-placement`, {
      data: { target_block_id: block.id, instance: 1, origin: "tabletop_session", method: "manual_authoring", evidence: "measured",
        confirmed: true, dimensions: BRICK, studs: null, position_m: [x, 0.0032, 0], rotation_deg: [0, 0, 0] },
    });
    expect(put.ok()).toBe(true);
  }
  const steps = await (await request.get(`${E2E_API}/api/projects/${project.id}/steps`)).json();
  const progress = await (await request.get(`${E2E_API}/api/projects/${project.id}/progress`)).json();
  return { project, steps, spec: (id: string) => progress.find((p: { step_id: string }) => p.step_id === id).specification_id };
}

function workflow(stepId: string, specId: string, n: number, kind: "correct" | "incorrect" | "uncertain") {
  const state = kind === "correct" ? "correct" : kind === "incorrect" ? "correction_required" : "uncertain";
  // Mirrors the real backend contract (tracked issue + adjust action / capture action).
  const issue = { type: "misplaced_part", block_id: null, description: "Der Stein liegt neben der Markierung.", expected: "Auf der grünen Markierung", observed: "2 cm daneben", suggested_fix: "Stein auf die Markierung schieben.", bounding_box: null };
  const tracked = kind === "incorrect"
    ? [{ issue_id: `iss-${n}`, original_inspection_id: `insp-${n}`, original_snapshot_id: sha(shot(n)), original: issue, resolution: "open", evidence: issue.observed, current_issue_index: 0 }]
    : [];
  const plan = kind === "incorrect"
    ? [{ issue_id: `iss-${n}`, block_id: null, kind: "adjust", instruction: issue.suggested_fix }]
    : kind === "uncertain" ? [{ issue_id: null, block_id: null, kind: "capture", instruction: "Von oben zeigen." }] : [];
  return {
    step_id: stepId, status: kind, confidence: 0.9, visible_blocks: [],
    issues: kind === "incorrect" ? [issue] : [],
    explanation: "Mocked assessment.", next_action: "Mocked next action.",
    active_vision: kind === "uncertain" ? { reason: "Stein verdeckt", requested_view: "top_down", instruction: "Von oben zeigen." } : null,
    comparison_reference_id: null,
    analyzed_snapshot: { data_url: `data:image/jpeg;base64,${shot(n).toString("base64")}`, width: 64, height: 48 },
    inspection_id: `insp-${n}`, snapshot_id: sha(shot(n)), specification_id: specId, state,
    tracked_issues: tracked, correction_plan: plan, segmentations: [], model: "muse-spark-1.3", model_latency_ms: 10,
    inspected_at: new Date().toISOString(), muse_call_count: 1, meta_attempt_count: 1, print_recognition: null, face: null, geometry: null,
  };
}

async function fakeCamera(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "xr", { value: undefined, configurable: true });
    const canvas = document.createElement("canvas");
    canvas.width = 320; canvas.height = 240;
    const ctx = canvas.getContext("2d")!;
    let t = 0;
    setInterval(() => { ctx.fillStyle = "#2a6"; ctx.fillRect(0, 0, 320, 240); ctx.fillStyle = "#d22"; ctx.fillRect(120 + (t++ % 2), 90, 64, 32); }, 50);
    const real = navigator.mediaDevices;
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
      // Like a real browser: a NEW stream per request (stopping one never kills the next).
      getUserMedia: async (c: MediaStreamConstraints) => (c?.video ? canvas.captureStream(20) : real.getUserMedia(c)),
      enumerateDevices: () => real.enumerateDevices(),
      addEventListener: (...x: unknown[]) => (real.addEventListener as (...a: unknown[]) => void)(...x),
      removeEventListener: (...x: unknown[]) => (real.removeEventListener as (...a: unknown[]) => void)(...x),
    } });
  });
}

const card = (page: Page) => page.getByRole("region", { name: "Guided assembly step" });
const state = (page: Page) => page.getByRole("status", { name: "Step status" });

test("guided demo: Check → falsch → Check again → korrekt → Next step → unsicher → Confirm position (buttons only)", async ({ page, request }) => {
  test.setTimeout(90000);
  const a = await demo(request);
  const [s1, s2] = a.steps;
  await fakeCamera(page);
  const calls: string[] = [];
  let next: "incorrect" | "correct" | "uncertain" = "incorrect";
  let n = 0;
  await page.route("**/api/inspect", async (r) => {
    const stepId = String(r.request().postDataBuffer()?.toString("latin1").match(/name="step_id"\r\n\r\n([^\r]+)/)?.[1]);
    calls.push(`inspect:${next}`);
    return r.fulfill({ json: workflow(stepId, a.spec(stepId), ++n, next) });
  });
  await page.route("**/api/verify", async (r) => {
    const body = r.request().postDataBuffer()?.toString("latin1") ?? "";
    const stepId = String(body.match(/name="step_id"\r\n\r\n([^\r]+)/)?.[1]);
    const previous = String(body.match(/name="previous_inspection_id"\r\n\r\n([^\r]+)/)?.[1]);
    calls.push("verify");
    const inspection = { ...workflow(stepId, a.spec(stepId), ++n, "correct"), state: "verified" };
    return r.fulfill({ json: { verification_id: `ver-${n}`, previous_inspection_id: previous, status: "verified", inspection, issue_assessments: [] } });
  });

  await page.goto(`/ar?project=${a.project.id}`);
  await expect(card(page)).toContainText("Step 1 of 2");
  await expect(card(page)).toContainText("Place the red 2×4 brick on the green marker.");
  await expect(state(page)).toHaveText("Ready");
  // No voice is needed anywhere in the flow; the step buttons are plain buttons.
  await expect(page.locator(".ar-options[open]")).toHaveCount(0);
  await page.getByText("Voice control · Off", { exact: true }).click();
  await expect(page.getByRole("status", { name: "Local microphone state" })).toContainText("Off");
  await expect(page.getByRole("button", { name: "Enable local voice control", exact: true })).toBeDisabled();
  await page.getByText("Voice control · Off", { exact: true }).click();

  await card(page).getByRole("button", { name: "Check", exact: true }).click();
  await expect(state(page)).toHaveText("Try again", { timeout: 20000 });
  await expect(card(page)).toContainText("Adjust the brick.");
  await expect(card(page).getByRole("button", { name: "Next step" })).toHaveCount(0);

  next = "correct";
  await card(page).getByRole("button", { name: "Check again" }).click();
  await expect(state(page)).toHaveText("Correct", { timeout: 30000 });
  await expect(card(page)).toContainText("Step correct.");
  expect(calls).toEqual(["inspect:incorrect", "inspect:correct", "verify"]);

  await card(page).getByRole("button", { name: "Next step" }).click();
  await expect(card(page)).toContainText("Step 2 of 2", { timeout: 15000 });
  await expect(state(page)).toHaveText("Ready", { timeout: 15000 });
  await page.getByText("Full instructions, reference & inspection results", { exact: true }).click();
  await expect(page.getByRole("heading", { name: `Step 2 — ${s2.title}` })).toBeVisible();

  next = "uncertain";
  await card(page).getByRole("button", { name: "Check", exact: true }).click();
  await expect(state(page)).toHaveText("Position uncertain", { timeout: 20000 });
  await card(page).getByRole("button", { name: "Confirm position" }).click();
  await expect(state(page)).toHaveText("Confirmed");
  await expect(card(page)).toContainText("not AI verified");
  // Manual confirmation never writes backend verification.
  const progress = await (await request.get(`${E2E_API}/api/projects/${a.project.id}/progress`)).json();
  expect(progress.find((p: { step_id: string }) => p.step_id === s2.id).status).not.toBe("verified");
  expect(s1.id).toBeTruthy();
});
