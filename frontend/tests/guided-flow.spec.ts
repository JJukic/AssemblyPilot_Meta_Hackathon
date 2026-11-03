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
  return { block, project, steps, spec: (id: string) => progress.find((p: { step_id: string }) => p.step_id === id).specification_id };
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

  await card(page).getByRole("button", { name: "Check Step", exact: true }).click();
  await expect(state(page)).toHaveText("Try again", { timeout: 20000 });
  await expect(card(page)).toContainText("Adjust the brick.");
  await expect(card(page).getByRole("button", { name: "Next Step" })).toHaveCount(0);

  next = "correct";
  await card(page).getByRole("button", { name: "Check Again" }).click();
  await expect(state(page)).toHaveText("Correct", { timeout: 30000 });
  await expect(card(page)).toContainText("Step correct.");
  expect(calls).toEqual(["inspect:incorrect", "inspect:correct", "verify"]);
  await expect(card(page).getByRole("button", { name: "Finish" })).toHaveCount(0); // not the last step

  await card(page).getByRole("button", { name: "Next Step" }).click();
  await expect(card(page)).toContainText("Step 2 of 2", { timeout: 15000 });
  await expect(state(page)).toHaveText("Ready", { timeout: 15000 });
  await page.getByText("Full instructions, reference & inspection results", { exact: true }).click();
  await expect(page.getByRole("heading", { name: `Step 2 — ${s2.title}` })).toBeVisible();

  next = "uncertain";
  await card(page).getByRole("button", { name: "Check Step", exact: true }).click();
  await expect(state(page)).toHaveText("Position uncertain", { timeout: 20000 });
  await card(page).getByRole("button", { name: "Confirm Position" }).click();
  await expect(state(page)).toHaveText("Confirmed");
  await expect(card(page)).toContainText("not AI verified");
  // Manual confirmation never writes backend verification.
  const progress = await (await request.get(`${E2E_API}/api/projects/${a.project.id}/progress`)).json();
  expect(progress.find((p: { step_id: string }) => p.step_id === s2.id).status).not.toBe("verified");
  expect(s1.id).toBeTruthy();
});

test("AR page: secondary sections are collapsed by default and open with one click", async ({ page, request }) => {
  const a = await demo(request);
  await fakeCamera(page);
  await page.goto(`/ar?project=${a.project.id}`);
  await expect(card(page)).toContainText("Step 1 of 2");
  const sections = page.locator("details.ar-options");
  expect(await sections.count()).toBeGreaterThan(2);
  await expect(page.locator("details.ar-options[open]")).toHaveCount(0);
  await page.getByText("Placement tools & 2D preview", { exact: true }).click();
  await expect(page.getByRole("img", { name: "2D intended placement" })).toBeVisible();
  await expect(page.getByRole("img", { name: "2D height view (front)" })).toBeVisible();
});

test("last step: Next Step is replaced by Finish only after backend verification; Finish completes the assembly", async ({ page, request }) => {
  test.setTimeout(90000);
  const a = await demo(request);
  const [s1, s2] = a.steps;
  // Open the project on the LAST step (shared cursor), as after Next Step on a real device.
  const view = await (await request.get(`${E2E_API}/api/projects/${a.project.id}/ar-view`)).json();
  expect((await request.put(`${E2E_API}/api/projects/${a.project.id}/ar-view`, { data: { step_id: s2.id, revision: view.revision } })).ok()).toBe(true);
  await fakeCamera(page);
  let next: "uncertain" | "correct" = "uncertain";
  let n = 0;
  let verifiedOnServer = false;
  let verifiedSpec: string | null = null; // verification is bound to the specification identity (incl. run)
  const calls: string[] = [];
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
    verifiedOnServer = true; // the mocked backend now reports this step as verified
    const inspection = { ...workflow(stepId, a.spec(stepId), ++n, "correct"), state: "verified" };
    return r.fulfill({ json: { verification_id: `ver-${n}`, previous_inspection_id: previous, status: "verified", inspection, issue_assessments: [] } });
  });
  // Server progress stays authoritative: only the last step, only after its verification,
  // and — like the real backend — only for the specification identity it was verified in
  // (a new assembly run changes that identity, so the old verification no longer applies).
  await page.route(`**/api/projects/${a.project.id}/progress`, async (r) => {
    const real = await (await r.fetch()).json();
    return r.fulfill({ json: real.map((row: { step_id: string; status: string; specification_id: string }) => {
      if (row.step_id !== s2.id || !verifiedOnServer) return row;
      verifiedSpec ??= row.specification_id;
      return row.specification_id === verifiedSpec ? { ...row, status: "verified", verified_at: new Date().toISOString() } : row;
    }) });
  });

  await page.goto(`/ar?project=${a.project.id}`);
  await expect(card(page)).toContainText("Step 2 of 2");
  await expect(state(page)).toHaveText("Ready");
  await expect(card(page).getByRole("button", { name: "Finish" })).toHaveCount(0);

  // Uncertain on the last step: Check Again + Confirm Position, never Finish; nothing is sent automatically.
  await card(page).getByRole("button", { name: "Check Step", exact: true }).click();
  await expect(state(page)).toHaveText("Position uncertain", { timeout: 20000 });
  await expect(card(page).getByRole("button", { name: "Finish" })).toHaveCount(0);
  await page.waitForTimeout(3000);
  expect(calls).toEqual(["inspect:uncertain"]);

  next = "correct";
  await card(page).getByRole("button", { name: "Check Again" }).click();
  await expect(state(page)).toHaveText("Final step correct", { timeout: 30000 });
  expect(calls).toEqual(["inspect:uncertain", "inspect:correct", "verify"]);
  await expect(card(page).getByRole("button", { name: "Next Step" })).toHaveCount(0);
  await card(page).getByRole("button", { name: "Finish" }).click();
  await expect(state(page)).toHaveText("Assembly complete", { timeout: 15000 });
  await expect(card(page)).toContainText("Step 2 of 2", { timeout: 1000 });
  await expect(card(page).getByRole("button", { name: "Finish" })).toHaveCount(0);
  // Finish moved nothing and wrote nothing: still the last step, step 1 untouched on the real backend.
  const real = await (await request.get(`${E2E_API}/api/projects/${a.project.id}/progress`)).json();
  expect(real.find((p: { step_id: string }) => p.step_id === s1.id).status).not.toBe("verified");
  expect((await (await request.get(`${E2E_API}/api/projects/${a.project.id}/ar-view`)).json()).step_id).toBe(s2.id);

  // Completion view offers Restart Assembly as the primary follow-up (no hidden command needed).
  expect(calls).toEqual(["inspect:uncertain", "inspect:correct", "verify"]); // Finish adds no inference.
  const before = {
    steps: await (await request.get(`${E2E_API}/api/projects/${a.project.id}/steps`)).json(),
    placements: await Promise.all(a.steps.map(async (s: { id: string }) =>
      (await request.get(`${E2E_API}/api/projects/${a.project.id}/steps/${s.id}/ar-placement`)).json())),
    // Only this project's block: other specs create blocks in parallel.
    block: (await (await request.get(`${E2E_API}/api/blocks`)).json()).find((x: { id: string }) => x.id === a.block.id),
  };
  const result = page.getByRole("region", { name: "Latest Meta inspection result" });
  await page.getByText("Full instructions, reference & inspection results", { exact: true }).click();
  await expect(result).toContainText("Step Verified");
  const restart = card(page).getByRole("button", { name: "Restart Assembly" });
  await expect(restart).toBeVisible();
  const runBefore = await (await request.get(`${E2E_API}/api/projects/${a.project.id}/assembly-run`)).json();
  await restart.click();
  // A NEW run on Step 1 (nothing skipped): "New assembly started · Step 1 of 2 · No steps verified" …
  await expect(card(page)).toContainText("Step 1 of 2", { timeout: 15000 });
  await expect(state(page)).toHaveText("New assembly started", { timeout: 15000 });
  await expect(card(page)).toContainText("Step 1 of 2 · No steps verified");
  const runAfter = await (await request.get(`${E2E_API}/api/projects/${a.project.id}/assembly-run`)).json();
  expect(runAfter.number).toBe(runBefore.number + 1);
  expect(runAfter.run_id).not.toBe(runBefore.run_id);
  // … then the normal Step-1 guidance. Every step is unverified in the new run.
  await expect(state(page)).toHaveText("Ready", { timeout: 15000 });
  await expect(page.getByText("Manually viewed / not verified")).toBeVisible();
  await expect(card(page).getByRole("button", { name: "Check Step", exact: true })).toBeVisible();
  await expect(card(page).getByRole("button", { name: "Restart Assembly" })).toHaveCount(0);
  await expect(card(page).getByRole("button", { name: "Finish" })).toHaveCount(0);
  await expect(result).toHaveCount(0);
  await expect(page.getByRole("status", { name: "AR panel capture preview" })).toHaveCount(0);
  // No automatic camera/Meta request after Restart.
  await page.waitForTimeout(4000);
  expect(calls).toEqual(["inspect:uncertain", "inspect:correct", "verify"]);
  expect((await (await request.get(`${E2E_API}/api/projects/${a.project.id}/ar-view`)).json()).step_id).toBe(s1.id);
  // Project, steps/instructions, blocks and AR placements are preserved exactly.
  expect(await (await request.get(`${E2E_API}/api/projects/${a.project.id}/steps`)).json()).toEqual(before.steps);
  expect(before.block).toBeTruthy();
  expect((await (await request.get(`${E2E_API}/api/blocks`)).json()).find((x: { id: string }) => x.id === a.block.id)).toEqual(before.block);
  for (const [i, s] of a.steps.entries())
    expect(await (await request.get(`${E2E_API}/api/projects/${a.project.id}/steps/${s.id}/ar-placement`)).json()).toEqual(before.placements[i]);
  // The last step, verified in the OLD run, is not verified in the new one (as seen by the page).
  expect(verifiedOnServer).toBe(true);
  const seen = await page.evaluate(async (url) => (await fetch(url)).json(), `${E2E_API}/api/projects/${a.project.id}/progress`);
  expect(seen.map((p: { status: string }) => p.status)).toEqual(["not_started", "not_started"]);
  const realNow = await (await request.get(`${E2E_API}/api/projects/${a.project.id}/progress`)).json();
  expect(realNow.every((p: { status: string }) => p.status !== "verified")).toBe(true);
  // A new run works normally: Check Step on Step 1 sends exactly one new inspection.
  next = "correct";
  await card(page).getByRole("button", { name: "Check Step", exact: true }).click();
  await expect.poll(() => calls.length, { timeout: 20000 }).toBeGreaterThanOrEqual(4);
  expect(calls[3]).toBe("inspect:correct");
  // The page keeps polling progress: a poll still inside the route handler at teardown
  // would read a disposed response. Remove the handlers, ignoring such in-flight polls.
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

/** A still camera (no change): Autonomous never has a physical reason to inspect. */
async function stillCamera(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "xr", { value: undefined, configurable: true });
    const canvas = document.createElement("canvas");
    canvas.width = 320; canvas.height = 240;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#2a6"; ctx.fillRect(0, 0, 320, 240);
    ctx.fillStyle = "#d22"; ctx.fillRect(120, 90, 64, 32);
    const stream = canvas.captureStream(10);
    const w = window as unknown as { __captures: number };
    w.__captures = 0;
    const real = navigator.mediaDevices;
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
      getUserMedia: async (c: MediaStreamConstraints) => { if (c?.video) { w.__captures++; return stream; } return real.getUserMedia(c); },
      enumerateDevices: () => real.enumerateDevices(),
      addEventListener: (...x: unknown[]) => (real.addEventListener as (...a: unknown[]) => void)(...x),
      removeEventListener: (...x: unknown[]) => (real.removeEventListener as (...a: unknown[]) => void)(...x),
    } });
  });
}

test("Autonomous on: manual Check Step → correct → UNCERTAIN verification → 30 s without photo or Meta request; Check Again sends exactly one", async ({ page, request }) => {
  test.setTimeout(150000);
  const a = await demo(request);
  await stillCamera(page);
  const calls: string[] = [];
  const stamps: number[] = [];
  let gate: Promise<void> | null = null;
  let n = 0;
  let inspectAnswer: "correct" | "uncertain" = "correct";
  await page.route("**/api/inspect", async (r) => {
    const stepId = String(r.request().postDataBuffer()?.toString("latin1").match(/name="step_id"\r\n\r\n([^\r]+)/)?.[1]);
    calls.push(`inspect:${inspectAnswer}`);
    stamps.push(Date.now());
    if (gate) await gate;
    return r.fulfill({ json: workflow(stepId, a.spec(stepId), ++n, inspectAnswer) });
  });
  await page.route("**/api/verify", async (r) => {
    const body = r.request().postDataBuffer()?.toString("latin1") ?? "";
    const stepId = String(body.match(/name="step_id"\r\n\r\n([^\r]+)/)?.[1]);
    const previous = String(body.match(/name="previous_inspection_id"\r\n\r\n([^\r]+)/)?.[1]);
    calls.push("verify:uncertain");
    stamps.push(Date.now());
    const inspection = workflow(stepId, a.spec(stepId), ++n, "uncertain");
    return r.fulfill({ json: { verification_id: `ver-${n}`, previous_inspection_id: previous, status: "uncertain", inspection, issue_assessments: [] } });
  });
  await page.goto(`/ar?project=${a.project.id}`);
  await expect(card(page)).toContainText("Step 1 of 2");
  await page.getByText("Automatic camera checks · Off", { exact: true }).click(); // collapsed by default
  await page.getByRole("button", { name: "Start Autonomous Assembly" }).click();
  const auto = page.getByRole("status", { name: "Autonomous assembly state" });
  await expect(auto).toContainText("Watching", { timeout: 20000 });
  expect(calls).toEqual([]);
  // Manual Check Step: inspection correct, then its separate verification frame → uncertain.
  await card(page).getByRole("button", { name: "Check Step", exact: true }).click();
  await expect.poll(() => calls, { timeout: 30000 }).toEqual(["inspect:correct", "verify:uncertain"]);
  await expect(state(page)).toHaveText("Position uncertain", { timeout: 20000 });
  const captures = await page.evaluate(() => (window as unknown as { __captures: number }).__captures);
  // Wait well past verifyDelayMs, the cooldown and any former retry timer.
  await page.waitForTimeout(30_000);
  expect(calls, "no automatic Meta request after uncertain").toEqual(["inspect:correct", "verify:uncertain"]);
  expect(await page.evaluate(() => (window as unknown as { __captures: number }).__captures), "no new camera capture").toBe(captures);
  await expect(state(page)).toHaveText("Position uncertain");
  // Check Again pressed twice quickly while Meta is still answering: exactly ONE new inspection.
  inspectAnswer = "uncertain";
  let release!: () => void;
  gate = new Promise<void>((resolve) => { release = resolve; });
  const again = card(page).getByRole("button", { name: "Check Again" });
  await again.click();
  await expect.poll(() => calls.length, { timeout: 20000 }).toBe(3);
  await expect(state(page)).toHaveText("Inspecting by Meta…");
  await expect(again, "no second Check Again while one runs").toHaveCount(0);
  await again.click({ timeout: 500 }).catch(() => { /* not clickable while checking — as intended */ });
  release();
  gate = null;
  await expect(state(page)).toHaveText("Position uncertain", { timeout: 20000 });
  expect(calls).toEqual(["inspect:correct", "verify:uncertain", "inspect:uncertain"]);
  await page.waitForTimeout(8000);
  expect(calls.length, `again a hold: nothing automatic after the new uncertain — ${JSON.stringify(calls)} at +${stamps.map((t) => t - stamps[0])} ms; auto: ${await page.getByRole("status", { name: "Autonomous assembly state" }).textContent()}`).toBe(3);
  await page.getByRole("button", { name: "Stop Autonomous Assembly" }).click();
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("multi-device: a new run started on device A resets device B to Step 1 with no step verified (nothing automatic)", async ({ browser, request }) => {
  test.setTimeout(90000);
  const a = await demo(request);
  const [, s2] = a.steps;
  const view = await (await request.get(`${E2E_API}/api/projects/${a.project.id}/ar-view`)).json();
  await request.put(`${E2E_API}/api/projects/${a.project.id}/ar-view`, { data: { step_id: s2.id, revision: view.revision } });
  const context = await browser.newContext();
  const deviceB = await context.newPage();
  await fakeCamera(deviceB);
  let requests = 0;
  deviceB.on("request", (r) => { if (/\/api\/(inspect|verify)$/.test(r.url())) requests++; });
  await deviceB.goto(`/ar?project=${a.project.id}`);
  await expect(card(deviceB)).toContainText("Step 2 of 2");
  // Device A restarts the assembly (same endpoint the Restart Assembly button uses).
  const run = await (await request.get(`${E2E_API}/api/projects/${a.project.id}/assembly-run`)).json();
  const started = await request.post(`${E2E_API}/api/projects/${a.project.id}/assembly-runs`, { data: { expected_run_id: run.run_id } });
  expect(started.status()).toBe(201);
  // Device B follows within its 3 s poll: new run, Step 1, nothing verified.
  await expect(card(deviceB)).toContainText("Step 1 of 2", { timeout: 15000 });
  await expect(state(deviceB)).toHaveText("New assembly started", { timeout: 10000 });
  await expect(card(deviceB)).toContainText("No steps verified");
  // A second (stale) restart from device B's old knowledge is refused, never stacks a run.
  const stale = await request.post(`${E2E_API}/api/projects/${a.project.id}/assembly-runs`, { data: { expected_run_id: run.run_id } });
  expect(stale.status()).toBe(409);
  await deviceB.waitForTimeout(4000);
  expect(requests, "no automatic photo/Meta request on device B").toBe(0);
  await context.close();
});
