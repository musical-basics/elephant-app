import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createEmptyState, validateImport } from "../src/lib/model";
import type { AppState } from "../src/lib/model";
import type { DiaryEntry } from "../src/lib/diary";

test.use({
  timezoneId: "America/New_York",
  viewport: { width: 1440, height: 1080 },
});
const stamp = (day: number, time: string) =>
  `2026-10-${String(day).padStart(2, "0")}T${time}:00-04:00`;
const iso = (day: number, time: string) =>
  new Date(stamp(day, time)).toISOString();
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

test("writes timestamped entries, shows them by calendar day and in a searchable list, edits and deletes", async ({
  page,
}) => {
  await seed(page, createEmptyState());
  await page.goto("/#/still/diary");
  await expect(
    page.getByRole("heading", { name: "Diary", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: "Diary" }),
  ).toHaveAttribute("aria-current", "page");

  const composer = page.getByLabel("New diary entry");
  await expect(
    page.getByRole("button", { name: "Save entry", exact: true }),
  ).toBeDisabled();
  await composer.fill("Morning pages.\nA calm start.");
  await page.getByRole("button", { name: "Save entry", exact: true }).click();
  await expect(composer).toHaveValue("");
  await expect(page.getByText("Entry saved at 12:00 PM.")).toBeVisible();
  const agenda = page.getByRole("region", { name: "Diary entries" });
  await expect(
    agenda.getByRole("heading", { name: "Thursday, October 8, 2026" }),
  ).toBeVisible();
  await expect(agenda.locator(".diary-text")).toHaveText(
    "Morning pages.\nA calm start.",
  );
  await expect(agenda.locator(".diary-note time")).toHaveText("12:00 PM");
  expect((await read(page)).diary).toEqual([
    {
      id: expect.any(String),
      text: "Morning pages.\nA calm start.",
      writtenAt: iso(8, "12:00"),
      createdAt: iso(8, "12:00"),
    },
  ]);

  // Ctrl+Enter saves; plain Enter keeps writing.
  await page.clock.setFixedTime(new Date(stamp(8, "12:30")));
  await composer.fill("Lunch with Sam");
  await composer.press("Enter");
  await composer.press("Control+Enter");
  await expect(composer).toHaveValue("");
  await expect(agenda.locator(".diary-text")).toHaveText([
    "Lunch with Sam",
    "Morning pages.\nA calm start.",
  ]);

  await page
    .getByRole("button", { name: "Tuesday, October 6, 2026", exact: true })
    .click();
  await expect(agenda.getByText("A blank page.")).toBeVisible();
  await agenda
    .getByRole("button", { name: "Write an entry for this day" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Date and time")).toHaveValue(
    "2026-10-06T12:30",
  );
  await dialog.getByLabel("Entry").fill("Rainy walk, finished a book.");
  await dialog.getByLabel("Date and time").fill("2026-10-06T20:15");
  await dialog.getByRole("button", { name: "Save entry" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(agenda.locator(".diary-note time")).toHaveText("8:15 PM");
  await expect(
    page.getByRole("button", {
      name: "Tuesday, October 6, 2026, 1 diary entry",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Thursday, October 8, 2026, 2 diary entries",
    }),
  ).toBeVisible();

  await page.getByRole("tab", { name: /List/ }).click();
  await expect(page).toHaveURL(/#\/still\/diary\/list$/);
  await expect(page.locator(".diary-day h2")).toHaveText([
    "Thursday, October 8, 2026",
    "Tuesday, October 6, 2026",
  ]);
  await expect(page.locator(".diary-text")).toHaveText([
    "Lunch with Sam",
    "Morning pages.\nA calm start.",
    "Rainy walk, finished a book.",
  ]);
  await page.getByLabel("Search diary entries").fill("book walk");
  await expect(page.locator(".diary-text")).toHaveText([
    "Rainy walk, finished a book.",
  ]);
  await page.getByLabel("Search diary entries").fill("nothing like this");
  await expect(page.getByText("No matching entries.")).toBeVisible();
  await page.getByLabel("Search diary entries").fill("");

  await page
    .getByRole("button", { name: /^Edit diary entry from .*8:15/ })
    .click();
  await dialog.getByLabel("Entry").fill("Rainy walk. Finished the novel.");
  await dialog.getByLabel("Date and time").fill("2026-10-07T07:05");
  await page.mouse.click(5, 5);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".diary-day h2")).toHaveText([
    "Thursday, October 8, 2026",
    "Wednesday, October 7, 2026",
  ]);
  await expect(
    page.locator(".diary-day").last().locator(".diary-note small"),
  ).toHaveText("Edited");

  await page.reload();
  await expect(page.locator(".diary-text")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Wednesday, October 7, 2026", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/still\/diary$/);
  await expect(
    page
      .getByRole("region", { name: "Diary entries" })
      .getByRole("heading", { name: "Wednesday, October 7, 2026" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Edit diary entry from / }).click();
  await dialog.getByRole("button", { name: "Delete diary entry" }).click();
  await dialog.getByRole("button", { name: "Keep entry" }).click();
  await dialog.getByRole("button", { name: "Delete diary entry" }).click();
  await dialog
    .getByRole("button", { name: "Delete entry", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(agenda.getByText("A blank page.")).toBeVisible();
  const saved = (await read(page)).diary!;
  expect(saved.map((entry) => entry.text).sort()).toEqual([
    "Lunch with Sam",
    "Morning pages.\nA calm start.",
  ]);
});

test("an unsent draft survives leaving the diary", async ({ page }) => {
  await seed(page, createEmptyState());
  await page.goto("/#/still/diary");
  await page.getByLabel("New diary entry").fill("Half a thought");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Log" })
    .click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Diary" })
    .click();
  await expect(page.getByLabel("New diary entry")).toHaveValue(
    "Half a thought",
  );
  expect((await read(page)).diary).toBeUndefined();
});

test("the list paginates long diaries and every design fits a 320px phone", async ({
  page,
}) => {
  const diary: DiaryEntry[] = Array.from({ length: 30 }, (_, index) => ({
    id: `note-${index}`,
    text: `Entry ${index + 1} ${index === 0 ? "x".repeat(400) : ""}`,
    writtenAt: iso(
      1 + (index % 7),
      `${String(8 + (index % 12)).padStart(2, "0")}:00`,
    ),
    createdAt: iso(8, "12:00"),
  }));
  await seed(page, { ...createEmptyState(), diary });
  await page.goto("/#/still/diary/list");
  await expect(page.locator(".diary-note")).toHaveCount(25);
  await expect(page.getByText("1–25 of 30 entries")).toBeVisible();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.locator(".diary-note")).toHaveCount(5);
  await expect(page.getByText("Page 2 of 2")).toBeVisible();

  await page.setViewportSize({ width: 320, height: 740 });
  for (const design of ["still", "ember", "orbit", "tide", "pop"]) {
    for (const view of ["", "/list"]) {
      await page.goto(`/#/${design}/diary${view}`);
      await expect(page.locator(".diary-composer")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        `${design}/diary${view}`,
      ).toBe(true);
    }
  }
  // The bottom bar keeps seven 44px targets; the header opens the diary.
  const mobileNav = page.getByRole("navigation", { name: "Mobile navigation" });
  await expect(mobileNav.getByRole("button")).toHaveCount(7);
  await page.goto("/#/pop/home");
  await page
    .getByRole("button", { name: "Diary", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/#\/pop\/diary$/);
  await expect(
    page.getByRole("banner").getByRole("button", { name: "Diary" }),
  ).toHaveAttribute("aria-current", "page");
});

test("sort order applies to both views and is remembered in the workspace", async ({
  page,
}) => {
  const note = (id: string, day: number, time: string): DiaryEntry => ({
    id,
    text: id,
    writtenAt: iso(day, time),
    createdAt: iso(day, time),
  });
  await seed(page, {
    ...createEmptyState(),
    diary: [
      note("Breakfast", 8, "08:00"),
      note("Evening", 8, "20:00"),
      note("Last week", 1, "09:00"),
      note("Lunch", 8, "12:00"),
    ],
  });
  await page.goto("/#/still/diary");
  const sort = page.getByLabel("Sort diary entries");
  const agenda = page.getByRole("region", { name: "Diary entries" });
  await expect(sort).toHaveValue("newest");
  await expect(agenda.locator(".diary-text")).toHaveText([
    "Evening",
    "Lunch",
    "Breakfast",
  ]);
  await sort.selectOption("oldest");
  await expect(agenda.locator(".diary-text")).toHaveText([
    "Breakfast",
    "Lunch",
    "Evening",
  ]);
  expect((await read(page)).settings).toEqual({
    showMasterList: false,
    diarySort: "oldest",
  });
  await page.getByRole("tab", { name: /List/ }).click();
  await expect(page.locator(".diary-day h2")).toHaveText([
    "Thursday, October 1, 2026",
    "Thursday, October 8, 2026",
  ]);
  await expect(page.locator(".diary-text")).toHaveText([
    "Last week",
    "Breakfast",
    "Lunch",
    "Evening",
  ]);

  // A new entry lands at the end of an oldest-first list.
  await page.clock.setFixedTime(new Date(stamp(8, "21:00")));
  await page.getByLabel("New diary entry").fill("Night");
  await page.getByRole("button", { name: "Save entry", exact: true }).click();
  await expect(page.locator(".diary-text").last()).toHaveText("Night");

  await page.reload();
  await expect(page.getByLabel("Sort diary entries")).toHaveValue("oldest");
  await expect(page.locator(".diary-text").first()).toHaveText("Last week");
  await page.getByLabel("Sort diary entries").selectOption("newest");
  await expect(page.locator(".diary-text")).toHaveText([
    "Night",
    "Evening",
    "Lunch",
    "Breakfast",
    "Last week",
  ]);
  expect((await read(page)).settings.diarySort).toBe("newest");
});

test("diary entries and the sort preference save to the connected Supabase workspace", async ({
  page,
}) => {
  const key = "d".repeat(43);
  const writes: { data: AppState; expectedRevision: number }[] = [];
  let revision = 7;
  await page.route("**/api/workspace", async (route) => {
    expect(route.request().headers()["x-elephant-key"]).toBe(key);
    if (route.request().method() === "PUT") {
      writes.push(route.request().postDataJSON());
      return route.fulfill({ json: { revision: ++revision } });
    }
    return route.fulfill({
      json: { workspace: { data: createEmptyState(), revision } },
    });
  });
  await page.clock.setFixedTime(new Date(stamp(8, "12:00")));
  await page.addInitScript((key) => {
    localStorage.setItem("elephant.piano-studio.connection.v1", key);
  }, key);
  await page.goto("/#/still/diary");
  await expect(page.getByText("Supabase workspace")).toBeVisible();
  await page.getByLabel("New diary entry").fill("Synced thought");
  await page.getByRole("button", { name: "Save entry", exact: true }).click();
  await page.getByLabel("Sort diary entries").selectOption("oldest");
  await expect
    .poll(() => {
      const last = writes.at(-1)?.data;
      return last && [last.diary?.map((entry) => entry.text), last.settings];
    })
    .toEqual([
      ["Synced thought"],
      { showMasterList: false, diarySort: "oldest" },
    ]);
  const last = writes.at(-1)!;
  expect(last.expectedRevision).toBe(revision - 1);
  // The private API validates with the same rules before writing to Supabase.
  expect(validateImport(last.data).diary).toEqual([
    {
      id: expect.any(String),
      text: "Synced thought",
      writtenAt: iso(8, "12:00"),
      createdAt: iso(8, "12:00"),
    },
  ]);
});

test("the entry editor resizes by dragging its corner and remembers the size in this browser", async ({
  page,
}) => {
  await seed(page, {
    ...createEmptyState(),
    diary: [
      {
        id: "long",
        text: "A long entry.\n".repeat(40),
        writtenAt: iso(8, "09:00"),
        createdAt: iso(8, "09:00"),
      },
    ],
  });
  await page.goto("/#/still/diary");
  const edit = page.getByRole("button", { name: /^Edit diary entry from / });
  const dialog = page.getByRole("dialog");
  const grip = dialog.getByRole("button", { name: "Resize dialog" });
  const entry = dialog.getByLabel("Entry");
  await edit.click();
  const before = (await dialog.boundingBox())!;
  const textBefore = (await entry.boundingBox())!;
  expect(before.width).toBe(490);
  const handle = (await grip.boundingBox())!;
  const x = handle.x + handle.width / 2,
    y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 150, y + 100, { steps: 5 });
  await page.mouse.up();
  const after = (await dialog.boundingBox())!;
  expect(after.width).toBeCloseTo(before.width + 300, 0);
  expect(after.height).toBeCloseTo(before.height + 200, 0);
  // The corner follows the pointer, and the entry grows to fill the dialog.
  expect(after.x + after.width).toBeCloseTo(before.x + before.width + 150, 0);
  expect((await entry.boundingBox())!.height).toBeCloseTo(
    textBefore.height + 200,
    0,
  );

  await grip.focus();
  await page.keyboard.press("ArrowRight");
  expect((await dialog.boundingBox())!.width).toBeCloseTo(after.width + 40, 0);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await page.reload();
  await edit.click();
  expect((await dialog.boundingBox())!.width).toBeCloseTo(after.width + 40, 0);
  expect((await dialog.boundingBox())!.height).toBeCloseTo(after.height, 0);

  // A huge drag stops at the window edge.
  const corner = (await grip.boundingBox())!;
  await page.mouse.move(corner.x + 5, corner.y + 5);
  await page.mouse.down();
  await page.mouse.move(corner.x + 2000, corner.y + 2000, { steps: 3 });
  await page.mouse.up();
  expect((await dialog.boundingBox())!.width).toBe(1440 - 32);
  expect((await dialog.boundingBox())!.height).toBe(1080 - 48);

  await grip.dblclick();
  expect((await dialog.boundingBox())!.width).toBe(490);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await page.reload();
  await edit.click();
  expect((await dialog.boundingBox())!.width).toBe(490);
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // Phones keep the full-width bottom sheet.
  await page.setViewportSize({ width: 390, height: 844 });
  await edit.click();
  await expect(grip).toBeHidden();
  expect((await dialog.boundingBox())!.width).toBe(390);
});
