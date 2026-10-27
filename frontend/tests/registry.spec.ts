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

test("camera references persist for blocks and steps and are available to inspection context", async ({ page, request }) => {
  const block = await (await request.post("http://127.0.0.1:8000/api/blocks", { data: { name: "Ocean brick" } })).json();
  let uploads = 0;
  let inspections = 0;
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().endsWith("/images")) uploads++;
    if (req.url().endsWith("/api/inspect")) inspections++;
  });
  await page.goto("/blocks");
  await page.getByRole("button", { name: "Edit Ocean brick", exact: true }).click();
  await page.getByRole("button", { name: "Take reference photo" }).click();
  const camera = page.getByRole("region", { name: "Reference camera", exact: true });
  await expect(camera.getByRole("button", { name: "Save as reference" })).toBeDisabled();
  await camera.getByRole("button", { name: "Start camera" }).click();
  await expect(camera.getByRole("button", { name: "Capture", exact: true })).toBeEnabled();
  const track = await camera.locator("video").evaluateHandle((video) =>
    ((video as HTMLVideoElement).srcObject as MediaStream).getVideoTracks()[0]);
  await camera.getByRole("button", { name: "Capture", exact: true }).click();
  await expect(camera.getByAltText("Reference photo preview")).toBeVisible();
  expect(uploads).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/reference-camera-mobile.png", fullPage: true });
  await camera.getByRole("button", { name: "Save as reference" }).click();
  await expect(camera).toHaveCount(0);
  expect(await track.evaluate((value) => value.readyState)).toBe("ended");
  await expect(page.getByText("Reference photo saved.", { exact: true })).toBeVisible();
  await expect(page.getByAltText(/^camera-reference-\d+\.jpg$/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Ocean brick", exact: true })).toBeVisible();
  const savedBlock = await (await request.get(`http://127.0.0.1:8000/api/blocks/${block.id}`)).json();
  expect(savedBlock.reference_images).toHaveLength(1);
  const project = await (await request.post("http://127.0.0.1:8000/api/projects", { data: { name: "Harbor bridge" } })).json();
  const step = await (await request.post(`http://127.0.0.1:8000/api/projects/${project.id}/steps`, {
    data: { title: "Camera reference step", instruction: "Place the ocean brick flat.", required_blocks: [{ block_id: block.id, required_quantity: 1 }] },
  })).json();
  await page.goto(`/projects/${project.id}`);
  await page.getByRole("button", { name: "Edit step Camera reference step", exact: true }).click();
  await page.getByRole("button", { name: "Take reference photo" }).click();
  await camera.getByRole("button", { name: "Start camera" }).click();
  await expect(camera.getByRole("button", { name: "Capture", exact: true })).toBeEnabled();
  await camera.getByRole("button", { name: "Capture", exact: true }).click();
  await camera.getByRole("button", { name: "Save as reference" }).click();
  await expect(camera).toHaveCount(0);
  await expect(page.getByAltText(/^camera-reference-\d+\.jpg$/)).toBeVisible();
  const context = await (await request.get(`http://127.0.0.1:8000/api/projects/${project.id}/steps/${step.id}/context`)).json();
  expect(context.step_reference_images).toHaveLength(1);
  expect(context.expected_blocks[0].reference_images[0].id).toBe(savedBlock.reference_images[0].id);
  await page.getByRole("link", { name: "Open in workspace" }).click();
  await expect(page.getByAltText("Reference for Camera reference step")).toBeVisible();
  await page.getByRole("button", { name: "Start camera" }).click();
  await expect(page.getByRole("button", { name: "Capture", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await expect(page.getByAltText("Latest captured LEGO assembly")).toBeVisible();
  await expect(page.getByRole("button", { name: "Inspect with Meta AI", exact: true })).toBeEnabled();
  expect(uploads).toBe(2);
  expect(inspections).toBe(0);
});

test("cancel and changing block release the reference camera without uploading", async ({ page, request }) => {
  for (const name of ["Ocean brick", "Ocean brick revised"]) {
    await request.post("http://127.0.0.1:8000/api/blocks", { data: { name } });
  }
  let uploads = 0;
  page.on("request", (req) => { if (req.method() === "POST" && req.url().endsWith("/images")) uploads++; });
  await page.goto("/blocks");
  await page.getByRole("button", { name: "Edit Ocean brick", exact: true }).click();
  const camera = page.getByRole("region", { name: "Reference camera", exact: true });
  for (const action of ["cancel", "switch"]) {
    await page.getByRole("button", { name: "Take reference photo" }).click();
    await camera.getByRole("button", { name: "Start camera" }).click();
    await expect(camera.getByRole("button", { name: "Capture", exact: true })).toBeEnabled();
    const track = await camera.locator("video").evaluateHandle((video) =>
      ((video as HTMLVideoElement).srcObject as MediaStream).getVideoTracks()[0]);
    await camera.getByRole("button", { name: "Capture", exact: true }).click();
    if (action === "cancel") await camera.getByRole("button", { name: "Cancel camera" }).click();
    else await page.getByRole("button", { name: "Edit Ocean brick revised", exact: true }).click();
    await expect(camera).toHaveCount(0);
    expect(await track.evaluate((value) => value.readyState)).toBe("ended");
  }
  expect(uploads).toBe(0);
});

test("reference camera reports denied permission and preserves a photo after failed save", async ({ page, request }) => {
  const block = await (await request.post("http://127.0.0.1:8000/api/blocks", { data: { name: "Ocean brick" } })).json();
  await page.goto("/blocks");
  await page.getByRole("button", { name: "Edit Ocean brick", exact: true }).click();
  await page.getByRole("button", { name: "Take reference photo" }).click();
  const camera = page.getByRole("region", { name: "Reference camera", exact: true });
  await page.evaluate(() => {
    const media = navigator.mediaDevices;
    const original = media.getUserMedia.bind(media);
    media.getUserMedia = async () => {
      media.getUserMedia = original;
      throw new DOMException("Denied", "NotAllowedError");
    };
  });
  await camera.getByRole("button", { name: "Start camera" }).click();
  await expect(camera.getByRole("alert")).toContainText("Camera permission was denied");
  await expect(camera.getByRole("button", { name: "Save as reference" })).toBeDisabled();
  await camera.getByRole("button", { name: "Start camera" }).click();
  await expect(camera.getByRole("button", { name: "Capture", exact: true })).toBeEnabled();
  await camera.getByRole("button", { name: "Capture", exact: true }).click();
  const photo = await camera.getByAltText("Reference photo preview").getAttribute("src");
  const endpoint = `**/api/blocks/${block.id}/images`;
  await page.route(endpoint, (route) => route.fulfill({ status: 503, json: { detail: "Please retry saving the reference" } }));
  await camera.getByRole("button", { name: "Save as reference" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Please retry");
  await expect(camera.getByAltText("Reference photo preview")).toHaveAttribute("src", photo!);
  await expect(camera.getByRole("button", { name: "Save as reference" })).toBeEnabled();
  await page.unroute(endpoint);
  await camera.getByRole("button", { name: "Save as reference" }).click();
  await expect(camera).toHaveCount(0);
  await expect(page.getByAltText(/^camera-reference-\d+\.jpg$/)).toBeVisible();
});

test("step editor manages persistent reference photos used by the workspace", async ({ page, request }) => {
  const project = await (await request.post("http://127.0.0.1:8000/api/projects", { data: { name: "Harbor bridge" } })).json();
  const steps = [];
  for (const title of ["Base reference", "Top reference"]) {
    steps.push(await (await request.post(`http://127.0.0.1:8000/api/projects/${project.id}/steps`, {
      data: { title, instruction: "Compare this step with its selected reference." },
    })).json());
  }
  await page.goto(`/projects/${project.id}`);
  await expect(page.getByRole("region", { name: "Project reference photos", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Reference photographs", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Edit step Base reference", exact: true }).click();
  const gallery = page.locator(".editor-panel").getByRole("region", { name: "Reference photographs", exact: true });
  const bytes = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 100; canvas.height = 80;
    canvas.getContext("2d")!.fillRect(0, 0, 100, 80);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  for (const name of ["front-reference.png", "top-reference.png"]) {
    await gallery.getByLabel("Upload reference photo").setInputFiles({ name, mimeType: "image/png", buffer: Buffer.from(bytes, "base64") });
    await expect(gallery.getByAltText(name, { exact: true })).toBeVisible();
  }
  const first = gallery.getByRole("button", { name: "Use photo front-reference.png for inspection", exact: true });
  const second = gallery.getByRole("button", { name: "Use photo top-reference.png for inspection", exact: true });
  await expect(first).toHaveAttribute("aria-pressed", "true");
  const selectionUrl = `**/api/projects/${project.id}/steps/${steps[0].id}/reference-image`;
  await page.route(selectionUrl, (route) => route.fulfill({ status: 503, json: { detail: "Selection unavailable, retry" } }));
  await second.click();
  await expect(gallery.getByRole("alert")).toContainText("Selection unavailable");
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await page.unroute(selectionUrl);
  await second.click();
  await expect(second).toHaveAttribute("aria-pressed", "true");
  const selectedUrl = await gallery.getByAltText("top-reference.png", { exact: true }).getAttribute("src");
  await page.reload();
  await page.getByRole("button", { name: "Edit step Base reference", exact: true }).click();
  await expect(second).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Edit step Top reference", exact: true }).click();
  await expect(gallery.getByText("No reference photograph yet.")).toBeVisible();
  await page.getByRole("button", { name: "Edit step Base reference", exact: true }).click();
  await expect(second).toHaveAttribute("aria-pressed", "true");
  page.once("dialog", (dialog) => dialog.accept());
  await gallery.getByRole("button", { name: "Delete photo front-reference.png", exact: true }).click();
  await expect(gallery.getByAltText("front-reference.png", { exact: true })).toHaveCount(0);
  await expect(second).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/step-reference-selection-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Close editor", exact: true }).click();
  await expect(gallery).toHaveCount(0);
  await page.getByRole("link", { name: "Open in workspace" }).click();
  await expect(page.getByAltText("Reference for Base reference")).toHaveAttribute("src", selectedUrl!);
});
