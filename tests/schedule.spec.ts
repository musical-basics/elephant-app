import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.use({
  viewport: { width: 390, height: 844 },
  timezoneId: "America/New_York",
});
const start = new Date("2026-10-06T16:00:00-04:00").getTime();
const before = (minutes: number) => start - minutes * 60_000;
const key = "elephant.workspace.local.v1";
async function addScheduled(
  page: Page,
  title = "Dentist appointment",
  time = "16:00",
) {
  await page.goto("/#/still/calendar");
  await page
    .getByRole("button", { name: "Schedule item", exact: true })
    .click();
  await page.getByLabel("Scheduled item name").fill(title);
  await page.getByLabel("Date", { exact: true }).fill("2026-10-06");
  await page.getByLabel("Time", { exact: true }).fill(time);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Schedule item", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function saved(page: Page) {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!).state,
    key,
  );
}

test("scheduled items stay on the calendar through edits, completion, reopening, backup and deletion", async ({
  page,
}) => {
  await page.clock.setFixedTime(before(240));
  await addScheduled(page);
  const original = await saved(page);
  expect(original.scheduledItems[0].scheduledAt).toBe(
    "2026-10-06T20:00:00.000Z",
  );
  await page.reload();
  await expect(page.locator(".schedule-title")).toHaveText(
    "Dentist appointment",
  );
  await page
    .getByRole("button", {
      name: "Edit scheduled item Dentist appointment",
      exact: true,
    })
    .click();
  await page.getByLabel("Scheduled item name").fill("Annual checkup");
  await page.getByLabel("Time", { exact: true }).fill("16:30");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator(".schedule-row time")).toHaveText("4:30 PM");
  await page
    .getByRole("button", {
      name: "Complete scheduled item Annual checkup",
      exact: true,
    })
    .click();
  await expect(page.locator(".schedule-row")).toHaveClass(/is-completed/);
  await page
    .getByRole("button", {
      name: "Reopen scheduled item Annual checkup",
      exact: true,
    })
    .click();
  await page.goto("/#/still/queue");
  await expect(
    page.locator(".queue-row").filter({ hasText: "Annual checkup" }),
  ).toHaveCount(0);
  const next = await saved(page);
  expect(next.items).toEqual(original.items);
  expect(next.queue).toEqual(original.queue);
  await page.goto("/#/still/settings");
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download backup", exact: true })
    .click();
  const path = (await (await downloaded).path())!;
  expect(JSON.parse(await readFile(path, "utf8")).scheduledItems).toEqual(
    next.scheduledItems,
  );
  await page.goto("/#/still/calendar");
  await page
    .getByRole("button", {
      name: "Delete scheduled item Annual checkup",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Remove scheduled item", exact: true })
    .click();
  await expect(page.locator(".schedule-row")).toHaveCount(0);
  await page.goto("/#/still/settings");
  await page.getByLabel("Import an Elephant backup").setInputFiles(path);
  await page
    .getByRole("button", { name: "Replace current data", exact: true })
    .click();
  await page.goto("/#/still/calendar");
  await expect(page.locator(".schedule-title")).toHaveText("Annual checkup");
});

test("reminders wait until completion, survive reload, and return to the untouched next task", async ({
  page,
}) => {
  await page.clock.setFixedTime(before(181));
  await addScheduled(page);
  await page.goto("/#/still/focus");
  await page.getByRole("button", { name: "Add timer", exact: true }).click();
  await page.getByRole("button", { name: "Start timer", exact: true }).click();
  await page.clock.setFixedTime(before(180));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("heading", {
      name: "Write a few ideas for Sunday dinner",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Scheduled item reminder" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /Completed!/ }).click();
  await page
    .getByRole("button", { name: "Save time & complete", exact: true })
    .click();
  await expect(
    page.getByText("3-HOUR REMINDER", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add timer", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Dentist appointment", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Got it/ }).click();
  await expect(
    page.getByRole("heading", { name: "Water the plants", exact: true }),
  ).toBeVisible();
  let state = await saved(page);
  expect(
    state.items.filter(
      (item: { completedAt: string | null }) => item.completedAt,
    ),
  ).toHaveLength(1);
  expect(state.items[0].timeSpentSeconds).toBe(60);
  expect(state.scheduledItems[0].completedAt).toBeNull();
  expect(state.scheduledItems[0].acknowledgedReminders).toEqual([180]);
  await page.reload();
  await page.getByRole("button", { name: /Completed!/ }).click();
  await expect(
    page.getByRole("heading", {
      name: "Clear one corner of your desk",
      exact: true,
    }),
  ).toBeVisible();
  await page.clock.setFixedTime(before(30));
  await page.getByRole("button", { name: /Completed!/ }).click();
  await expect(
    page.getByText("30-MINUTE REMINDER", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Got it/ }).click();
  await expect(
    page.getByRole("heading", { name: "Send that quick reply", exact: true }),
  ).toBeVisible();
  state = await saved(page);
  expect(state.scheduledItems[0].acknowledgedReminders).toEqual([180, 30]);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Send that quick reply", exact: true }),
  ).toBeVisible();
});

test("overlapping events show the latest reminder in time order and expired reminders clear", async ({
  page,
}) => {
  await page.clock.setFixedTime(before(20));
  await addScheduled(page);
  await addScheduled(page, "Earlier call", "15:55");
  await page.goto("/#/still/focus");
  await page.getByRole("button", { name: /Completed!/ }).click();
  await expect(
    page.getByText("30-MINUTE REMINDER", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Earlier call", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Got it/ }).click();
  await expect(
    page.getByRole("heading", { name: "Dentist appointment", exact: true }),
  ).toBeVisible();
  await page.clock.setFixedTime(start);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("heading", { name: "Water the plants", exact: true }),
  ).toBeVisible();
});

test("an empty master list can show reminders without needing a task to complete", async ({
  page,
}) => {
  await page.clock.setFixedTime(before(181));
  await addScheduled(page);
  await page.evaluate((key) => {
    const cache = JSON.parse(localStorage.getItem(key)!);
    cache.state.projects = [];
    cache.state.items = [];
    cache.state.queue = [];
    localStorage.setItem(key, JSON.stringify(cache));
  }, key);
  await page.goto("/#/still/focus");
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "A little breathing room.",
      exact: true,
    }),
  ).toBeVisible();
  await page.clock.setFixedTime(before(180));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByText("3-HOUR REMINDER", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Got it/ }).click();
  await expect(
    page.getByRole("heading", {
      name: "A little breathing room.",
      exact: true,
    }),
  ).toBeVisible();
});

test("the Add item shortcut opens scheduling and desktop calendar dates select the timeline", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.clock.setFixedTime(before(240));
  await page.goto("/#/still/home");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Schedule an item for a date and time",
      exact: true,
    })
    .click();
  await page.getByLabel("Scheduled item name").fill("Tomorrow’s call");
  await page.getByLabel("Date", { exact: true }).fill("2026-10-07");
  await page.getByLabel("Time", { exact: true }).fill("09:00");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Schedule item", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "Calendar", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Wednesday, October 7, 2026, 1 scheduled item",
      exact: true,
    })
    .click();
  await expect(page.locator(".schedule-title")).toHaveText("Tomorrow’s call");
  await expect(page.locator(".schedule-row time")).toHaveText("9:00 AM");
  await page.screenshot({
    path: "/tmp/elephant-calendar-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

for (const design of ["still", "ember", "orbit", "tide", "pop"]) {
  test(`${design}: calendar, scheduling form, and reminder fit a 320px phone`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.clock.setFixedTime(before(240));
    await page.goto(`/#/${design}/calendar`);
    await page.getByRole("button", { name: "Next month", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "November 2026", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "October 2026", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Schedule item", exact: true })
      .click();
    expect(
      await page
        .getByRole("dialog")
        .evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth),
    ).toBe(true);
    await page.getByLabel("Scheduled item name").fill("A little time");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Schedule item", exact: true })
      .click();
    await expect(page.locator(".schedule-title")).toHaveText("A little time");
    await page.screenshot({
      path: `/tmp/elephant-calendar-${design}.png`,
      fullPage: true,
      animations: "disabled",
    });
    await page.goto(`/#/${design}/focus`);
    await page.getByRole("button", { name: /Completed!/ }).click();
    await expect(
      page.getByText("30-MINUTE REMINDER", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `/tmp/elephant-reminder-${design}.png`,
      fullPage: true,
      animations: "disabled",
    });
    await page.getByRole("button", { name: /Got it/ }).click();
    await expect(
      page.getByRole("heading", { name: "Water the plants", exact: true }),
    ).toBeVisible();
  });
}
