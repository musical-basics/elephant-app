import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { addItem, addProject, createEmptyState } from "../src/lib/model";
import type { AppState } from "../src/lib/model";

test.use({ viewport: { width: 1440, height: 1000 } });

async function seed(page: Page, state: AppState) {
  await page.addInitScript((state) => {
    if (!localStorage.getItem("elephant.workspace.local.v1"))
      localStorage.setItem(
        "elephant.workspace.local.v1",
        JSON.stringify({
          storageVersion: 1,
          state,
          revision: null,
          dirty: false,
        }),
      );
  }, state);
}
const read = (page: Page): Promise<AppState> =>
  page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("elephant.workspace.local.v1")!).state,
  );
function abc() {
  let state = addProject(createEmptyState(), "Piano");
  const projectId = state.projects[0].id;
  state = addItem(state, "Warm up", projectId);
  state = addItem(state, "Practice scales", projectId, undefined, {
    recurring: true,
    points: { kind: "fixed", value: 5 },
  });
  return addItem(state, "Learn the new piece", projectId);
}
const heading = (page: Page, name: string) =>
  page.getByRole("heading", { name, exact: true });

test("a recurring step keeps coming back until you move on", async ({
  page,
}) => {
  await seed(page, abc());
  await page.goto("/#/still/focus");
  await expect(heading(page, "Warm up")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Complete recurring item/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /Completed!/ }).click();

  await expect(heading(page, "Practice scales")).toBeVisible();
  await expect(page.locator(".recurring-chip")).toHaveText("Recurring");
  await expect(page.getByRole("button", { name: /Completed!/ })).toHaveCount(0);
  const again = page.getByRole("button", { name: /^Complete item/ });
  for (const count of ["done 1 time", "done 2 times", "done 3 times"]) {
    await again.click();
    await expect(heading(page, "Practice scales")).toBeVisible();
    await expect(page.locator(".recurring-chip")).toHaveText(
      `Recurring · ${count}`,
    );
  }
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Done for now; it comes back next time. +5 points." }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: /Complete recurring item & move on/ })
    .click();
  await expect(heading(page, "Learn the new piece")).toBeVisible();

  const state = await read(page);
  const scales = state.items.filter((item) => item.title === "Practice scales");
  expect(scales).toHaveLength(4);
  const original = scales.find((item) => item.recurring)!;
  expect(original.completedAt).toEqual(expect.any(String));
  expect(
    scales.filter((item) => item.recurrenceOf === original.id),
  ).toHaveLength(3);
  expect(scales.every((item) => item.pointsEarned === 5)).toBe(true);

  await page.goto("/#/still/completed");
  await expect(
    page.locator(".completed-row").filter({ hasText: "Practice scales" }),
  ).toHaveCount(4);
  await expect(
    page.locator(".completed-row").filter({ hasText: "Piano · Recurring" }),
  ).toHaveCount(3);
});

test("marks an item recurring from the edit sheet and the project list", async ({
  page,
}) => {
  await seed(page, abc());
  await page.goto("/#/orbit/focus");
  await page.getByRole("button", { name: "Edit Warm up" }).click();
  const sheet = page.getByRole("dialog", { name: "Edit your item" });
  const recurring = sheet.getByRole("checkbox", { name: /Recurring item/ });
  await expect(recurring).not.toBeChecked();
  await recurring.check();
  await sheet.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".recurring-chip")).toHaveText("Recurring");
  await expect(
    page.getByRole("button", { name: /^Complete item/ }),
  ).toBeVisible();

  await page.goto(`/#/orbit/project/${(await read(page)).projects[0].id}`);
  await expect(page.locator(".project-item .recurring-mark")).toHaveCount(2);
  await page.locator(".item-title", { hasText: "Practice scales" }).click();
  const edit = page.getByRole("dialog", { name: "Edit your item" });
  await expect(
    edit.getByRole("checkbox", { name: /Recurring item/ }),
  ).toBeChecked();
  await edit.getByRole("checkbox", { name: /Recurring item/ }).uncheck();
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".project-item .recurring-mark")).toHaveCount(1);
});

test("a recurring item with a timer starts fresh when it comes back", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-27T12:00:00Z"));
  await seed(
    page,
    addItem(createEmptyState(), "Stretch 5 minutes", null, undefined, {
      recurring: true,
    }),
  );
  await page.goto("/#/tide/focus");
  await page.getByRole("button", { name: "Start timer", exact: true }).click();
  await page.clock.setFixedTime(new Date("2026-10-27T12:02:00Z"));
  await page.getByRole("button", { name: /^Complete item/ }).click();
  const sheet = page.getByRole("dialog", { name: "Complete this task?" });
  await expect(sheet).toContainText("2:00");
  await sheet
    .getByRole("button", { name: "Save time & complete", exact: true })
    .click();
  await expect(sheet).toHaveCount(0);
  await expect(heading(page, "Stretch 5 minutes")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start timer", exact: true }),
  ).toBeVisible();
  const [occurrence] = (await read(page)).items.filter(
    (item) => item.recurrenceOf,
  );
  expect(occurrence.timeSpentSeconds).toBe(120);
});

test("recurring choices fit a narrow phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  let state = addItem(createEmptyState(), "Practice scales", null, undefined, {
    recurring: true,
  });
  state = addItem(state, "Something else");
  await seed(page, state);
  for (const design of ["still", "ember", "orbit", "tide", "pop"]) {
    await page.goto(`/#/${design}/focus`);
    for (const name of [/^Take a bite/, /^Complete item/, /move on/]) {
      const bounds = await page.getByRole("button", { name }).boundingBox();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});
