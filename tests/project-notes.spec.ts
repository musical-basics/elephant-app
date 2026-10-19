import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 320, height: 844 } });

test("project notes save with the project and survive reloads", async ({
  page,
}) => {
  await page.goto("/#/still/project/demo-dinner");

  const notes = page.getByLabel("Project notes", { exact: true });
  await expect(notes).toBeVisible();
  await notes.fill(
    "Picked the Sunday menu.\nNext: confirm allergies and buy groceries.",
  );
  await page.getByRole("button", { name: "Save notes", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Project notes saved.");

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem("elephant.workspace.local.v1")!,
          ).state.projects.find(
            (project: { id: string }) => project.id === "demo-dinner",
          ).notes,
      ),
    )
    .toBe(
      "Picked the Sunday menu.\nNext: confirm allergies and buy groceries.",
    );

  await page.reload();
  await expect(notes).toHaveValue(
    "Picked the Sunday menu.\nNext: confirm allergies and buy groceries.",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const saveBounds = await page
    .getByRole("button", { name: "Save notes", exact: true })
    .boundingBox();
  expect(saveBounds!.height).toBeGreaterThanOrEqual(44);
  expect(saveBounds!.x + saveBounds!.width).toBeLessThanOrEqual(320);
});
