import { test, expect } from "@playwright/test";

test("register physical faces and select a required board direction", async ({ page, request }) => {
  const block = await (await request.post("http://localhost:8000/api/blocks", { data: { name: "Face browser block" } })).json();
  await page.goto("/blocks");
  await page.getByRole("button", { name: `Edit ${block.name}` }).click();
  const editor = page.getByRole("region", { name: "Printed faces" });
  await editor.getByLabel("Face name", { exact: true }).fill("Printed front");
  await editor.getByLabel("Printed text or logo description").fill("Test artwork");
  await editor.getByLabel("Face width (mm)").fill("32");
  await editor.getByLabel("Face height (mm)").fill("24");
  await editor.getByRole("button", { name: "Register face" }).click();
  await expect(editor.getByText("Printed front · front", { exact: true })).toBeVisible();
  await editor.getByText("Printed front · front", { exact: true }).click();
  await editor.getByLabel("Registered print description").fill("Revised artwork description");
  await editor.getByRole("button", { name: "Save face description" }).click();
  await expect(editor.getByText("Revised artwork description", { exact: true })).toBeVisible();
  const imageBase64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 100; canvas.height = 80;
    const context = canvas.getContext("2d")!; context.fillStyle = "#2266bb"; context.fillRect(0, 0, 100, 80);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await editor.getByLabel("Upload reference photo").setInputFiles({
    name: "face-fixture.png", mimeType: "image/png", buffer: Buffer.from(imageBase64, "base64"),
  });
  await expect(editor.getByAltText("face-fixture.png", { exact: true })).toBeVisible();
  const project = await (await request.post("http://localhost:8000/api/projects", { data: { name: "Face browser project" } })).json();
  await page.goto(`/projects/${project.id}`);
  await page.getByRole("button", { name: "Add step", exact: true }).click();
  await page.getByLabel("Step title").fill("Printed layer");
  await page.getByLabel("Instruction", { exact: false }).fill("Required face toward board -Y");
  await page.getByLabel("Face browser block", { exact: false }).first().check();
  await page.getByLabel("Face target block").selectOption(block.id);
  await page.getByLabel("Required printed face").selectOption({ label: "Printed front · front" });
  await page.getByLabel("Required physical facing direction").selectOption("board_negative_y");
  await page.getByRole("button", { name: "Save step", exact: true }).click();
  await expect(page.getByText("Step saved. Manage reference photographs below.")).toBeVisible();
  const saved = await (await request.get(`http://localhost:8000/api/projects/${project.id}`)).json();
  expect(saved.steps[0].face_constraint.facing_direction).toBe("board_negative_y");
  const progressUrl = `http://localhost:8000/api/projects/${project.id}/progress`;
  const before = (await (await request.get(progressUrl)).json())[0].specification_id;
  await page.goto("/blocks");
  await page.getByRole("button", { name: `Edit ${block.name}` }).click();
  await editor.getByText("Printed front · front", { exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await editor.getByRole("button", { name: "Delete photo face-fixture.png" }).click();
  await expect(editor.getByAltText("face-fixture.png", { exact: true })).toHaveCount(0);
  const after = (await (await request.get(progressUrl)).json())[0].specification_id;
  expect(after).not.toBe(before);
  await request.delete(`http://localhost:8000/api/projects/${project.id}`);
  await request.delete(`http://localhost:8000/api/blocks/${block.id}`);
});
