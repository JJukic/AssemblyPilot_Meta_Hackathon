import { test, expect, type Page } from "@playwright/test";

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

// All application requests are mocked: these tests never write to a developer's project.
async function workspace(page: Page, mode = "manual", api = "SpeechRecognition") {
  await page.route("**/health", r => r.fulfill({ json: { status: "ok" } }));
  await page.route("**/api/**", r => {
    const path = new URL(r.request().url()).pathname;
    const step = { id: "voice-step", title: "Voice fixture", description: "Test", position: 1, required_blocks: [], reference_images: [] };
    const json = path.endsWith("/ar-view") ? { step_id: step.id, revision: 1 }
      : path.endsWith("/progress") ? []
      : path.endsWith("/ar-placement") ? null
      : path === "/api/projects/voice-project" ? { id: "voice-project", name: "Voice fixture", steps: [step] }
      : [];
    return r.fulfill({ json });
  });
  await page.addInitScript(({ mode, api }) => {
    Object.defineProperty(navigator, "xr", { value: undefined, configurable: true });
    const w = window as unknown as Record<string, unknown>;
    w.__voice = { starts: 0, aborts: 0, micCalls: 0, stopped: 0 };
    const stats = w.__voice as Record<string, number>;
    class FakeRecognition {
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((e: { error: string }) => void) | null = null;
      start() {
        stats.starts++; w.__rec = this;
        if (mode !== "manual" && mode !== "unsupported") {
          const end = this.onend;
          if (mode !== "end-only") this.onerror?.({ error: mode });
          end?.(); // Deliberately replay an already-queued end after error/abort.
        }
      }
      stop() { /* controlled by each test */ }
      abort() { stats.aborts++; }
    }
    Object.defineProperty(window, "SpeechRecognition", { value: undefined, configurable: true });
    Object.defineProperty(window, "webkitSpeechRecognition", { value: undefined, configurable: true });
    if (mode !== "unsupported") Object.defineProperty(window, api, { value: FakeRecognition, configurable: true });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async (constraints: MediaStreamConstraints) => {
        stats.micCalls++;
        w.__constraints = constraints;
        const track = { readyState: "live", stop() { stats.stopped++; } };
        return { getAudioTracks: () => [track], getTracks: () => [track] };
      } },
    });
  }, { mode, api });
  await page.goto("/ar?project=voice-project");
  await expect(page.getByRole("heading", { name: "Step 1 — Voice fixture" })).toBeVisible();
}

async function enable(page: Page) {
  await page.getByRole("checkbox", { name: /I understand and consent/ }).check();
  await page.getByRole("button", { name: "Enable voice control" }).click();
}
async function event(page: Page, name: "onstart" | "onend") {
  await page.evaluate(name => {
    const rec = (window as unknown as { __rec: Record<string, (() => void) | null> }).__rec;
    rec[name]?.();
  }, name);
}

test("actual start/end events drive Starting, Listening, Stopping, Off", async ({ page }) => {
  await workspace(page, "manual", "webkitSpeechRecognition");
  await expect(page.getByText("webkitSpeechRecognition", { exact: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "Voice state" })).toHaveText("Voice: Off");
  await enable(page);
  await expect(page.getByRole("status", { name: "Voice state" })).toHaveText("Voice: Starting");
  await event(page, "onstart");
  await expect(page.getByRole("status", { name: "Voice state" })).toHaveText("Voice: Listening");
  await page.getByRole("button", { name: "Stop listening", exact: true }).click();
  await expect(page.getByRole("status", { name: "Voice state" })).toHaveText("Voice: Stopping");
  await event(page, "onend");
  await expect(page.getByRole("status", { name: "Voice state" })).toHaveText("Voice: Off");
});

for (const error of ["not-allowed", "service-not-allowed", "audio-capture", "network", "language-not-supported", "end-only"]) {
  test(`immediate ${error} remains visible after end and microphone test`, async ({ page }) => {
    await workspace(page, error);
    await enable(page);
    await expect(page.getByRole("status", { name: "Voice state" })).toHaveText("Voice: Error");
    const code = error === "end-only" ? "ended-before-start" : error;
    const diagnostic = page.getByRole("group", { name: "Hands-free voice control" }).getByRole("alert");
    await expect(diagnostic).toContainText(code);
    await page.getByRole("button", { name: "Test microphone access" }).click();
    await expect(page.getByRole("status", { name: "Microphone test result" })).toContainText("Microphone access passed");
    await expect(diagnostic).toContainText(code);
    await expect(page.getByRole("status", { name: "Voice state" })).toHaveText("Voice: Error");
    expect(await page.evaluate(() => (window as unknown as { __voice: unknown }).__voice)).toMatchObject({ starts: 1, micCalls: 1, stopped: 1 });
  });
}

test("unsupported recognition still offers an explicit audio-only microphone test", async ({ page }) => {
  await workspace(page, "unsupported");
  await expect(page.getByRole("status", { name: "Voice state" })).toHaveText("Voice: Unsupported");
  await expect(page.getByRole("button", { name: "Enable voice control" })).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as { __voice: { micCalls: number } }).__voice.micCalls)).toBe(0);
  await page.getByRole("button", { name: "Test microphone access" }).click();
  await expect(page.getByRole("status", { name: "Microphone test result" })).toContainText("does not prove speech recognition service availability");
  expect(await page.evaluate(() => (window as unknown as { __constraints: unknown }).__constraints)).toEqual({ audio: true });
});

test("revoking consent releases recognition immediately", async ({ page }) => {
  await workspace(page); await enable(page); await event(page, "onstart");
  await page.getByRole("checkbox", { name: /I understand and consent/ }).uncheck();
  await expect(page.getByRole("status", { name: "Voice state" })).toHaveText("Voice: Off");
  expect(await page.evaluate(() => (window as unknown as { __voice: { aborts: number } }).__voice.aborts)).toBe(1);
});
