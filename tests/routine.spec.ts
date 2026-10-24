import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createEmptyState } from "../src/lib/model";
import type { AppState } from "../src/lib/model";
import { addStarterRoutine } from "../src/lib/routine";

test.use({
  timezoneId: "America/New_York",
  viewport: { width: 1440, height: 1000 },
});
// Thursday 22 October 2026, Eastern time.
const stamp = (day: number, time: string) =>
  `2026-10-${String(day).padStart(2, "0")}T${time}:00-04:00`;
const iso = (day: number, time: string) =>
  new Date(stamp(day, time)).toISOString();
async function seed(page: Page, state: AppState, time = "18:00") {
  await page.clock.setFixedTime(new Date(stamp(22, time)));
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
const card = (page: Page, title: string) =>
  page.locator(".routine-card").filter({
    has: page.getByRole("heading", { name: title, exact: true }),
  });

test("quick-logs routine items with weekly goals, undo, editing, and removal", async ({
  page,
}) => {
  await seed(page, createEmptyState());
  await page.goto("/#/still/routine");
  await expect(
    page.getByRole("heading", { name: "Routine", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: "Routine" }),
  ).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Add the usual routine" }).click();
  await expect(page.locator(".routine-card h3")).toHaveText([
    "Walk the dog",
    "Do laundry",
    "Sleep",
    "Eat",
    "Buy groceries and supplies",
    "Refill the dog’s water tank and bowl",
    "Workout",
  ]);
  await expect(card(page, "Workout")).toContainText("0 of 2 this week");
  await expect(card(page, "Sleep")).toContainText("Sleep · 8 hr");

  await page.getByRole("button", { name: "Log Walk the dog now" }).click();
  const walk = card(page, "Walk the dog");
  await expect(walk).toContainText("Walk the dog logged, 5:30 PM–6:00 PM.");
  await expect(walk).toContainText("1 this week");
  await expect(walk).toContainText("Last: Today 6:00 PM");
  let state = await read(page);
  const walkId = state.routines!.find((r) => r.title === "Walk the dog")!.id;
  expect(state.activityLog).toEqual([
    {
      id: expect.any(String),
      title: "Walk the dog",
      category: "other",
      startedAt: iso(22, "17:30"),
      endedAt: iso(22, "18:00"),
      createdAt: iso(22, "18:00"),
      routineId: walkId,
    },
  ]);
  await walk.getByRole("button", { name: "Undo" }).click();
  await expect(walk).toContainText("0 this week");
  await expect(walk).toContainText("Not logged yet");
  expect((await read(page)).activityLog).toEqual([]);

  const workout = card(page, "Workout");
  await page.getByRole("button", { name: "Log Workout now" }).click();
  await page.clock.setFixedTime(new Date(stamp(22, "19:00")));
  await page.getByRole("button", { name: "Log Workout now" }).click();
  await expect(workout).toContainText("2 of 2 this week");
  await expect(workout).toContainText("Goal met");

  await page.getByRole("button", { name: "Edit Workout" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Hours").fill("1");
  await dialog.getByLabel("Minutes").fill("0");
  await dialog.getByLabel("Goal per week (optional)").fill("3");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(workout).toContainText("Exercise · 1 hr");
  await expect(workout).toContainText("2 of 3 this week");
  await expect(workout).not.toContainText("Goal met");

  await page.getByRole("button", { name: "Add routine item" }).click();
  await dialog.getByLabel("Name").fill("Water the plants");
  await dialog.getByLabel("Hours").fill("0");
  await dialog.getByLabel("Minutes").fill("0");
  await dialog.getByRole("button", { name: "Add to routine" }).click();
  await expect(dialog.getByRole("alert")).toContainText("usual duration");
  await dialog.getByLabel("Minutes").fill("10");
  await dialog.getByRole("button", { name: "Add to routine" }).click();
  await expect(card(page, "Water the plants")).toContainText("Other · 10 min");

  await page.getByRole("button", { name: "Edit Workout" }).click();
  await dialog.getByRole("button", { name: "Remove from routine" }).click();
  await dialog
    .getByRole("button", { name: "Remove from routine", exact: true })
    .click();
  await expect(card(page, "Workout")).toHaveCount(0);
  state = await read(page);
  // Removing a routine item keeps the activities it logged.
  expect(state.activityLog!.map((entry) => entry.title)).toEqual([
    "Workout",
    "Workout",
  ]);

  await page.reload();
  await expect(page.locator(".routine-card")).toHaveCount(7);
  await expect(card(page, "Water the plants")).toBeVisible();
});

test("weekly items repeat on the calendar from the week they are added", async ({
  page,
}) => {
  await seed(page, createEmptyState());
  await page.goto("/#/still/routine");
  const dialog = page.getByRole("dialog");
  for (const [title, day, time] of [
    ["Fellowship", "Friday", "19:30"],
    ["Church", "Sunday", "10:00"],
    ["Bible study", "Monday", "21:00"],
  ]) {
    await page.getByRole("button", { name: "Add weekly item" }).click();
    await dialog.getByLabel("Name").fill(title);
    await dialog.getByLabel("Day").selectOption({ label: day });
    await dialog.getByLabel("Time").fill(time);
    await dialog.getByRole("button", { name: "Add weekly item" }).click();
    await expect(dialog).toHaveCount(0);
  }
  await expect(page.locator(".weekly-list li")).toHaveText([
    /Sunday10:00 AMChurchNext: Sun, Oct 25/,
    /Monday9:00 PMBible studyNext: Mon, Oct 26/,
    /Friday7:30 PMFellowshipNext: Fri, Oct 23/,
  ]);

  await page.getByRole("button", { name: "See them on the calendar" }).click();
  await expect(page).toHaveURL(/#\/still\/calendar$/);
  await page.getByRole("button", { name: /^Monday, October 26, 2026/ }).click();
  const row = page.locator(".schedule-row.is-weekly");
  await expect(row).toHaveCount(1);
  await expect(row.locator("time")).toHaveText("9:00 PM");
  await expect(row).toContainText("Weekly · every Monday");
  await expect(
    page.getByRole("button", {
      name: "Friday, October 30, 2026, 1 scheduled item",
    }),
  ).toBeVisible();
  // Nothing appears in weeks before the item was added.
  await page
    .getByRole("button", { name: "Monday, October 19, 2026", exact: true })
    .click();
  await expect(row).toHaveCount(0);
  await page.getByRole("button", { name: /^Monday, November 2, 2026/ }).click();
  await expect(row).toContainText("Bible study");
  await row.getByRole("button", { name: "Bible study" }).click();
  await expect(page).toHaveURL(/#\/still\/routine$/);

  await page.getByRole("button", { name: "Edit Bible study" }).click();
  await dialog.getByLabel("Time").fill("20:30");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".weekly-list li").nth(1)).toContainText("8:30 PM");
  await page.getByRole("button", { name: "Edit Church" }).click();
  await dialog.getByRole("button", { name: "Remove weekly item" }).click();
  await dialog
    .getByRole("button", { name: "Remove weekly item", exact: true })
    .click();
  await expect(page.locator(".weekly-list li")).toHaveCount(2);
  expect((await read(page)).weeklyItems!.map((item) => item.title)).toEqual([
    "Fellowship",
    "Bible study",
  ]);
});

test("Log links to Routine and shows its entries; phones reach it from Home and it fits 320px", async ({
  page,
}) => {
  await seed(page, addStarterRoutine(createEmptyState()));
  await page.goto("/#/still/log");
  await page.getByRole("button", { name: "Your routine" }).click();
  await expect(page).toHaveURL(/#\/still\/routine$/);
  await page.getByRole("button", { name: "Log Eat now" }).click();
  await page.goto("/#/still/log");
  await expect(
    page.getByRole("button", {
      name: /^Edit logged item Eat, 5:30 PM to 6:00 PM/,
    }),
  ).toBeVisible();

  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/#/still/home");
  await page.getByRole("button", { name: /^Routine/ }).click();
  await expect(page).toHaveURL(/#\/still\/routine$/);
  for (const design of ["still", "ember", "orbit", "tide", "pop"]) {
    await page.goto(`/#/${design}/routine`);
    await expect(page.locator(".routine-card")).toHaveCount(7);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      design,
    ).toBe(true);
    const log = (await page
      .getByRole("button", { name: "Log Workout now" })
      .boundingBox())!;
    expect(log.height).toBeGreaterThanOrEqual(44);
  }
});
