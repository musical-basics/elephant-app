import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createEmptyState } from "../src/lib/model";
import type { AppState, Item, Project, QueueSlot } from "../src/lib/model";
const timestamp = "2026-10-08T12:00:00.000Z";
const cacheKey = "elephant.workspace.local.v1";
function fixture(): AppState {
  const project = (id: string): Project => ({
    id,
    name: id === "P" ? "Piano practice" : "Other project",
    status: "active",
    createdAt: timestamp,
    dueDate: null,
    completedAt: null,
  });
  const item = (id: string, projectId: string | null): Item => ({
    id,
    title: id,
    projectId,
    createdAt: timestamp,
    completedAt: null,
  });
  const p = (id: string, projectId: string): QueueSlot => ({
    id,
    kind: "project",
    projectId,
    createdAt: timestamp,
  });
  const e = (itemId: string): QueueSlot => ({
    id: `slot-${itemId}`,
    kind: "errand",
    itemId,
    createdAt: timestamp,
  });
  return {
    ...createEmptyState(),
    settings: { showMasterList: true },
    projects: [project("P"), project("Q")],
    items: [
      item("P1", "P"),
      item("P2", "P"),
      item("P3", "P"),
      item("Q1", "Q"),
      item("Q2", "Q"),
      ...["E1", "E2", "E3", "E4", "E5", "E6"].map((id) => item(id, null)),
    ],
    queue: [
      e("E1"),
      p("p1", "P"),
      p("p2", "P"),
      p("q1", "Q"),
      e("E2"),
      p("p3", "P"),
      e("E3"),
      p("q2", "Q"),
      e("E4"),
      e("E5"),
      e("E6"),
    ],
  };
}
async function seed(page: Page, state = fixture()) {
  await page.addInitScript(
    ({ key, state }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(
          key,
          JSON.stringify({
            storageVersion: 1,
            state,
            revision: null,
            dirty: false,
          }),
        );
    },
    { key: cacheKey, state },
  );
}
const read = (page: Page): Promise<AppState> =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!).state,
    cacheKey,
  );
async function start(page: Page, between: number) {
  await page.getByRole("button", { name: "Focus mode", exact: true }).click();
  await page.getByLabel("Focus project", { exact: true }).selectOption("P");
  await page.getByRole("radio", { name: new RegExp(`^${between}`) }).check();
  await page
    .getByRole("button", { name: "Start focus mode", exact: true })
    .click();
}
const task = (page: Page, id: string) =>
  expect(page.getByRole("heading", { name: id, exact: true })).toBeVisible();

for (const [between, expected] of [
  [0, ["P1", "P2", "P3"]],
  [1, ["P1", "E1", "P2", "Q1", "P3"]],
  [2, ["P1", "E1", "Q1", "P2", "E2", "E3", "P3"]],
  [3, ["P1", "E1", "Q1", "E2", "P2", "E3", "Q2", "E4", "P3"]],
] as const) {
  test(`spacing ${between} follows the full requested cycle and ends when project tasks are done`, async ({
    page,
  }) => {
    await seed(page);
    await page.goto("/#/still/focus");
    await task(page, "E1");
    await start(page, between);
    expect((await read(page)).queue).toEqual(fixture().queue);
    for (const id of expected) {
      await task(page, id);
      await page.getByRole("button", { name: /Completed!/ }).click();
    }
    await expect(
      page.getByRole("button", { name: "Stop focus mode" }),
    ).toHaveCount(0);
    expect((await read(page)).focusMode).toBeNull();
    expect(
      (await read(page)).activityLog?.map((entry) => entry.taskId),
    ).toEqual(expected);
  });
}

test("project shortcut, protected setup, changing spacing, master list badge, and stopping preserve queue order", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/#/still/project/P");
  await page.getByRole("button", { name: "Focus on this project" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Focus project", { exact: true })).toHaveValue(
    "P",
  );
  await page.getByRole("radio", { name: /^2/ }).check();
  await page.keyboard.press("Escape");
  await page.mouse.click(5, 120);
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await read(page)).focusMode).toBeUndefined();
  await page.getByRole("button", { name: "Focus on this project" }).click();
  await page.getByRole("button", { name: "Start focus mode" }).click();
  await task(page, "P1");
  await page.goto("/#/still/queue");
  await expect(page.locator(".queue-row strong")).toHaveText([
    "E1",
    "P1",
    "P2",
    "Q1",
    "E2",
    "P3",
    "E3",
    "Q2",
    "E4",
    "E5",
    "E6",
  ]);
  await expect(
    page.locator(".queue-row").filter({ has: page.locator(".now-badge") }),
  ).toContainText("P1");
  await page.goto("/#/still/focus");
  await page.getByRole("button", { name: "Change focus" }).click();
  await page.getByRole("radio", { name: /^3/ }).check();
  await page.getByRole("button", { name: "Save focus mode" }).click();
  await page.getByRole("button", { name: /Completed!/ }).click();
  await task(page, "E1");
  await expect(page.getByRole("region", { name: "Focus mode" })).toContainText(
    "3 master-list items before returning",
  );
  await page.reload();
  await task(page, "E1");
  const before = await read(page);
  await page.getByRole("button", { name: "Stop focus mode" }).click();
  expect((await read(page)).queue).toEqual(before.queue);
  expect((await read(page)).items).toEqual(before.items);
  await task(page, "E1");
});

test("Take a bite, edit, and timed completion operate on the chosen project without advancing on cancellation", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date(timestamp));
  await seed(page);
  await page.goto("/#/still/focus");
  await start(page, 1);
  await page.getByRole("button", { name: "Edit P1", exact: true }).click();
  await page.getByLabel("Item name").fill("Practice");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("button", { name: /Take a bite/ }).click();
  await page.getByLabel(/What can you do right now/).fill("Scales");
  await page.getByLabel(/What will you do after that/).fill("Repertoire");
  await page
    .getByRole("button", { name: "Make it smaller", exact: true })
    .click();
  await task(page, "Scales");
  await page.getByRole("button", { name: "Add timer", exact: true }).click();
  await page.getByRole("button", { name: "Start timer", exact: true }).click();
  await page.clock.setFixedTime(new Date(Date.parse(timestamp) + 65_000));
  await page.getByRole("button", { name: /Completed!/ }).click();
  await page.getByRole("button", { name: "Keep working", exact: true }).click();
  expect((await read(page)).focusMode?.remaining).toBe(0);
  await page.getByRole("button", { name: /Completed!/ }).click();
  await page
    .getByRole("button", { name: "Save time & complete", exact: true })
    .click();
  await task(page, "E1");
  expect(
    (await read(page)).items.find((item) => item.id === "P1")?.timeSpentSeconds,
  ).toBe(65);
  await page.getByRole("button", { name: /Completed!/ }).click();
  await task(page, "Repertoire");
});

for (const design of ["still", "ember", "orbit", "tide", "pop"]) {
  test(`${design}: focus setup and active controls work on a narrow phone`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await seed(page);
    await page.goto(`/#/${design}/focus`);
    await start(page, 2);
    await task(page, "P1");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const stop = await page
      .getByRole("button", { name: "Stop focus mode" })
      .boundingBox();
    expect(stop!.height).toBeGreaterThanOrEqual(44);
    await page.getByRole("button", { name: "Change focus" }).click();
    expect(
      await page
        .getByRole("dialog")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: /Completed!/ }).click();
    await task(page, "E1");
  });
}

test("focus cycle progress is included in backups and follows the private workspace across devices", async ({
  page,
  browser,
}) => {
  let remote = { data: fixture(), revision: 9 };
  async function connect(page: Page) {
    await page.addInitScript(() =>
      localStorage.setItem(
        "elephant.piano-studio.connection.v1",
        "d".repeat(43),
      ),
    );
    await page.route("**/api/workspace", async (route) => {
      if (route.request().method() === "GET")
        return route.fulfill({ json: { workspace: remote } });
      const body = route.request().postDataJSON();
      expect(body.expectedRevision).toBe(remote.revision);
      remote = { data: body.data, revision: remote.revision + 1 };
      return route.fulfill({ json: { revision: remote.revision } });
    });
    await page.goto("/#/still/focus");
  }
  await connect(page);
  await start(page, 2);
  await page.getByRole("button", { name: /Completed!/ }).click();
  await page.getByRole("button", { name: /Completed!/ }).click();
  await expect.poll(() => remote.data.focusMode?.remaining).toBe(1);
  const context = await browser.newContext();
  try {
    const fresh = await context.newPage();
    await connect(fresh);
    await task(fresh, "Q1");
    await fresh.reload();
    await task(fresh, "Q1");
    await fresh.goto("/#/still/settings");
    const download = fresh.waitForEvent("download");
    await fresh
      .getByRole("button", { name: "Download backup", exact: true })
      .click();
    const path = await (await download).path();
    const backup = JSON.parse(await readFile(path!, "utf8"));
    expect(backup.focusMode).toEqual({
      projectId: "P",
      between: 2,
      remaining: 1,
    });
    await fresh.goto("/#/still/focus");
    await fresh.getByRole("button", { name: /Completed!/ }).click();
    await task(fresh, "P2");
    await expect.poll(() => remote.data.focusMode?.remaining).toBe(0);
  } finally {
    await context.close();
  }
});
