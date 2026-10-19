import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { AppState } from "../src/lib/model";

test.use({ viewport: { width: 320, height: 844 } });

const readState = (page: Page): Promise<AppState> =>
  page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("elephant.workspace.local.v1")!).state,
  );

test("Do now logs unplanned completed work without changing the current item", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-19T20:00:00.000Z"));
  await page.goto("/#/still/focus");

  const currentTitle = "Write a few ideas for Sunday dinner";
  await expect(
    page.getByRole("heading", { name: currentTitle, exact: true }),
  ).toBeVisible();
  const before = await readState(page);
  const add = page.getByRole("button", { name: "Add item", exact: true });
  const log = page.getByRole("button", {
    name: "Add item to be completed now",
    exact: true,
  });
  await expect(add).toBeVisible();
  await expect(log).toBeVisible();
  const addBounds = await add.boundingBox();
  const logBounds = await log.boundingBox();
  expect(addBounds!.height).toBeGreaterThanOrEqual(37);
  expect(logBounds!.height).toBe(addBounds!.height);
  expect(logBounds!.x).toBeGreaterThan(addBounds!.x);
  expect(logBounds!.x + logBounds!.width).toBeLessThanOrEqual(320);

  await log.click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("What did you complete?", { exact: true })
    .fill("Sent an unplanned reply");
  await dialog
    .getByRole("button", { name: "Log completed item", exact: true })
    .click();

  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: currentTitle, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "Completed item logged.",
  );
  await expect
    .poll(async () => {
      const state = await readState(page);
      return state.items.find(
        (item) => item.title === "Sent an unplanned reply",
      );
    })
    .toMatchObject({
      projectId: null,
      completedAt: "2026-10-19T20:00:00.000Z",
    });
  const after = await readState(page);
  expect(after.queue).toEqual(before.queue);
  expect(after.activityLog?.at(-1)).toMatchObject({
    title: "Sent an unplanned reply",
    category: "task",
    endedAt: "2026-10-19T20:00:00.000Z",
  });

  await page.goto("/#/still/completed");
  await expect(
    page.getByText("Sent an unplanned reply", { exact: true }),
  ).toBeVisible();
});
