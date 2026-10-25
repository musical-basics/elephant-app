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

  const toggle = page.getByRole("button", { name: "Notes", exact: true });
  const panel = page.getByRole("complementary", {
    name: "Notes for Plan a Sunday dinner",
  });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(panel).toBeHidden();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
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
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  await page.setViewportSize({ width: 320, height: 844 });
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(panel).toBeVisible();
  await expect(notes).toHaveValue("Menu chosen. Next: confirm who is coming.");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("Do now shows completed items from the current project", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto("/#/still/focus");
  await page.evaluate(() => {
    const key = "elephant.workspace.local.v1";
    const saved = JSON.parse(localStorage.getItem(key)!);
    saved.state.items = saved.state.items.map(
      (item: { id: string; completedAt: string | null }) => {
        if (item.id === "dinner-2")
          return {
            ...item,
            completedAt: "2026-10-19T20:00:00.000Z",
            timeSpentSeconds: 754,
          };
        if (item.id === "dinner-3")
          return { ...item, completedAt: "2026-10-20T20:00:00.000Z" };
        if (item.id === "errand-1")
          return { ...item, completedAt: "2026-10-20T21:00:00.000Z" };
        return item;
      },
    );
    saved.state.queue = saved.state.queue.filter(
      (slot: { kind: string; itemId?: string }) =>
        slot.kind !== "errand" || slot.itemId !== "errand-1",
    );
    localStorage.setItem(key, JSON.stringify(saved));
  });
  await page.reload();

  const toggle = page.getByRole("button", {
    name: /^Completed items/,
  });
  const panel = page.getByRole("complementary", {
    name: "Completed items for Plan a Sunday dinner",
  });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toContainText("2");
  await expect(panel).toBeHidden();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading")).toHaveText(
    "Completed in this project",
  );
  await expect(panel.getByRole("listitem")).toHaveCount(2);
  await expect(panel.getByRole("listitem").nth(0)).toContainText(
    "Make a short shopping list",
  );
  await expect(panel.getByRole("listitem").nth(1)).toContainText(
    "Choose one simple recipe",
  );
  await expect(panel).not.toContainText("Water the plants");
  await expect(panel).toContainText("12:34 spent");

  const itemBounds = await page.locator(".focus-center").boundingBox();
  const panelBounds = await panel.boundingBox();
  expect(panelBounds!.x).toBeGreaterThan(itemBounds!.x + itemBounds!.width / 2);

  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(panel).toBeHidden();
  await expect(
    page.getByRole("complementary", {
      name: "Notes for Plan a Sunday dinner",
    }),
  ).toBeVisible();

  await page.setViewportSize({ width: 320, height: 844 });
  await page.getByRole("button", { name: /^Completed items/ }).click();
  await expect(panel).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("project notes sit beside the steps on wide screens and above them when narrow", async ({
  page,
}) => {
  // Measure everything in one frame after fonts settle, so late font swaps
  // cannot shift one box between measurements.
  const layout = () =>
    page.evaluate(async () => {
      await document.fonts.ready;
      const box = (selector: string) =>
        document.querySelector(selector)!.getBoundingClientRect().toJSON();
      return {
        notes: box(".project-notes"),
        steps: box(".project-items"),
        column: box(".project-steps-column"),
        fits: document.documentElement.scrollWidth <= window.innerWidth,
      };
    });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/still/project/demo-dinner");
  await expect(page.locator(".project-notes")).toBeVisible();
  let { notes, steps, column, fits } = await layout();
  expect(notes.x).toBeGreaterThan(steps.x + steps.width);
  expect(notes.width).toBeGreaterThanOrEqual(280);
  expect(notes.width).toBeLessThanOrEqual(360);
  // The notes column starts level with the steps column.
  expect(Math.abs(notes.y - column.y)).toBeLessThan(2);
  expect(fits).toBe(true);

  await page.setViewportSize({ width: 1000, height: 900 });
  ({ notes, steps } = await layout());
  expect(notes.y + notes.height).toBeLessThan(steps.y);
  expect(Math.abs(notes.x - steps.x)).toBeLessThan(2);
});

test("Do now gives View project its own large button, apart from the panel toggles", async ({
  page,
}) => {
  for (const [width, height] of [
    [1200, 900],
    [320, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/#/still/focus");
    const view = page.getByRole("button", { name: /View project/ });
    await expect(view).toContainText("Plan a Sunday dinner");
    const viewBox = (await view.boundingBox())!;
    const notesBox = (await page
      .getByRole("button", { name: "Notes", exact: true })
      .boundingBox())!;
    expect(viewBox.height).toBeGreaterThanOrEqual(48);
    // The toggles sit on their own row below the project button.
    expect(notesBox.y).toBeGreaterThanOrEqual(viewBox.y + viewBox.height);
    expect(viewBox.x + viewBox.width).toBeLessThanOrEqual(width);
    await view.click();
    await expect(page).toHaveURL(/#\/still\/project\/demo-dinner$/);
  }
});
