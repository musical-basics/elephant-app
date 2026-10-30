import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { addItem, addProject, createEmptyState } from "../src/lib/model";
import type { AppState } from "../src/lib/model";

test.use({
  timezoneId: "America/New_York",
  viewport: { width: 1440, height: 1000 },
});
// Tuesday 27 October 2026, Eastern time; the points week began Monday the 26th.
const stamp = (day: number, time: string) =>
  `2026-10-${String(day).padStart(2, "0")}T${time}:00-04:00`;
const iso = (day: number, time: string) =>
  new Date(stamp(day, time)).toISOString();
async function seed(page: Page, state: AppState, at = stamp(27, "09:00")) {
  await page.clock.setFixedTime(new Date(at));
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
const withMondayPoints = (state: AppState): AppState => ({
  ...state,
  items: [
    ...state.items,
    {
      id: "monday-win",
      projectId: null,
      title: "Monday work",
      createdAt: iso(26, "08:00"),
      completedAt: iso(26, "12:00"),
      pointsEarned: 150,
    },
  ],
  pointsGoal: { weeklyTarget: 700, weekOf: "2026-10-26", history: [] },
});
const board = (page: Page) => page.getByRole("region", { name: "Points" });

test("shows today's share, the week, and whether you're ahead of schedule", async ({
  page,
}) => {
  await seed(page, withMondayPoints(addItem(createEmptyState(), "Laundry")));
  await page.goto("/#/still/focus");
  await expect(board(page)).toContainText("Today0 / 100");
  await expect(board(page)).toContainText("This week150 / 700");
  await expect(board(page)).toContainText("50 ahead");

  await page.goto("/#/still/home");
  await expect(board(page)).toContainText("50 ahead of schedule");
  await expect(board(page)).toContainText(
    "50 more today keeps you on schedule.",
  );
});

test("earns general, quantity, and time-based points from Do now", async ({
  page,
}) => {
  await seed(page, withMondayPoints(createEmptyState()));
  await page.goto("/#/tide/focus");

  // General: a fixed award, completed in one tap.
  await page.getByRole("button", { name: "Add item" }).first().click();
  let sheet = page.getByRole("dialog", { name: "One little thing." });
  await sheet.getByLabel("What would you like to do?").fill("Do laundry");
  await sheet.getByRole("radio", { name: /^General/ }).check();
  await sheet.getByLabel("Points for the whole item").fill("5");
  await sheet.getByRole("button", { name: "Add item" }).click();
  await expect(page.locator(".points-chip")).toHaveText("5 points");
  await page.getByRole("button", { name: /Completed!/ }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "+5 points." }),
  ).toBeVisible();
  await expect(board(page)).toContainText("Today5 / 100");
  await expect(board(page)).toContainText("This week155 / 700");

  // Quantity: asks how many, suggesting the number in the title.
  await page.getByRole("button", { name: "Add item" }).first().click();
  sheet = page.getByRole("dialog", { name: "One little thing." });
  await sheet
    .getByLabel("What would you like to do?")
    .fill("Send out 5 emails");
  await sheet.getByRole("radio", { name: /^Quantity/ }).check();
  await sheet.getByLabel("Points per unit").fill("1.5");
  await sheet.getByRole("button", { name: "Add item" }).click();
  await expect(page.locator(".points-chip")).toHaveText("1.5 points each");
  await page.getByRole("button", { name: /Completed!/ }).click();
  sheet = page.getByRole("dialog", { name: "Complete this task?" });
  const count = sheet.getByLabel("How many did you complete?");
  await expect(count).toHaveValue("5");
  await expect(sheet).toContainText("Earns 7.5 points");
  await count.fill("6");
  await expect(sheet).toContainText("Earns 9 points");
  await sheet.getByRole("button", { name: "Complete", exact: true }).click();
  await expect(board(page)).toContainText("Today14 / 100");

  // Time-based: minutes come from the timer, including overtime.
  await page.getByRole("button", { name: "Add item" }).first().click();
  sheet = page.getByRole("dialog", { name: "One little thing." });
  await sheet
    .getByLabel("What would you like to do?")
    .fill("Clean room 5 minutes");
  await sheet.getByRole("radio", { name: /^Time-based/ }).check();
  await sheet.getByLabel("Points per minute").fill("2");
  await sheet.getByRole("button", { name: "Add item" }).click();
  await page.getByRole("button", { name: "Start timer", exact: true }).click();
  await page.clock.setFixedTime(new Date(stamp(27, "09:06")));
  await page.getByRole("button", { name: /Completed!/ }).click();
  sheet = page.getByRole("dialog", { name: "Complete this task?" });
  await expect(sheet.getByLabel("Minutes worked")).toHaveValue("6");
  await expect(sheet).toContainText("Earns 12 points");
  await sheet
    .getByRole("button", { name: "Save time & complete", exact: true })
    .click();
  await expect(board(page)).toContainText("Today26 / 100");

  const state = await read(page);
  expect(
    state.items
      .filter((item) => item.id !== "monday-win")
      .map(({ title, pointsEarned, pointsQuantity, timeSpentSeconds }) => ({
        title,
        pointsEarned,
        pointsQuantity,
        timeSpentSeconds,
      })),
  ).toEqual([
    { title: "Do laundry", pointsEarned: 5 },
    { title: "Send out 5 emails", pointsEarned: 9, pointsQuantity: 6 },
    {
      title: "Clean room 5 minutes",
      pointsEarned: 12,
      pointsQuantity: 6,
      timeSpentSeconds: 360,
    },
  ]);
  await page.goto("/#/tide/completed");
  await expect(page.locator(".completed-row").first()).toContainText(
    "+12 points",
  );
});

test("edits an item's points and asks for an amount when needed", async ({
  page,
}) => {
  await seed(page, addItem(createEmptyState(), "Read"));
  await page.goto("/#/orbit/focus");
  // Without a goal or points this week, Do now stays uncluttered.
  await expect(board(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Edit Read" }).click();
  const sheet = page.getByRole("dialog", { name: "Edit your item" });
  await sheet.getByRole("radio", { name: /^Quantity/ }).check();
  await sheet.getByLabel("Points per unit").fill("0");
  await sheet.getByRole("button", { name: "Save changes" }).click();
  // The browser blocks values below 0.01 before saving.
  await expect(sheet).toBeVisible();
  expect(
    await sheet
      .getByLabel("Points per unit")
      .evaluate((input: HTMLInputElement) => input.validity.rangeUnderflow),
  ).toBe(true);
  await sheet.getByLabel("Points per unit").fill("0.25");
  await sheet.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".points-chip")).toHaveText("0.25 points each");

  await page.getByRole("button", { name: /Completed!/ }).click();
  const complete = page.getByRole("dialog", { name: "Complete this task?" });
  await complete.getByLabel("How many did you complete?").fill("");
  await complete.getByRole("button", { name: "Complete", exact: true }).click();
  await expect(complete.getByRole("alert")).toContainText(
    "Enter how many you completed",
  );
  await complete.getByLabel("How many did you complete?").fill("40");
  await complete.getByLabel("How many did you complete?").press("Enter");
  await expect(complete).toHaveCount(0);
  await expect(board(page)).toContainText("Today10");
  await expect(board(page)).toContainText("Set a weekly goal");
});

test("sets the weekly goal and week start in Settings", async ({ page }) => {
  await seed(page, addItem(createEmptyState(), "Read"));
  await page.goto("/#/pop/settings");
  const settings = page.locator(".points-settings");
  await settings.getByLabel("Weekly goal").fill("700");
  await settings.getByRole("button", { name: "Save goal" }).click();
  await expect(settings).toContainText("That’s 100 points a day.");
  expect((await read(page)).pointsGoal).toEqual({
    weeklyTarget: 700,
    weekOf: "2026-10-26",
    history: [],
  });
  await settings.getByLabel("Week starts on").selectOption("Sunday");
  const state = await read(page);
  expect(state.settings.weekStartsOn).toBe(0);
  expect(state.pointsGoal?.weekOf).toBe("2026-10-25");
});

test("closes a finished week and raises the goal by half the extra", async ({
  page,
}) => {
  // 800 of 700 last week raises this week's goal to 750.
  await seed(
    page,
    withMondayPoints({
      ...createEmptyState(),
      items: [
        {
          id: "big-week",
          projectId: null,
          title: "Big week",
          createdAt: iso(28, "08:00"),
          completedAt: iso(28, "12:00"),
          pointsEarned: 650,
        },
      ],
    }),
    "2026-11-02T09:00:00-05:00",
  );
  await page.goto("/#/pop/home");
  await expect(board(page)).toContainText("This week0 / 750");
  await expect(board(page)).toContainText("Last week: 800 of 700.");
  const state = await read(page);
  expect(state.pointsGoal).toEqual({
    weeklyTarget: 750,
    weekOf: "2026-11-02",
    history: [{ weekOf: "2026-10-26", target: 700, earned: 800 }],
  });
});

test("points fit a narrow phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await seed(
    page,
    withMondayPoints(
      addItem(createEmptyState(), "Send out 5 emails", null, undefined, {
        points: { kind: "perUnit", value: 1 },
      }),
    ),
  );
  for (const screen of ["focus", "home"]) {
    await page.goto(`/#/ember/${screen}`);
    await expect(board(page)).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.goto("/#/ember/focus");
  await page.getByRole("button", { name: "Edit Send out 5 emails" }).click();
  const sheet = page.getByRole("dialog", { name: "Edit your item" });
  await expect(sheet.getByText("Quantity", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("edits a step's points from the project page and shows them large on Do now", async ({
  page,
}) => {
  let state = addProject(createEmptyState(), "Las Vegas utilities");
  const projectId = state.projects[0].id;
  state = addItem(state, "Call the water company", projectId);
  state = addItem(state, "Cancel the internet", projectId);
  await seed(page, state);
  await page.goto(`/#/still/project/${projectId}`);
  const row = page
    .locator(".project-item")
    .filter({ hasText: "Call the water company" });
  await row
    .getByRole("button", { name: "Set points for Call the water company" })
    .click();
  const sheet = page.getByRole("dialog", { name: "Points for this step" });
  await expect(sheet).toContainText("Call the water company");
  await sheet.getByRole("radio", { name: /^General/ }).check();
  await sheet.getByLabel("Points for the whole item").fill("3");
  await sheet.getByRole("button", { name: "Save points" }).click();
  await expect(sheet).toHaveCount(0);
  const pill = row.getByRole("button", {
    name: "Points for Call the water company: 3 points",
  });
  await expect(pill).toHaveText("3 pts");
  // The name is untouched and the other step is unchanged.
  await expect(row.locator(".item-title")).toHaveText("Call the water company");
  await expect(
    page.locator(".project-item").filter({ hasText: "Cancel the internet" }),
  ).toContainText("Points");

  await pill.click();
  const edit = page.getByRole("dialog", { name: "Points for this step" });
  await expect(edit.getByLabel("Points for the whole item")).toHaveValue("3");
  await edit.getByRole("radio", { name: /^Quantity/ }).check();
  await edit.getByLabel("Points per unit").fill("1.5");
  await edit.getByRole("button", { name: "Save points" }).click();
  await expect(row.locator(".item-points")).toHaveText("1.5 pts each");

  await page.goto("/#/still/focus");
  const chip = page.locator(".points-chip");
  await expect(chip).toHaveText("1.5 points each");
  expect(
    await chip.evaluate((element) =>
      parseFloat(getComputedStyle(element).fontSize),
    ),
  ).toBeGreaterThanOrEqual(16);

  await page.goto(`/#/still/project/${projectId}`);
  await row.locator(".item-points").click();
  await page.getByRole("radio", { name: /^No points/ }).check();
  await page.getByRole("button", { name: "Save points" }).click();
  await expect(row.locator(".item-points")).toHaveText("Points");
  expect(
    (await read(page)).items.find(
      (item) => item.title === "Call the water company",
    )?.points,
  ).toBeUndefined();
});
