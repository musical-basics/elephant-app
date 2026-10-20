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

test("Do now toggles editable project notes beside the current item", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto("/#/still/focus");

  const toggle = page.getByRole("button", { name: "Show notes", exact: true });
  const panel = page.getByRole("complementary", {
    name: "Notes for Plan a Sunday dinner",
  });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(panel).toBeHidden();

  await toggle.click();
  await expect(
    page.getByRole("button", { name: "Hide notes", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(panel).toBeVisible();
  const itemBounds = await page.locator(".focus-center").boundingBox();
  const notesBounds = await panel.boundingBox();
  expect(notesBounds!.x).toBeGreaterThan(itemBounds!.x + itemBounds!.width / 2);

  const notes = panel.getByLabel("Project notes", { exact: true });
  await notes.fill("Menu chosen. Next: confirm who is coming.");
  await panel.getByRole("button", { name: "Save notes", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Project notes saved.");
  await panel
    .getByRole("button", { name: "Hide project notes", exact: true })
    .click();
  await expect(panel).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Show notes", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");

  await page.setViewportSize({ width: 320, height: 844 });
  await page.getByRole("button", { name: "Show notes", exact: true }).click();
  await expect(panel).toBeVisible();
  await expect(notes).toHaveValue("Menu chosen. Next: confirm who is coming.");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
