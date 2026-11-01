import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
const api = "http://127.0.0.1:8000";
const TINY_JPEG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAwAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDxyiiiv3E8wKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/9k=", "base64");

// Mocked Whisper: the route returns queued transcripts; everything else is real.
const PHRASES: Record<string, string> = {
  "next step": "next", "next steps": "next", "go forward": "next",
  "previous step": "previous", "previous steps": "previous", "go back": "previous",
  "verify step": "verify", "verify again": "verify-again",
  "show reference": "show-reference", "hide reference": "hide-reference",
  "show instructions": "show-instructions", "read instructions": "read-instructions",
  "re-anchor": "re-anchor", "recenter": "recenter", "help": "help",
  "stop listening": "stop-listening", "exit ar": "exit",
};
function match(raw: string) {
  const n = raw.toLowerCase().replace(/[.!?;:,"]/g, "").replace(/\s+/g, " ").trim();
  if (!n || n.includes("don't") || n.startsWith("do not") || n.includes(" and ")) return null;
  const action = PHRASES[n];
  return action ? { action, phrase: n } : null;
}

async function project3(request: APIRequestContext, withRefs = false) {
  const block = await (await request.post(`${api}/api/blocks`, { data: { name: "Cmd block", color: "blue" } })).json();
  const project = await (await request.post(`${api}/api/projects`, { data: { name: "Command audit" } })).json();
  const steps = [];
  for (const title of ["First", "Second", "Third"]) {
    const step = await (await request.post(`${api}/api/projects/${project.id}/steps`, {
      data: { title, instruction: `Instruction for ${title}.`, required_blocks: [{ block_id: block.id, required_quantity: 1 }] },
    })).json();
    steps.push(step);
    if (withRefs) {
      await request.post(`${api}/api/projects/${project.id}/steps/${step.id}/images`, {
        multipart: { image: { name: `${title}.jpg`, mimeType: "image/jpeg", buffer: TINY_JPEG } },
      });
    }
  }
  return { project, steps };
}

async function mockVoice(page: Page) {
  const queue: string[] = [];
  const state = { transcribes: 0 };
  await page.route("**/api/voice/status", (r) => r.fulfill({ json: { available: true, engine: "whisper.cpp", model: "fake", reason: "ready" } }));
  await page.route("**/api/voice/session", (r) =>
    r.request().method() === "DELETE" ? r.fulfill({ status: 204 }) : r.fulfill({ json: { token: "test-token", expires_in: 600 } }));
  await page.route("**/api/voice/transcribe", (r) => {
    state.transcribes++;
    const transcript = queue.shift() ?? "";
    const m = match(transcript);
    return r.fulfill({ json: { matched: !!m, action: m?.action ?? null, phrase: m?.phrase ?? null, language: "en", transcript, duration_seconds: 1 } });
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "xr", { value: undefined, configurable: true });
    const w = window as unknown as Record<string, unknown>;
    w.__micStops = 0;
    const track = { readyState: "live", stop() { (w.__micStops as number)++; } };
    const realMedia = navigator.mediaDevices;
    const realGetUserMedia = realMedia.getUserMedia.bind(realMedia);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
      // Audio: fake microphone for voice. Video: real (fake-device) camera.
      getUserMedia: async (constraints: MediaStreamConstraints) =>
        constraints?.video ? realGetUserMedia(constraints) : { getTracks: () => [track], getAudioTracks: () => [track] },
      enumerateDevices: () => realMedia.enumerateDevices(),
      addEventListener: (...args: unknown[]) => (realMedia.addEventListener as (...a: unknown[]) => void)(...args),
      removeEventListener: (...args: unknown[]) => (realMedia.removeEventListener as (...a: unknown[]) => void)(...args),
    } });
    class FakeAudioContext {
      sampleRate = 48000;
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      createScriptProcessor() {
        const proc: Record<string, unknown> = { connect() {}, disconnect() {} };
        let calls = 0;
        Object.defineProperty(proc, "onaudioprocess", {
          set(fn: (e: unknown) => void) {
            const timer = setInterval(() => {
              calls++;
              const loud = calls <= 5;
              fn({ inputBuffer: { getChannelData: () => new Float32Array(4096).fill(loud ? 0.5 : 0) } });
              if (calls > 30) clearInterval(timer as unknown as number);
            }, 10);
            proc.__timer = timer;
          },
        });
        return proc;
      }
      close() { return Promise.resolve(); }
    }
    (w as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { cancel() {}, speak(u: { text: string }) { w.__spoken = u.text; } } });
  });
  return { queue, state };
}

async function enableLocal(page: Page) {
  await page.getByRole("checkbox", { name: /I agree to local voice/ }).check();
  await page.getByRole("button", { name: "Enable local voice control" }).click();
  await expect(page.getByRole("status", { name: "Local microphone state" })).toContainText("Listening");
}
const diag = (page: Page) => page.getByRole("region", { name: "Voice command diagnostics" });
async function expectDiag(page: Page, text: string) {
  await expect(diag(page)).toContainText(text, { timeout: 15000 });
}

test("voice navigation executes, respects boundaries, rejects unknown/negated, suppresses duplicates", async ({ page, request }) => {
  test.setTimeout(180000);
  const a = await project3(request);
  const { queue } = await mockVoice(page);
  await page.goto(`/ar?project=${a.project.id}`);
  await expect(page.getByRole("heading", { name: "Step 1 — First" })).toBeVisible();
  await enableLocal(page);
  queue.push("next step");
  await expect(page.getByRole("heading", { name: "Step 2 — Second" })).toBeVisible({ timeout: 15000 });
  await expectDiag(page, "SUCCESS");
  await expectDiag(page, "Step 1 → 2");
  // Consecutive legitimate Previous commands (with an intervening Next).
  queue.push("previous step");
  await expect(page.getByRole("heading", { name: "Step 1 — First" })).toBeVisible({ timeout: 15000 });
  await expectDiag(page, "Step 2 → 1");
  queue.push("previous step");
  await expectDiag(page, "Already at first step");
  await expect(page.getByRole("heading", { name: "Step 1 — First" })).toBeVisible();
  queue.push("next steps");
  await expect(page.getByRole("heading", { name: "Step 2 — Second" })).toBeVisible({ timeout: 15000 });
  queue.push("go back");
  await expect(page.getByRole("heading", { name: "Step 1 — First" })).toBeVisible({ timeout: 15000 });
  // Consecutive legitimate commands in separate clips both execute.
  queue.push("go forward", "go forward");
  await expect(page.getByRole("heading", { name: "Step 3 — Third" })).toBeVisible({ timeout: 15000 });
  await expectDiag(page, "Step 2 → 3");
  expect((await (await request.get(`${api}/api/projects/${a.project.id}/ar-view`)).json()).step_id).toBe(a.steps[2].id);
  queue.push("next step");
  await expectDiag(page, "Already at last step");
  await expect(page.getByRole("heading", { name: "Step 3 — Third" })).toBeVisible();
  queue.push("previous step");
  await expect(page.getByRole("heading", { name: "Step 2 — Second" })).toBeVisible({ timeout: 15000 });
  queue.push("please open the pod bay doors");
  await expectDiag(page, "Phrase not recognized");
  await expect(page.getByRole("heading", { name: "Step 2 — Second" })).toBeVisible();
  queue.push("don't go to next step");
  await expectDiag(page, "Phrase not recognized");
  await expect(page.getByRole("heading", { name: "Step 2 — Second" })).toBeVisible();
  expect((await (await request.get(`${api}/api/projects/${a.project.id}/progress`)).json())
    .every((s: { status: string }) => s.status !== "verified")).toBe(true);
});

test("panel commands execute visibly; re-anchor without AR and stop listening are explicit", async ({ page, request }) => {
  test.setTimeout(180000);
  const a = await project3(request, true);
  const { queue, state } = await mockVoice(page);
  await page.goto(`/ar?project=${a.project.id}`);
  await expect(page.locator("img.ar-reference")).toBeVisible({ timeout: 10000 });
  await enableLocal(page);
  queue.push("hide reference");
  await expect(page.getByText(/Reference hidden/)).toBeVisible({ timeout: 15000 });
  await expectDiag(page, "SUCCESS");
  queue.push("show reference");
  await expect(page.locator("img.ar-reference")).toBeVisible({ timeout: 15000 });
  queue.push("show instructions");
  await expectDiag(page, "SUCCESS");
  await expect(page.locator("#ar-full-instruction")).toContainText("Instruction for First");
  await page.getByRole("checkbox", { name: /Read instructions aloud/ }).check();
  queue.push("read instructions");
  await expectDiag(page, "SUCCESS");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __spoken?: string }).__spoken ?? ""), { timeout: 15000 }).toContain("Instruction for First");
  queue.push("help");
  await expect(page.getByText("Available voice commands")).toBeVisible({ timeout: 15000 });
  queue.push("re-anchor");
  await expectDiag(page, "No active AR session");
  queue.push("stop listening");
  await expect(page.getByRole("status", { name: "Local microphone state" })).toContainText("Off", { timeout: 15000 });
  const before = state.transcribes;
  queue.push("next step");
  await page.waitForTimeout(2500);
  expect(state.transcribes).toBe(before);
  await expect(page.getByRole("heading", { name: "Step 1 — First" })).toBeVisible();
});

test("voice Verify Step auto-captures one fresh frame and submits one inspection; Exit AR cleans up microphone", async ({ page, request }) => {
  test.setTimeout(180000);
  const a = await project3(request);
  const { queue } = await mockVoice(page);
  let inspections = 0;
  page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/api/inspect")) inspections++; });
  await page.goto(`/ar?project=${a.project.id}`);
  await enableLocal(page);
  queue.push("verify step");
  await expect(page.getByRole("heading", { name: "First", exact: true })).toBeVisible({ timeout: 20000 });
  await expect.poll(() => inspections, { timeout: 20000 }).toBe(1);
  await expect(page.getByRole("region", { name: "Meta AI inspection" }).getByRole("alert"))
    .toContainText("MODEL_API_KEY", { timeout: 20000 });
  expect((await (await request.get(`${api}/api/projects/${a.project.id}/progress`)).json())
    .every((s: { status: string }) => s.status !== "verified")).toBe(true);
  // Back in AR, Exit AR through voice stops local listening and mic tracks.
  await page.goto(`/ar?project=${a.project.id}`);
  await enableLocal(page);
  queue.push("exit ar");
  await expect(page.getByRole("status", { name: "Local microphone state" })).toContainText("Off", { timeout: 15000 });
  expect(await page.evaluate(() => (window as unknown as { __micStops: number }).__micStops)).toBeGreaterThan(0);
});

test("one-command mode uses the selected language and executes consecutive Next commands once each", async ({ page, request }) => {
  test.setTimeout(45000);
  const a = await project3(request);
  const { queue, state } = await mockVoice(page);
  const languages: string[] = [];
  let navigationWrites = 0;
  page.on("request", r => {
    if (r.method() === "PUT" && r.url().endsWith("/ar-view")) navigationWrites++;
    if (r.url().endsWith("/voice/transcribe")) {
      languages.push(r.postDataBuffer()?.toString().match(/name="language"\r\n\r\n([^\r]+)/)?.[1] ?? "missing");
    }
  });
  await page.goto(`/ar?project=${a.project.id}`);
  await expect(page.getByRole("heading", { name: "Step 1 — First" })).toBeVisible();
  await page.getByRole("checkbox", { name: /I agree to local voice/ }).check();
  const language = page.getByRole("combobox", { name: "Voice language" });
  const record = page.getByRole("button", { name: /Record one command/ });
  queue.push("Next step");
  await record.click();
  await expect(record).toBeDisabled();
  await expect(language).toBeDisabled();
  await expect(page.getByRole("heading", { name: "Step 2 — Second" })).toBeVisible({ timeout: 15000 });
  await expect(record).toBeEnabled();
  await language.selectOption("de-DE");
  queue.push("Next step"); // Matcher/dispatch is tested here; real Whisper is a separate test.
  await record.click();
  await expect(page.getByRole("heading", { name: "Step 3 — Third" })).toBeVisible({ timeout: 15000 });
  await expectDiag(page, "SUCCESS");
  expect(languages).toEqual(["en", "de"]);
  expect(state.transcribes).toBe(2);
  expect(navigationWrites).toBe(2);
});
