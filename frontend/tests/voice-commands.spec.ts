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
const TINY_JPEG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAwAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDxyiiiv3E8wKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/9k=", "base64");

// Mocked Whisper: the route returns queued transcripts; everything else is real.
// Mirrors backend voice_commands.py: next/previous/verify/verify-again were removed
// on purpose (HoloLens uses buttons), so the mocked backend never matches them.
const PHRASES: Record<string, string> = {
  "back to instructions": "back-to-instructions", "zurück zur anleitung": "back-to-instructions",
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
      state = "running";
      destination = {};
      async resume() { this.state = "running"; }
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      createScriptProcessor() {
        // Continuous mic: cycles speech-like loud chunks then silence so the
        // persistent capture's VAD emits repeated utterances (one stream).
        const proc: Record<string, unknown> = { connect() {} };
        let calls = 0;
        let timer: ReturnType<typeof setInterval> | undefined;
        proc.disconnect = () => { if (timer) clearInterval(timer); };
        Object.defineProperty(proc, "onaudioprocess", {
          set(fn: (e: unknown) => void) {
            timer = setInterval(() => {
              calls++;
              const loud = calls % 15 < 5;
              fn({ inputBuffer: { getChannelData: () => new Float32Array(4096).fill(loud ? 0.5 : 0) } });
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

test("voice cannot navigate or verify (buttons only); unknown/negated phrases are rejected; remaining commands still execute", async ({ page, request }) => {
  test.setTimeout(180000);
  const a = await project3(request);
  const { queue } = await mockVoice(page);
  let navigationWrites = 0, inspections = 0;
  page.on("request", (r) => {
    if (r.method() === "PUT" && r.url().endsWith("/ar-view")) navigationWrites++;
    if (r.method() === "POST" && r.url().endsWith("/api/inspect")) inspections++;
  });
  await page.goto(`/ar?project=${a.project.id}`);
  await expect(page.getByRole("heading", { name: "Step 1 — First" })).toBeVisible();
  await enableLocal(page);
  for (const phrase of ["next step", "go forward", "previous step", "go back", "verify step", "verify again"]) {
    queue.push(phrase);
    await expectDiag(page, phrase);
    await expectDiag(page, "Phrase not recognized");
  }
  await expect(page.getByRole("heading", { name: "Step 1 — First" })).toBeVisible();
  queue.push("please open the pod bay doors");
  await expectDiag(page, "please open the pod bay doors");
  queue.push("don't go to next step");
  await expectDiag(page, "don't go to next step");
  await expectDiag(page, "Phrase not recognized");
  queue.push("show instructions");
  await expectDiag(page, "SUCCESS");
  await expect(page.getByRole("heading", { name: "Step 1 — First" })).toBeVisible();
  expect(navigationWrites).toBe(0);
  expect(inspections).toBe(0);
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

test("Check is a button (voice 'verify step' does nothing); the button submits one inspection and failure shows the visible fallback; Exit AR cleans up microphone", async ({ page, request }) => {
  test.setTimeout(180000);
  const a = await project3(request);
  const { queue } = await mockVoice(page);
  let inspections = 0;
  page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/api/inspect")) inspections++; });
  await page.goto(`/ar?project=${a.project.id}`);
  await enableLocal(page);
  queue.push("verify step");
  await expectDiag(page, "Phrase not recognized");
  expect(inspections).toBe(0);
  const card = page.getByRole("region", { name: "Guided assembly step" });
  await card.getByRole("button", { name: "Check", exact: true }).click();
  await expect.poll(() => inspections, { timeout: 30000 }).toBe(1);
  // The disposable test backend has no Meta key: an infrastructure failure, never a verdict.
  await expect(card.getByRole("status", { name: "Step status" })).toHaveText("Check unavailable", { timeout: 20000 });
  await expect(card.getByRole("button", { name: "Confirm position" })).toBeVisible();
  expect((await (await request.get(`${api}/api/projects/${a.project.id}/progress`)).json())
    .every((s: { status: string }) => s.status !== "verified")).toBe(true);
  // Back in AR, Exit AR through voice stops local listening and mic tracks.
  await page.goto(`/ar?project=${a.project.id}`);
  await enableLocal(page);
  queue.push("exit ar");
  await expect(page.getByRole("status", { name: "Local microphone state" })).toContainText("Off", { timeout: 15000 });
  expect(await page.evaluate(() => (window as unknown as { __micStops: number }).__micStops)).toBeGreaterThan(0);
});

test("continuous capture reports microphone health and keeps transcribing while processing", async ({ page, request }) => {
  test.setTimeout(60000);
  const a = await project3(request);
  const { queue } = await mockVoice(page);
  await page.goto(`/ar?project=${a.project.id}`);
  await expect(page.getByRole("heading", { name: "Step 1 — First" })).toBeVisible();
  await enableLocal(page);
  // In-XR diagnostic data (same fields rendered in the AR panel) must show a
  // genuinely active microphone, not a generic "Listening" claim.
  await expect(page.getByRole("status", { name: "Microphone capture diagnostics" }))
    .toContainText("Mic active", { timeout: 15000 });
  queue.push("show instructions", "help");
  await expect(page.getByText("Available voice commands")).toBeVisible({ timeout: 15000 });
  await expectDiag(page, "SUCCESS");
});

test("one-command mode uses the selected language and executes consecutive commands once each (no voice navigation)", async ({ page, request }) => {
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
  queue.push("Show instructions");
  await record.click();
  await expect(record).toBeDisabled();
  await expect(language).toBeDisabled();
  await expectDiag(page, "SUCCESS");
  await expect(record).toBeEnabled({ timeout: 15000 });
  await language.selectOption("de-DE");
  queue.push("Zurück zur Anleitung"); // Matcher/dispatch is tested here; real Whisper is a separate test.
  await record.click();
  await expectDiag(page, "back-to-instructions");
  await expectDiag(page, "SUCCESS");
  expect(languages).toEqual(["en", "de"]);
  expect(state.transcribes).toBe(2);
  expect(navigationWrites).toBe(0);
  await expect(page.getByRole("heading", { name: "Step 1 — First" })).toBeVisible();
});
