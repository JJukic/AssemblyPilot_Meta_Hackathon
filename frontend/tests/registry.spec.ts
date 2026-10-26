import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });
// Clean only fixtures owned by this suite, including after a failed/retried browser test.
// The runner refuses any existing backend, so this API always uses disposable storage.
test.afterEach(async ({ request }) => {
  const projects = await request.get("http://127.0.0.1:8000/api/projects");
  for (const project of await projects.json() as { id: string; name: string }[]) {
    if (project.name === "Harbor bridge") await request.delete(`http://127.0.0.1:8000/api/projects/${project.id}`);
  }
  const blocks = await request.get("http://127.0.0.1:8000/api/blocks");
  for (const block of await blocks.json() as { id: string; name: string }[]) {
    if (["Ocean brick", "Ocean brick revised"].includes(block.name)) await request.delete(`http://127.0.0.1:8000/api/blocks/${block.id}`);
  }
});

// Playwright starts a real API with a disposable SQLite DB (never a local development DB).
test("complete registry → project → camera workflow persists and cleans up correctly", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/blocks");
  await expect(page.getByRole("heading", { name: "Your block library starts here" })).toBeVisible();
  await page.getByRole("button", { name: "Add block", exact: true }).click();
  const blockForm = page.getByRole("form", { name: "Block details" });
  await blockForm.getByRole("button", { name: "Save block" }).click();
  expect(await blockForm.getByLabel("Name *", { exact: true }).evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true);
  await blockForm.getByLabel("Name *", { exact: true }).fill("Ocean brick");
  await blockForm.getByLabel("Studs X").fill("2");
  await blockForm.getByLabel("Studs Y").fill("4");
  await blockForm.getByLabel("Height (mm)").fill("9.6");
  await blockForm.getByRole("button", { name: "Save block" }).click();
  await expect(page.getByRole("heading", { name: "Ocean brick", exact: true })).toBeVisible();
  const imageBase64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 100; canvas.height = 80;
    const context = canvas.getContext("2d")!; context.fillStyle = "#2266bb"; context.fillRect(0, 0, 100, 80);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const photo = { name: "synthetic-reference.png", mimeType: "image/png", buffer: Buffer.from(imageBase64, "base64") };
  await page.getByLabel("Upload reference photo").setInputFiles(photo);
  await expect(page.getByAltText("synthetic-reference.png", { exact: true })).toBeVisible();
  await page.getByLabel("Upload reference photo").setInputFiles({ name: "bad.png", mimeType: "image/png", buffer: Buffer.from("not-an-image") });
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Invalid or corrupt image");
  await blockForm.getByLabel("Name *", { exact: true }).fill("Ocean brick revised");
  await blockForm.getByRole("button", { name: "Save block" }).click();
  await expect(page.getByRole("heading", { name: "Ocean brick revised", exact: true })).toBeVisible();
  await page.getByLabel("Search blocks").fill("not present");
  await expect(page.getByText("No blocks match these filters.")).toBeVisible();
  await page.getByLabel("Search blocks").fill("Ocean");
  await page.getByLabel("Filter by color").selectOption("blue");
  await expect(page.getByRole("heading", { name: "Ocean brick revised", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Ocean brick revised", exact: true })).toBeVisible();

  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Projects", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Make room for your next build" })).toBeVisible();
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Project name *").fill("Harbor bridge");
  await page.getByRole("button", { name: "Save project" }).click();
  await page.getByRole("link", { name: "Open project", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[a-z0-9-]+$/);
  const projectPath = new URL(page.url()).pathname;
  await expect(page.getByRole("heading", { name: "Every build starts with a first step" })).toBeVisible();
  await page.getByRole("button", { name: "Edit project details" }).click();
  await page.getByLabel("Description", { exact: true }).fill("A local construction project.");
  await page.getByRole("button", { name: "Save project" }).click();
  await expect(page.getByText("A local construction project.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add step", exact: true }).click();
  await page.getByLabel("Step title *").fill("Place ocean base");
  await page.getByLabel("Instruction *").fill("Put the two ocean bricks next to each other.");
  await page.getByRole("checkbox", { name: "Ocean brick revised" }).check();
  await page.getByLabel("Quantity for Ocean brick revised").fill("2");
  await page.getByRole("button", { name: "Save step" }).click();
  await expect(page.getByRole("article", { name: "Step 1: Place ocean base" })).toBeVisible();
  await page.getByLabel("Upload reference photo").setInputFiles(photo);
  await expect(page.getByAltText("synthetic-reference.png", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add step", exact: true }).click();
  await page.getByLabel("Step title *").fill("Check alignment");
  await page.getByLabel("Instruction *").fill("Check the front edges are aligned.");
  await page.getByRole("button", { name: "Save step" }).click();
  await expect(page.getByRole("article", { name: "Step 2: Check alignment" })).toBeVisible();
  await page.getByRole("button", { name: "Move Check alignment up" }).click();
  await expect(page.getByRole("article", { name: "Step 1: Check alignment" })).toBeVisible();
  await page.getByRole("button", { name: "Move Check alignment down" }).click();
  await expect(page.getByRole("article", { name: "Step 1: Place ocean base" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("article", { name: "Step 1: Place ocean base" })).toBeVisible();
  await page.getByRole("button", { name: "Edit step Place ocean base", exact: true }).click();
  await page.getByLabel("Instruction *").fill("Place two ocean bricks side by side.");
  await page.getByRole("button", { name: "Save step" }).click();
  await expect(page.getByRole("article", { name: "Step 1: Place ocean base" }).getByText("Place two ocean bricks side by side.", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Open in workspace" }).click();
  await expect(page.getByRole("heading", { name: "Harbor bridge", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Place ocean base", exact: true })).toBeVisible();
  await expect(page.getByText("Ocean brick revised", { exact: true })).toBeVisible();
  await expect(page.getByAltText("Reference for Place ocean base")).toBeVisible();
  await expect(page.getByRole("status", { name: "Backend: Connected" })).toBeVisible();
  await page.getByRole("button", { name: "Start camera" }).click();
  await expect(page.getByRole("status", { name: "Camera: Connected" })).toBeVisible();
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await expect(page.getByAltText("Latest captured LEGO assembly")).toBeVisible();
  await page.getByRole("button", { name: "Next step", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Check alignment", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Assembly project", exact: true }).selectOption("");
  await expect(page.getByRole("heading", { name: "LEGO Demo Assembly" })).toBeVisible();
  await expect(page.getByRole("status", { name: "Camera: Connected" })).toBeVisible();
  await page.getByRole("button", { name: "Stop camera" }).click();

  await page.goto("/blocks");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete Ocean brick revised", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Remove those assignments first");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto(projectPath);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete step Check alignment", exact: true }).click();
  await expect(page.getByRole("article", { name: "Step 2: Check alignment" })).toHaveCount(0);
  await page.goto("/projects");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete Harbor bridge", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Make room for your next build" })).toBeVisible();
  await page.goto("/blocks");
  await expect(page.getByRole("heading", { name: "Ocean brick revised", exact: true })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete Ocean brick revised", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your block library starts here" })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("management pages show useful backend errors", async ({ page }) => {
  await page.route("**/api/blocks", (route) => route.abort());
  await page.goto("/blocks");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Cannot reach the backend");
  await expect(page.getByRole("button", { name: "Retry loading" })).toBeVisible();
});
