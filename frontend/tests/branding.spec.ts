import { expect, test, type Page } from "@playwright/test";

/* Header branding: [AssemblyPilot icon] [Meta mascot] AssemblyPilot / Visual Assembly Intelligence.
 * Static image only; identical on every page; no overflow at narrow widths; a missing image
 * falls back to the previous icon + wordmark without layout errors. */
const PAGES = ["/", "/blocks", "/projects", "/settings", "/ar"];
const brand = (page: Page) => page.locator("header.topbar .brand").first();

async function geometry(page: Page) {
  const b = brand(page);
  const box = async (sel: string) => (await b.locator(sel).first().boundingBox())!;
  return { icon: await box(".brand-icon"), mascot: await b.locator(".brand-mascot").boundingBox(), name: await box(".brand-name") };
}

for (const path of PAGES) test(`branding on ${path}: icon → mascot → wordmark, mascot loaded, static and proportional`, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(path);
  const mascot = brand(page).getByRole("img", { name: "Meta mascot" });
  await expect(mascot).toBeVisible();
  await expect(brand(page)).toContainText("AssemblyPilot");
  await expect(brand(page)).toContainText("Visual Assembly Intelligence");
  await expect.poll(() => mascot.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  const { icon, mascot: m, name } = await geometry(page);
  expect(m).not.toBeNull();
  expect(icon.x + icon.width).toBeLessThanOrEqual(m!.x + 1);
  expect(m!.x + m!.width).toBeLessThanOrEqual(name.x + 1);
  expect(m!.height).toBeGreaterThanOrEqual(42);
  expect(m!.height).toBeLessThanOrEqual(56);
  expect(Math.abs(m!.width / m!.height - 117 / 168)).toBeLessThan(0.02); // aspect kept, not distorted
  expect(Math.abs(m!.y + m!.height / 2 - (icon.y + icon.height / 2))).toBeLessThan(4); // vertically aligned
  expect(await mascot.evaluate((img) => getComputedStyle(img).animationName)).toBe("none");
  expect(errors).toEqual([]);
});

for (const width of [768, 390, 340]) test(`branding at ${width} px: no overflow, navigation intact`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 });
  for (const path of PAGES) {
    await page.goto(path);
    await expect(brand(page)).toContainText("AssemblyPilot");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${path} overflows by ${overflow} px`).toBeLessThanOrEqual(1);
    const mascot = brand(page).locator(".brand-mascot");
    if (width <= 360) await expect(mascot).toBeHidden(); // steps aside on very narrow screens
    else {
      const m = (await mascot.boundingBox())!;
      expect(m.height).toBeLessThanOrEqual(width <= 520 ? 34.5 : 40.5); // proportionally smaller
      expect(Math.abs(m.width / m.height - 117 / 168)).toBeLessThan(0.02);
    }
    for (const label of ["Workspace", "Block library", "Projects", "Settings"])
      await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: label })).toBeVisible();
  }
});

test("navigation still works and the header is identical on every page", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/blocks");
  // Same structure, text and image on every page (attribute order may differ between SSR and client).
  const html = async () => brand(page).evaluate((el) => JSON.stringify({
    text: el.textContent,
    children: Array.from(el.children).map((c) => c.className),
    img: [...el.querySelectorAll("img")].map((i) => [i.getAttribute("src"), i.alt, i.width, i.height]),
  }));
  const first = await html();
  for (const [label, url] of [["Projects", /\/projects$/], ["Settings", /\/settings$/], ["Block library", /\/blocks$/]] as const) {
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: label }).click();
    await expect(page).toHaveURL(url);
    await expect(brand(page).getByRole("img", { name: "Meta mascot" })).toBeVisible();
    expect(await html()).toBe(first);
  }
});

test("missing mascot image: header falls back to icon + wordmark without errors or layout shift", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/assets/meta-mascot.png", (r) => r.fulfill({ status: 404, body: "" }));
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const path of ["/", "/blocks"]) {
    await page.goto(path);
    await expect(brand(page).locator(".brand-mascot")).toHaveCount(0);
    await expect(brand(page).locator(".brand-icon")).toBeVisible();
    await expect(brand(page)).toContainText("AssemblyPilot");
    await expect(brand(page)).toContainText("Visual Assembly Intelligence");
    const icon = (await brand(page).locator(".brand-icon").boundingBox())!;
    const name = (await brand(page).locator(".brand-name").boundingBox())!;
    expect(name.x - (icon.x + icon.width)).toBeLessThan(20); // the previous icon → wordmark spacing
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("the mascot appears only in the header branding (not in the AR panel or field UI)", async ({ page }) => {
  await page.goto("/ar");
  await expect(page.getByRole("img", { name: "Meta mascot" })).toHaveCount(1);
  expect(await page.locator("img[src*='meta-mascot']").evaluateAll((els) => els.every((e) => e.closest("header.topbar")))).toBe(true);
});
