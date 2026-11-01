import { expect, test, type APIRequestContext } from "@playwright/test";
const api = "http://127.0.0.1:8000";

async function assembly(request: APIRequestContext) {
  const block = await (
    await request.post(`${api}/api/blocks`, { data: { name: "Voice block", color: "blue" } })
  ).json();
  const project = await (
    await request.post(`${api}/api/projects`, { data: { name: "Voice verify assembly" } })
  ).json();
  const step = await (
    await request.post(`${api}/api/projects/${project.id}/steps`, {
      data: {
        title: "Voice step",
        instruction: "Place the blue block.",
        required_blocks: [{ block_id: block.id, required_quantity: 1 }],
      },
    })
  ).json();
  return { project, step };
}

test("voice Verify Step intent auto-captures a fresh camera frame and submits exactly one inspection", async ({ page, request }) => {
  const a = await assembly(request);
  await page.addInitScript(
    ({ projectId, stepId }) => {
      sessionStorage.setItem(
        "assemblypilot.voice-verify",
        JSON.stringify({ mode: "inspect", projectId, stepId, requestedAt: new Date().toISOString() }),
      );
    },
    { projectId: a.project.id, stepId: a.step.id },
  );
  await page.route("**/api/inspect", (route) => route.continue());
  const inspection = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/api/inspect"),
    { timeout: 20000 },
  );
  await page.goto(`/?project=${a.project.id}&step=${a.step.id}`);
  await expect(page.getByRole("heading", { name: "Voice step", exact: true })).toBeVisible();
  // No button was clicked: the intent alone must drive camera + capture + inspect.
  const sent = await inspection;
  expect(sent.postDataBuffer()!.toString()).toContain(a.step.id);
  // Real backend without Meta credentials must surface its honest error.
  await expect(
    page.getByRole("region", { name: "Meta AI inspection" }).getByRole("alert"),
  ).toContainText("MODEL_API_KEY", { timeout: 20000 });
  expect((await (await request.get(`${api}/api/projects/${a.project.id}/progress`)).json())
    .every((s: { status: string }) => s.status !== "verified")).toBe(true);
});

test("AR page reports local Whisper availability honestly (no engine in CI)", async ({ page, request }) => {
  const a = await assembly(request);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "xr", { value: undefined, configurable: true }),
  );
  await page.goto(`/ar?project=${a.project.id}`);
  await expect(page.getByRole("heading", { name: "Step 1 — Voice step" })).toBeVisible();
  await expect(page.getByText(/Local Whisper (ready|unavailable)/)).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("button", { name: "Enable local voice control" })).toBeDisabled();
  await page.getByRole("checkbox", { name: /local voice transcription/ }).check();
  await expect(page.getByRole("button", { name: "Enable local voice control" })).toBeEnabled();
});
