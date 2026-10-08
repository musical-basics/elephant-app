import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { addItem, createEmptyState } from "../src/lib/model";
import type { AppState } from "../src/lib/model";
import type { LogEntry } from "../src/lib/activityLog";

test.use({
  timezoneId: "America/New_York",
  viewport: { width: 1440, height: 1080 },
});
const stamp = (day: number, time: string) =>
  `2026-10-${String(day).padStart(2, "0")}T${time}:00-04:00`;
const iso = (day: number, time: string) =>
  new Date(stamp(day, time)).toISOString();
const logged = (
  id: string,
  category: LogEntry["category"],
  day: number,
  start: string,
  end: string,
): LogEntry => ({
  id,
  title: id,
  category,
  startedAt: iso(day, start),
  endedAt: iso(day, end),
  createdAt: iso(day, end),
});
const stateWithTasks = () =>
  addItem(addItem(createEmptyState(), "Practice piano"), "Answer email");
async function seed(page: Page, state: AppState) {
  await page.clock.setFixedTime(new Date(stamp(8, "12:00")));
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
async function addLog(
  page: Page,
  shortcut: string,
  title: string,
  start: string,
  end: string,
) {
  await page.getByRole("button", { name: shortcut, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Activity name").fill(title);
  await dialog.getByLabel("Start", { exact: true }).fill(start);
  await dialog.getByLabel("End", { exact: true }).fill(end);
  await dialog.getByRole("button", { name: "Save logged item" }).click();
  await expect(dialog).not.toBeVisible();
}

test("seven full days, overnight staples, non-task logs, protected forms, editing and deletion persist", async ({
  page,
}) => {
  await seed(page, stateWithTasks());
  await page.goto("/#/still/log");
  await expect(
    page.getByRole("heading", { name: "Log", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".log-day-heading")).toHaveCount(7);
  await expect(page.locator(".log-hours span")).toHaveCount(25);
  expect(await page.locator(".log-hours span").first().textContent()).toBe(
    "12 AM",
  );
  expect(await page.locator(".log-hours span").last().textContent()).toBe(
    "12 AM",
  );
  await addLog(page, "Sleep", "Sleep", "2026-10-07T23:00", "2026-10-08T07:00");
  await expect(page.locator(".log-block.log-sleep")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Adjust start of Sleep", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Adjust end of Sleep", exact: true }),
  ).toHaveCount(1);
  await addLog(
    page,
    "Meal",
    "Breakfast",
    "2026-10-08T07:00",
    "2026-10-08T07:30",
  );
  await addLog(
    page,
    "Exercise",
    "Walk",
    "2026-10-08T07:30",
    "2026-10-08T08:30",
  );
  await addLog(
    page,
    "Add logged item",
    "Reading",
    "2026-10-08T08:30",
    "2026-10-08T09:00",
  );
  await page.getByRole("button", { name: /Edit logged item Reading/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Activity name").fill("Reading a book");
  await page.keyboard.press("Escape");
  await page.mouse.click(12, 120);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Activity name")).toHaveValue(
    "Reading a book",
  );
  await dialog.getByLabel("End", { exact: true }).fill("2026-10-07T09:00");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog.getByRole("alert")).toContainText("end must be later");
  await dialog.getByLabel("End", { exact: true }).fill("2026-10-08T09:15");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await page.reload();
  expect((await read(page)).activityLog).toHaveLength(4);
  await page.getByRole("button", { name: "Next week", exact: true }).click();
  await expect(page.locator(".log-block")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Previous week", exact: true })
    .click();
  await expect(page.locator(".log-block")).toHaveCount(5);
  await page
    .getByRole("button", { name: /Edit logged item Reading a book/ })
    .click();
  await dialog
    .getByRole("button", { name: "Delete logged item", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Remove logged item", exact: true })
    .click();
  expect((await read(page)).activityLog).toHaveLength(3);
  expect((await read(page)).items).toHaveLength(2);
});

test("task completion follows the previous logged endpoint and then the previous task", async ({
  page,
}) => {
  const state = stateWithTasks();
  state.activityLog = [logged("Meal", "meal", 8, "10:00", "10:30")];
  await seed(page, state);
  await page.goto("/#/still/focus");
  await page.getByRole("button", { name: /Completed!/ }).click();
  await expect.poll(async () => (await read(page)).activityLog?.length).toBe(2);
  expect((await read(page)).activityLog?.[1]).toMatchObject({
    title: "Practice piano",
    category: "task",
    startedAt: iso(8, "10:30"),
    endedAt: iso(8, "12:00"),
  });
  await page.clock.setFixedTime(new Date(stamp(8, "12:45")));
  await page.getByRole("button", { name: /Completed!/ }).click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Log", exact: true })
    .click();
  await expect(page.locator(".log-block.log-task")).toHaveCount(2);
  expect((await read(page)).activityLog?.[2]).toMatchObject({
    title: "Answer email",
    startedAt: iso(8, "12:00"),
    endedAt: iso(8, "12:45"),
  });
});

test("first task completion asks for a start in Log without inventing elapsed time", async ({
  page,
}) => {
  await seed(page, stateWithTasks());
  await page.goto("/#/still/focus");
  await page.getByRole("button", { name: /Completed!/ }).click();
  await page.goto("/#/still/log");
  await page
    .getByRole("button", { name: /Practice piano.*Set start time/ })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Start", { exact: true })).toHaveValue("");
  await dialog.getByLabel("Start", { exact: true }).fill("2026-10-08T11:15");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".log-pending")).toHaveCount(0);
  await expect(page.locator(".log-block.log-task")).toHaveCount(1);
});

test("drag both endpoints, cancel a drag, and resize with the keyboard", async ({
  page,
}) => {
  const state = stateWithTasks();
  state.activityLog = [logged("Reading", "other", 8, "09:00", "10:00")];
  await seed(page, state);
  await page.goto("/#/still/log");
  await page.locator(".log-scroll").evaluate((el) => {
    el.scrollTop = 450;
  });
  async function dragHandle(edge: string, distance: number) {
    const handle = page.getByRole("button", {
      name: `Adjust ${edge} of Reading`,
      exact: true,
    });
    const box = await handle.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box!.x + box!.width / 2,
      box!.y + box!.height / 2 + distance,
      { steps: 8 },
    );
    await page.mouse.up();
  }
  await dragHandle("start", -32);
  await expect
    .poll(async () => (await read(page)).activityLog?.[0].startedAt)
    .toBe(iso(8, "08:30"));
  await dragHandle("end", 32);
  await expect
    .poll(async () => (await read(page)).activityLog?.[0].endedAt)
    .toBe(iso(8, "10:30"));
  const end = page.getByRole("button", {
    name: "Adjust end of Reading",
    exact: true,
  });
  await end.focus();
  await page.keyboard.press("Shift+ArrowDown");
  await expect
    .poll(async () => (await read(page)).activityLog?.[0].endedAt)
    .toBe(iso(8, "10:45"));
  const box = (await end.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 32);
  await end.dispatchEvent("pointercancel", { pointerId: 1 });
  await page.mouse.up();
  expect((await read(page)).activityLog?.[0].endedAt).toBe(iso(8, "10:45"));
  await page.reload();
  expect((await read(page)).activityLog?.[0].startedAt).toBe(iso(8, "08:30"));
});

for (const design of ["still", "ember", "orbit", "tide", "pop"]) {
  test(`${design}: narrow phone has reachable Log navigation and no page overflow`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    const state = stateWithTasks();
    state.activityLog = [logged("Breakfast", "meal", 8, "07:00", "07:15")];
    await seed(page, state);
    await page.goto(`/#/${design}/home`);
    await page
      .getByRole("navigation", { name: "Mobile navigation" })
      .getByRole("button", { name: "Log", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Log", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const timeline = page.locator(".log-scroll");
    expect(
      await timeline.evaluate((el) => el.scrollWidth > el.clientWidth),
    ).toBe(true);
    await page
      .getByRole("button", { name: /Edit logged item Breakfast/ })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(
      await page
        .getByRole("dialog")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
  });
}

test("logs survive private desktop Supabase save, a fresh browser, and reload", async ({
  page,
  browser,
}) => {
  let remote: { data: AppState; revision: number } = {
    data: createEmptyState(),
    revision: 7,
  };
  async function connect(target: Page) {
    await target.addInitScript(() =>
      localStorage.setItem(
        "elephant.piano-studio.connection.v1",
        "d".repeat(43),
      ),
    );
    await target.route("**/api/workspace", async (route) => {
      if (route.request().method() === "GET")
        return route.fulfill({ json: { workspace: remote } });
      const body = route.request().postDataJSON();
      expect(body.expectedRevision).toBe(remote.revision);
      remote = { data: body.data, revision: remote.revision + 1 };
      return route.fulfill({ json: { revision: remote.revision } });
    });
    await target.clock.setFixedTime(new Date(stamp(8, "12:00")));
    await target.goto("/#/still/log");
    await expect(
      target.getByRole("heading", { name: "Log", exact: true }),
    ).toBeVisible();
  }
  await connect(page);
  await addLog(page, "Sleep", "Sleep", "2026-10-07T23:00", "2026-10-08T07:00");
  await expect.poll(() => remote.data.activityLog?.length).toBe(1);
  await expect(
    page.getByText("Saved to Supabase", { exact: true }).first(),
  ).toBeVisible();
  const context = await browser.newContext({ timezoneId: "America/New_York" });
  try {
    const fresh = await context.newPage();
    await connect(fresh);
    await expect(fresh.locator(".log-block.log-sleep")).toHaveCount(2);
    await fresh.reload();
    await expect(fresh.locator(".log-block.log-sleep")).toHaveCount(2);
  } finally {
    await context.close();
  }
});

test("renaming preserves timestamp seconds and a very short block remains editable", async ({
  page,
}) => {
  const state = stateWithTasks();
  state.activityLog = [
    {
      ...logged("Short task", "task", 8, "10:00", "10:00"),
      startedAt: "2026-10-08T14:00:03.000Z",
      endedAt: "2026-10-08T14:00:17.000Z",
    },
  ];
  await seed(page, state);
  await page.goto("/#/still/log");
  await page
    .getByRole("button", { name: /Edit logged item Short task/ })
    .click();
  await page.getByLabel("Activity name").fill("Renamed task");
  await page.getByRole("button", { name: "Save changes" }).click();
  expect((await read(page)).activityLog?.[0]).toMatchObject({
    title: "Renamed task",
    startedAt: "2026-10-08T14:00:03.000Z",
    endedAt: "2026-10-08T14:00:17.000Z",
  });
});

test("touch handles adjust times on a phone without scrolling the page", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    timezoneId: "America/New_York",
  });
  try {
    const page = await context.newPage();
    const state = stateWithTasks();
    state.activityLog = [logged("Meal", "meal", 5, "07:00", "08:00")];
    await seed(page, state);
    await page.goto("/#/still/log");
    const handle = page.getByRole("button", {
      name: "Adjust end of Meal",
      exact: true,
    });
    await handle.scrollIntoViewIfNeeded();
    const box = (await handle.boundingBox())!;
    const cdp = await context.newCDPSession(page);
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y - 32 }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect
      .poll(async () => (await read(page)).activityLog?.[0].endedAt)
      .toBe(iso(5, "07:30"));
  } finally {
    await context.close();
  }
});
