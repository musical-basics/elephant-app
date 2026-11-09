import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  addItem,
  addProject,
  createEmptyState,
  updateProject,
} from "../src/lib/model";
import type { AppState } from "../src/lib/model";
import { saveDeadline, toggleDeadline } from "../src/lib/deadlines";

test.use({
  timezoneId: "America/New_York",
  viewport: { width: 1440, height: 1000 },
});
// Monday 9 November 2026, noon Eastern.
const NOW = new Date("2026-11-09T12:00:00-05:00");

async function seed(page: Page, state: AppState) {
  await page.clock.setFixedTime(NOW);
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

function workspace(): AppState {
  let state = addProject(createEmptyState(), "Kitchen remodel");
  state = addProject(state, "Garden");
  state = addProject(state, "Done project");
  const [kitchen, garden, done] = state.projects;
  state = addItem(state, "Measure the cabinets", kitchen.id);
  state = updateProject(state, kitchen.id, { dueDate: "2026-11-10" });
  state = updateProject(state, garden.id, {
    dueDate: "2026-12-20",
    status: "inactive",
  });
  state = updateProject(state, done.id, {
    dueDate: "2026-11-11",
    status: "completed",
  });
  state = saveDeadline(state, {
    title: "Renew passport",
    dueDate: "2026-11-14",
  });
  state = saveDeadline(state, {
    title: "File quarterly taxes",
    dueDate: "2026-11-06",
  });
  state = saveDeadline(state, {
    title: "Send the contract",
    dueDate: "2026-11-09",
  });
  state = saveDeadline(state, { title: "Old form", dueDate: "2026-11-02" });
  return toggleDeadline(
    state,
    state.deadlines!.at(-1)!.id,
    Date.parse("2026-11-02T15:00:00Z"),
  );
}
const panel = (page: Page) => page.getByRole("region", { name: "Deadlines" });
const due = (page: Page) => page.getByRole("region", { name: "Due this day" });

test("lists open deadlines and project due dates soonest first, flagging overdue ones", async ({
  page,
}) => {
  await seed(page, workspace());
  await page.goto("/#/still/calendar");
  await expect(panel(page).locator(".deadline-open")).toHaveText([
    "File quarterly taxes3 days overdue · Fri, Nov 6",
    "Send the contractDue today · Mon, Nov 9",
    "Kitchen remodelDue tomorrow · Tue, Nov 10 · Project",
    "Renew passportDue in 5 days · Sat, Nov 14",
    "GardenDue Dec 20 · Project",
  ]);
  await expect(panel(page).locator(".deadline-row.is-overdue")).toHaveText(
    /File quarterly taxes/,
  );
  await expect(panel(page)).not.toContainText("Done project");
  await expect(panel(page).locator(".deadline-completed summary")).toHaveText(
    "1 completed deadline",
  );
  await expect(
    page.getByRole("button", {
      name: "Monday, November 9, 2026, 1 deadline",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Friday, November 6, 2026, 1 deadline",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".calendar-legend")).toContainText("Deadline");
  // Today's deadline sits above the timeline.
  await expect(due(page)).toContainText("Send the contract");
  await expect(due(page)).toContainText("Deadline · Due today");
});

test("adds, edits, completes, reopens, and removes a deadline, and keeps it through a reload", async ({
  page,
}) => {
  await seed(page, workspace());
  await page.goto("/#/tide/calendar");
  await panel(page).getByRole("button", { name: "Add deadline" }).click();
  let sheet = page.getByRole("dialog", { name: "Set a deadline." });
  await expect(sheet.getByLabel("What’s due?")).toBeFocused();
  await expect(sheet.getByLabel("Due date")).toHaveValue("2026-11-09");
  await sheet.getByLabel("What’s due?").fill("Book flights");
  await sheet.getByLabel("Due date").fill("2026-11-20");
  await sheet.getByLabel("What’s due?").press("Enter");
  await expect(sheet).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: "Deadline added." }),
  ).toBeVisible();
  const row = panel(page).locator(".deadline-open", {
    hasText: "Book flights",
  });
  await expect(row).toHaveText("Book flightsDue in 11 days · Fri, Nov 20");

  await row.click();
  await expect(page.locator(".calendar-agenda h2")).toHaveText(
    "Friday, November 20, 2026",
  );
  await due(page)
    .getByRole("button", { name: "Edit deadline Book flights" })
    .click();
  sheet = page.getByRole("dialog", { name: "Edit deadline" });
  await sheet.getByLabel("What’s due?").fill("Book flights home");
  await sheet.getByRole("button", { name: "Save changes" }).click();
  await expect(due(page)).toContainText("Book flights home");

  await page.reload();
  await expect(
    panel(page).locator(".deadline-open", { hasText: "Book flights home" }),
  ).toBeVisible();
  await panel(page)
    .locator(".deadline-open", { hasText: "Book flights home" })
    .click();
  await due(page)
    .getByRole("button", { name: "Complete deadline Book flights home" })
    .click();
  await expect(due(page)).toContainText("Deadline · Completed");
  await expect(
    panel(page).locator(".deadline-open", { hasText: "Book flights home" }),
  ).toHaveCount(0);
  await expect(panel(page).locator(".deadline-completed summary")).toHaveText(
    "2 completed deadlines",
  );
  let saved = (await read(page)).deadlines!.find(
    (deadline) => deadline.title === "Book flights home",
  )!;
  expect(saved).toMatchObject({
    dueDate: "2026-11-20",
    completedAt: NOW.toISOString(),
  });

  await due(page)
    .getByRole("button", { name: "Reopen deadline Book flights home" })
    .click();
  await expect(due(page)).toContainText("Due in 11 days");
  saved = (await read(page)).deadlines!.find((d) => d.id === saved.id)!;
  expect(saved.completedAt).toBeNull();

  await due(page)
    .getByRole("button", { name: "Delete deadline Book flights home" })
    .click();
  const confirm = page.getByRole("dialog", { name: "Remove this deadline?" });
  await confirm.getByRole("button", { name: "Remove deadline" }).click();
  await expect(due(page)).toHaveCount(0);
  expect(
    (await read(page)).deadlines!.some((d) => d.title === "Book flights home"),
  ).toBe(false);

  // A completed deadline can be reopened from the panel too.
  await panel(page).locator(".deadline-completed summary").click();
  await panel(page)
    .getByRole("button", { name: "Reopen deadline Old form" })
    .click();
  await expect(panel(page).locator(".deadline-open").first()).toHaveText(
    "Old form7 days overdue · Mon, Nov 2",
  );
});

test("the Add item sheet offers a deadline, and the panel completes one", async ({
  page,
}) => {
  await seed(page, workspace());
  await page.goto("/#/orbit/focus");
  await page.getByRole("button", { name: "Add item" }).first().click();
  await page.getByRole("button", { name: "Add a deadline" }).click();
  const sheet = page.getByRole("dialog", { name: "Set a deadline." });
  await sheet.getByLabel("What’s due?").fill("Return library books");
  await sheet.getByLabel("Due date").fill("2026-11-12");
  await sheet.getByRole("button", { name: "Add deadline" }).click();
  await page.goto("/#/orbit/calendar");
  await panel(page)
    .getByRole("button", { name: "Complete deadline Return library books" })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Deadline completed." }),
  ).toBeVisible();
  await expect(panel(page).locator(".deadline-completed summary")).toHaveText(
    "2 completed deadlines",
  );
});

test("project due dates show read-only and open their project", async ({
  page,
}) => {
  await seed(page, workspace());
  await page.goto("/#/ember/calendar");
  await panel(page)
    .locator(".deadline-open", { hasText: "Kitchen remodel" })
    .click();
  await expect(due(page)).toContainText("Project due date · Due tomorrow");
  await expect(
    due(page).getByRole("button", { name: /Edit deadline|Delete deadline/ }),
  ).toHaveCount(0);
  await due(page)
    .getByRole("button", { name: "Open project Kitchen remodel" })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Project name" }),
  ).toHaveValue("Kitchen remodel");
});

test("deadlines fit a narrow phone in every design", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await seed(page, workspace());
  for (const design of ["still", "ember", "orbit", "tide", "pop"]) {
    await page.goto(`/#/${design}/calendar`);
    await expect(panel(page)).toBeVisible();
    const add = await panel(page)
      .getByRole("button", { name: "Add deadline" })
      .boundingBox();
    expect(add!.height).toBeGreaterThanOrEqual(44);
    for (const button of await panel(page)
      .locator(".deadline-check, .deadline-open")
      .all()) {
      const box = await button.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await panel(page).getByRole("button", { name: "Add deadline" }).click();
  await expect(
    page.getByRole("dialog", { name: "Set a deadline." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
