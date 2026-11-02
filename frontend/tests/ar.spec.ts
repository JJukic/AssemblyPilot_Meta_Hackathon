import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

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
async function assembly(request: APIRequestContext) {
  const blocks = [];
  for (const color of ["blue", "yellow"])
    blocks.push(
      await (
        await request.post(`${api}/api/blocks`, {
          data: { name: `AR ${color}`, color },
        })
      ).json(),
    );
  const project = await (
    await request.post(`${api}/api/projects`, {
      data: { name: "AR test assembly" },
    })
  ).json();
  const steps = [];
  for (const [i, block] of blocks.entries())
    steps.push(
      await (
        await request.post(`${api}/api/projects/${project.id}/steps`, {
          data: {
            title: i ? "Yellow on blue" : "Blue base",
            instruction: i
              ? "Place yellow on the blue block."
              : "Place blue on the table.",
            required_blocks: [{ block_id: block.id, required_quantity: 1 }],
          },
        })
      ).json(),
    );
  return { project, steps, blocks, base: `${api}/api/projects/${project.id}` };
}
async function noXR(page: Page) {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "xr", {
      value: undefined,
      configurable: true,
    }),
  );
}

test("unsupported device has honest responsive 2D fallback and no fabricated model", async ({
  page,
  request,
}) => {
  const a = await assembly(request);
  await noXR(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/ar?project=${a.project.id}`);
  await expect(page.getByText(/browser exposes no WebXR/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Enter immersive AR" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("img", { name: "2D intended placement" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Use 10 cm alignment box (approximate)" })
    .click();
  await expect(
    page.getByRole("img", { name: "2D intended placement" }),
  ).toBeVisible();
  await expect(
    page.getByText(/approximate · 100 × 100 × 100 mm/),
  ).toBeVisible();
  expect(
    await (
      await request.get(`${a.base}/steps/${a.steps[0].id}/ar-placement`)
    ).json(),
  ).toBeNull();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/ar-preview-${width}.png`,
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});

for (const fault of ["insecure", "unsupported", "denied"] as const)
  test(`XR ${fault}: no successful session claimed`, async ({
    page,
    request,
  }) => {
    const a = await assembly(request);
    await page.addInitScript((fault) => {
      if (fault === "insecure")
        Object.defineProperty(window, "isSecureContext", { value: false });
      Object.defineProperty(navigator, "xr", {
        value: {
          isSessionSupported: async () => fault !== "unsupported",
          requestSession: async (mode: string, options: object) => {
            sessionStorage.setItem(
              "xr-request",
              JSON.stringify({
                mode,
                options,
                gesture: navigator.userActivation.isActive,
              }),
            );
            throw new Error("Device refused session");
          },
        },
        configurable: true,
      });
    }, fault);
    await page.goto(`/ar?project=${a.project.id}`);
    await expect(
      page.getByRole("heading", { name: "Step 1 — Blue base" }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => sessionStorage.getItem("xr-request")),
    ).toBeNull();
    const button = page.getByRole("button", { name: "Enter immersive AR" });
    if (fault === "denied") {
      await expect(button).toBeEnabled();
      await button.click();
      await expect(
        page
          .getByRole("region", { name: "Spatial assembly guidance" })
          .getByRole("alert"),
      ).toContainText("AR did not start");
      const call = JSON.parse(
        (await page.evaluate(() => sessionStorage.getItem("xr-request")))!,
      );
      expect(call.mode).toBe("immersive-ar");
      expect(call.gesture).toBe(true);
      expect(call.options.optionalFeatures).toContain("anchors");
      await expect(
        page.getByRole("button", { name: "Exit AR", exact: true }),
      ).toHaveCount(0);
    } else await expect(button).toBeDisabled();
  });

test("shared step navigation never verifies; direct camera launch selects that step", async ({
  page,
  request,
}) => {
  const a = await assembly(request);
  await noXR(page);
  await page.goto(`/ar?project=${a.project.id}`);
  await expect(
    page.getByRole("heading", { name: "Step 1 — Blue base" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Step 2 — Yellow on blue" }),
  ).toBeVisible();
  expect((await (await request.get(`${a.base}/ar-view`)).json()).step_id).toBe(
    a.steps[1].id,
  );
  expect(
    (await (await request.get(`${a.base}/progress`)).json()).every(
      (s: { status: string }) => s.status !== "verified",
    ),
  ).toBe(true);
  // Another headset changes its manually viewed step; the first viewer follows.
  await request.put(`${a.base}/ar-view`, {
    data: { step_id: a.steps[0].id, revision: 1 },
  });
  await expect(
    page.getByRole("heading", { name: "Step 1 — Blue base" }),
  ).toBeVisible({ timeout: 6000 });
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Step 2 — Yellow on blue" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Verify Step — camera workspace" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Yellow on blue", exact: true }),
  ).toBeVisible();
  // Voice/button Verify now auto-starts the HoloLens camera and may already
  // have submitted one auto inspection; capture a manual frame for this check.
  await expect(page.getByRole("button", { name: "Capture", exact: true })).toBeEnabled({ timeout: 10000 });
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  // Chromium exposes multipart file bodies to Playwright when interception is enabled.
  // Continue to the real disposable backend; do not replace the inspection response.
  await page.route("**/api/inspect", route => route.continue());
  const inspection = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/api/inspect"),
  );
  await page
    .getByRole("button", { name: "Inspect with Meta AI", exact: true })
    .click();
  expect((await inspection).postDataBuffer()!.toString()).toContain(
    a.steps[1].id,
  );
  await expect(
    page.getByRole("region", { name: "Meta AI inspection" }).getByRole("alert"),
  ).toContainText("MODEL_API_KEY");
});

test("author measured placement only after confirmation; edits and removal stay reversible", async ({
  page,
  request,
}) => {
  const a = await assembly(request);
  await page.goto(`/projects/${a.project.id}`);
  await page
    .getByRole("button", { name: "Edit step Blue base", exact: true })
    .click();
  await page
    .getByText("Spatial AR hologram (optional)", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Author placement with a 10 cm proxy" })
    .click();
  await page.getByLabel("Dimension evidence").selectOption("measured");
  await page.getByLabel("Length X (mm)").fill("32");
  await page.getByLabel("Body height Y (mm, excluding studs)").fill("9.6");
  await page.getByLabel("Depth Z (mm)").fill("16");
  await page.getByLabel("Position X (m)").fill("0.1");
  const save = page.getByRole("button", { name: "Save AR hologram" });
  await expect(save).toBeDisabled();
  await page
    .getByRole("checkbox", { name: "I confirm the dimensions" })
    .check();
  await save.click();
  await expect(page.getByText(/AR guidance saved/)).toBeVisible();
  const placement = await (
    await request.get(`${a.base}/steps/${a.steps[0].id}/ar-placement`)
  ).json();
  expect(placement.position_m[0]).toBe(0.1);
  expect(placement.dimensions.x_mm).toBe(32);
  await page.getByLabel("Rotation Y (degrees)").fill("90");
  await expect(save).toBeDisabled();
  await page.getByRole("button", { name: "Remove AR hologram" }).click();
  // The click does not wait for the DELETE round-trip: poll the final state.
  await expect
    .poll(async () => (await request.get(`${a.base}/steps/${a.steps[0].id}/ar-placement`)).json())
    .toBeNull();
});

test("old placement is hidden on navigation and disconnection; reconnect restores current data", async ({
  page,
  request,
}) => {
  const a = await assembly(request);
  await noXR(page);
  await request.put(`${a.base}/steps/${a.steps[0].id}/ar-placement`, {
    data: {
      target_block_id: a.blocks[0].id,
      instance: 1,
      evidence: "measured",
      confirmed: true,
      dimensions: { x_mm: 16, y_mm: 9.6, z_mm: 32 },
      position_m: [0, 0, 0],
      rotation_deg: [0, 0, 0],
    },
  });
  await page.goto(`/ar?project=${a.project.id}`);
  await expect(
    page.getByRole("img", { name: "2D intended placement" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Step 2 — Yellow on blue" }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "2D intended placement" }),
  ).toHaveCount(0);
  await page.route(`**/api/projects/${a.project.id}/ar-view`, (r) => r.abort());
  // Two consecutive failed 3-s polls mark the state unavailable (one Wi-Fi blip must not blank the hologram).
  await expect(page.getByText(/Project state unavailable/)).toBeVisible({
    timeout: 10000,
  });
  await expect(
    page.getByRole("button", { name: "Verify Step — camera workspace" }),
  ).toBeDisabled();
  await page.unroute(`**/api/projects/${a.project.id}/ar-view`);
  await expect(
    page.getByText("Connected to project state", { exact: true }),
  ).toBeVisible({ timeout: 6000 });
});

const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAwAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDxyiiiv3E8wKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/9k=",
  "base64",
);

test("phase6.1 selected step reference shown; navigation/verify are buttons only — voice cannot navigate or verify", async ({ page, request }) => {
  const a = await assembly(request);
  // Upload two step references and explicitly select the second one.
  const ids: string[] = [];
  for (const name of ["first.jpg", "second.jpg"]) {
    const res = await request.post(`${a.base}/steps/${a.steps[0].id}/images`, {
      multipart: { image: { name, mimeType: "image/jpeg", buffer: TINY_JPEG } },
    });
    expect(res.ok()).toBe(true);
    ids.push((await res.json()).id);
  }
  const sel = await request.put(`${a.base}/steps/${a.steps[0].id}/reference-image`, { data: { image_id: ids[1] } });
  expect(sel.ok()).toBe(true);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "xr", { value: undefined, configurable: true });
    class FakeRec {
      lang = ""; continuous = false; interimResults = false; maxAlternatives = 1;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      onstart: (() => void) | null = null;
      start() { (window as unknown as { __rec: unknown }).__rec = this; this.onstart?.(); }
      stop() {} abort() {}
    }
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRec;
  });
  await page.goto(`/ar?project=${a.project.id}`);
  await expect(page.getByRole("heading", { name: "Step 1 — Blue base" })).toBeVisible();
  const refImg = page.locator("img.ar-reference");
  await expect(refImg).toBeVisible();
  await expect(refImg).toHaveAttribute("src", new RegExp(ids[1]));
  // Enable voice (explicit consent) and drive finalized results only.
  await page.getByRole("checkbox", { name: /I understand and consent/ }).check();
  await page.getByRole("button", { name: "Enable voice control" }).click();
  const fire = (transcript: string, isFinal = true) =>
    page.evaluate(([t, fin]) => {
      const rec = (window as unknown as { __rec: { onresult: (e: unknown) => void; results?: unknown[] } }).__rec;
      const results = rec.results ??= [];
      const result = { isFinal: fin, 0: { transcript: t }, length: 1 };
      const index = results.length;
      if (fin) results.push(result);
      rec.onresult({ resultIndex: index, results: fin ? results : [...results, result] });
    }, [transcript, isFinal] as const);
  // Weiter / Zurück / Prüfen are deliberately not voice commands any more.
  await fire("Next step");
  await fire("Nächster Schritt");
  await expect(page.getByRole("heading", { name: "Step 1 — Blue base" })).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Step 2 — Yellow on blue" })).toBeVisible();
  await expect(page.locator("img.ar-reference")).toHaveCount(0); // step 2 has no reference: placeholder, no stale image
  await expect(page.getByText("No reference photograph for this step")).toBeVisible();
  await fire("Previous step");
  await expect(page.getByRole("heading", { name: "Step 2 — Yellow on blue" })).toBeVisible();
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Step 1 — Blue base" })).toBeVisible();
  await expect(page.locator("img.ar-reference")).toHaveAttribute("src", new RegExp(ids[1]));
  await fire("Verify step");
  await expect(page.getByRole("heading", { name: "Step 1 — Blue base" })).toBeVisible(); // stays: no voice verification
  await expect(page.getByRole("status", { name: "Step status" })).toHaveText("Ready");
  expect((await (await request.get(`${a.base}/progress`)).json()).every((s: { status: string }) => s.status !== "verified")).toBe(true);
});

test("multi-block hologram: author, stack via explicit height help, duplicate, save; AR preview shows assembled vs current (desktop + 375 px)", async ({ page, request }) => {
  test.setTimeout(90000);
  const a = await assembly(request);
  const [s1, s2] = a.steps;
  const [blue, yellow] = a.blocks;
  // Step 2 now places TWO yellow blocks on the blue base.
  expect((await request.put(`${a.base}/steps/${s2.id}`, { data: {
    title: s2.title, instruction: s2.instruction, required_blocks: [{ block_id: yellow.id, required_quantity: 2 }],
  } })).ok()).toBe(true);
  const base = { origin: "tabletop_session", method: "manual_authoring", evidence: "measured", confirmed: true, studs: null, rotation_deg: [0, 0, 0] };
  expect((await request.put(`${a.base}/steps/${s1.id}/ar-placements`, { data: { version: 2, placements: [
    { ...base, target_block_id: blue.id, instance: 1, dimensions: { x_mm: 64, y_mm: 9.6, z_mm: 32 }, position_m: [0.016, 0, 0] },
  ] } })).ok()).toBe(true);

  await noXR(page);
  await page.goto(`/projects/${a.project.id}`);
  await page.getByRole("button", { name: "Edit step Yellow on blue", exact: true }).click();
  await page.getByText("Spatial AR hologram (optional)", { exact: true }).click();
  await page.getByRole("button", { name: "Author placement with a 10 cm proxy" }).click();
  await page.getByLabel("Dimension evidence").selectOption("measured");
  await page.getByLabel("Length X (mm)").fill("32");
  await page.getByLabel("Body height Y (mm, excluding studs)").fill("9.6");
  await page.getByLabel("Depth Z (mm)").fill("16");
  const help = page.getByRole("region", { name: "Height help" });
  await expect(help).toContainText("Bottom face Y = 0.0 mm");
  await expect(help).toContainText("Intersects step 1 block #1");
  // Explicit author action only: nothing is applied automatically.
  await expect(page.getByLabel("Position Y (m) — bottom face")).toHaveValue("0");
  await help.getByRole("button", { name: /Set bottom Y to the top of step 1 block #1/ }).click();
  await expect(page.getByLabel("Position Y (m) — bottom face")).toHaveValue("0.0096");
  await expect(help).toContainText("Rests on step 1 block #1");
  await page.getByRole("button", { name: "Duplicate block 1" }).click();
  const list = page.getByRole("radiogroup", { name: "Hologram blocks" });
  await expect(list.getByRole("radio")).toHaveCount(2);
  await expect(list.getByRole("radio", { checked: true })).toContainText("2 · AR yellow · yellow #2");
  await expect(page.getByRole("button", { name: "Add block" })).toBeDisabled();
  await page.getByRole("checkbox", { name: /I confirm the dimensions/ }).check();
  await page.getByRole("button", { name: "Save AR hologram" }).click();
  await expect(page.getByText(/AR guidance saved/)).toBeVisible();
  const saved = await (await request.get(`${a.base}/steps/${s2.id}/ar-placements`)).json();
  expect(saved.placements.map((p: { instance: number; position_m: number[] }) => [p.instance, p.position_m[1]])).toEqual([[1, 0.0096], [2, 0.0096]]);
  expect(saved.placements[1].position_m[0]).toBeCloseTo(0.032, 6);
  // Guidance never verifies.
  expect((await (await request.get(`${a.base}/progress`)).json()).every((s: { status: string }) => s.status !== "verified")).toBe(true);

  await page.goto(`/ar?project=${a.project.id}`);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Step 2 — Yellow on blue" })).toBeVisible();
  await expect(page.getByRole("img", { name: "2D intended placement" })).toBeVisible();
  await expect(page.getByRole("img", { name: "2D height view (front)" })).toBeVisible();
  await expect(page.locator(".hologram-legend li")).toHaveCount(2);
  await expect(page.getByText(/already assembled in earlier steps \(1\)/)).toBeVisible();
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `no horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
    const box = await page.getByRole("img", { name: "2D height view (front)" }).boundingBox();
    expect(box && box.width > 100 && box.x + box.width <= width + 1).toBe(true);
  }
});
