import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import type { AppState } from "../src/lib/model";

test.use({ viewport: { width: 320, height: 844 } });

const timestamp = "2026-10-05T16:00:00Z";
const projectId = "one-step-project";
const fixture: AppState = {
  version: 1,
  profile: { name: "" },
  settings: { showMasterList: true },
  projects: [
    {
      id: projectId,
      name: "Keep this project open",
      status: "active",
      createdAt: timestamp,
      dueDate: null,
      completedAt: null,
    },
  ],
  items: [
    {
      id: "last-step",
      projectId,
      title: "Finish the current step",
      createdAt: timestamp,
      completedAt: null,
    },
    ...["First errand", "Second errand"].map((title, index) => ({
      id: `errand-${index}`,
      projectId: null,
      title,
      createdAt: timestamp,
      completedAt: null,
    })),
  ],
  queue: [
    { id: "project-slot", kind: "project", projectId, createdAt: timestamp },
    ...[0, 1].map((index) => ({
      id: `errand-slot-${index}`,
      kind: "errand" as const,
      itemId: `errand-${index}`,
      createdAt: timestamp,
    })),
  ],
};

async function seed(page: Page, design = "still") {
  await page.clock.setFixedTime(new Date(timestamp));
  await page.addInitScript((state) => {
    if (!localStorage.getItem("elephant.workspace.local.v1")) {
      localStorage.setItem(
        "elephant.workspace.local.v1",
        JSON.stringify({
          storageVersion: 1,
          state,
          revision: null,
          dirty: false,
        }),
      );
    }
  }, fixture);
  await page.goto(`/#/${design}/focus`);
}

const readState = (page: Page): Promise<AppState> =>
  page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("elephant.workspace.local.v1")!).state,
  );

async function completeCurrent(page: Page) {
  await page.getByRole("button", { name: /Completed!/ }).click();
}

async function reachPlaceholder(page: Page) {
  await completeCurrent(page);
  await completeCurrent(page);
  await completeCurrent(page);
  await expect(
    page.getByRole("heading", {
      name: "What’s next for this project?",
      exact: true,
    }),
  ).toBeVisible();
}

for (const design of ["still", "ember", "orbit", "tide", "pop"]) {
  test(`${design}: completing the last project step appends one editable blank on mobile`, async ({
    page,
  }) => {
    await seed(page, design);
    await completeCurrent(page);
    await expect(
      page.getByRole("heading", { name: "First errand", exact: true }),
    ).toBeVisible();
    const after = await readState(page);
    const placeholders = after.items.filter((item) => item.isPlaceholder);
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0]).toMatchObject({
      projectId,
      title: "",
      completedAt: null,
    });
    expect(after.projects[0].status).toBe("active");
    expect(after.queue.map((slot) => slot.kind)).toEqual([
      "errand",
      "errand",
      "project",
    ]);
    expect(after.queue.at(-1)).toMatchObject({ kind: "project", projectId });
    expect(after.items.filter((item) => item.completedAt)).toHaveLength(1);

    await completeCurrent(page);
    await completeCurrent(page);
    await expect(
      page.getByRole("heading", {
        name: "What’s next for this project?",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("BLANK PLACEHOLDER", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Completed!/ })).toHaveCount(
      0,
    );
    await expect(page.locator(".focus-timer, .focus-timer-invite")).toHaveCount(
      0,
    );
    for (const name of ["Add a task", "Complete project"]) {
      const button = page.getByRole("button", { name: new RegExp(`^${name}`) });
      await expect(button).toBeVisible();
      const bounds = await button.boundingBox();
      expect(bounds!.width).toBeGreaterThanOrEqual(44);
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.reload();
    await expect(
      page.getByRole("heading", {
        name: "What’s next for this project?",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (await readState(page)).items.filter((item) => item.isPlaceholder),
    ).toHaveLength(1);
    await page
      .getByRole("button", { name: "View project", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Edit placeholder", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Blank placeholder", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Add a task here, or mark this project complete.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page
        .locator(".project-items")
        .getByRole("button", { name: /^Duplicate / }),
    ).toHaveCount(0);
    await expect(
      page.locator(".project-items").getByRole("button", { name: /^Delete / }),
    ).toHaveCount(0);
    await page.goto(`/#/${design}/completed`);
    await expect(page.locator(".completed-row")).toHaveCount(3);
    await expect(
      page.getByText("Blank placeholder", { exact: true }),
    ).toHaveCount(0);
  });
}

test("Do now can fill a blank with a project task using Enter", async ({
  page,
}) => {
  await seed(page);
  await reachPlaceholder(page);
  await page.getByRole("button", { name: /^Add a task/ }).click();
  const input = page.getByLabel("What would you like to do?", { exact: true });
  await input.fill("The next real step");
  await input.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "The next real step", exact: true }),
  ).toBeVisible();
  const state = await readState(page);
  expect(state.items.filter((item) => item.isPlaceholder)).toHaveLength(0);
  expect(state.items.filter((item) => !item.completedAt)).toEqual([
    expect.objectContaining({ title: "The next real step", projectId }),
  ]);
  expect(state.queue).toHaveLength(1);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "The next real step", exact: true }),
  ).toBeVisible();
});

test("the project item editor fills the placeholder without changing its queue position", async ({
  page,
}) => {
  await seed(page);
  await completeCurrent(page);
  const before = await readState(page);
  await page.goto(`/#/still/project/${projectId}`);
  await page
    .getByRole("button", { name: "Edit placeholder", exact: true })
    .click();
  const input = page.getByLabel("Item name", { exact: true });
  await expect(input).toHaveValue("");
  await input.fill("Plan the follow-up");
  await input.press("Shift+Enter");
  await input.pressSequentially("Then gather supplies");
  await input.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const after = await readState(page);
  expect(after.items.filter((item) => item.isPlaceholder)).toHaveLength(0);
  expect(
    after.items.find(
      (item) => item.id === before.items.find((item) => item.isPlaceholder)!.id,
    ),
  ).toMatchObject({
    title: "Plan the follow-up\nThen gather supplies",
    completedAt: null,
    projectId,
  });
  expect(after.queue).toEqual(before.queue);
  await page.goto("/#/still/focus");
  await expect(
    page.getByRole("heading", { name: "First errand", exact: true }),
  ).toBeVisible();
});

test("closing an empty project does not record the placeholder as completed work", async ({
  page,
}) => {
  await seed(page);
  await reachPlaceholder(page);
  await page.getByRole("button", { name: /^Complete project/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Keep project open", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "What’s next for this project?",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Complete project/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Mark project complete", exact: true })
    .click();
  const state = await readState(page);
  expect(state.projects[0].status).toBe("completed");
  expect(state.projects[0].completedAt).toBeTruthy();
  expect(state.items).toHaveLength(3);
  expect(
    state.items.every((item) => item.completedAt && !item.isPlaceholder),
  ).toBe(true);
  expect(state.queue).toHaveLength(0);
  await page.goto("/#/still/completed");
  await expect(page.locator(".completed-row")).toHaveCount(3);
  await page.goto("/#/still/analytics");
  await expect(page.locator(".analytics-total strong")).toHaveText(["3", "3"]);
  await page.reload();
  expect((await readState(page)).items).toEqual(state.items);
});

test("blank placeholders survive JSON backup and restore without inflating analytics", async ({
  page,
}) => {
  await seed(page);
  await completeCurrent(page);
  await page.goto("/#/still/analytics");
  await expect(page.locator(".analytics-total strong")).toHaveText(["1", "3"]);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const original = await readState(page);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download JSON backup/ }).click();
  const backupPath = await (await downloaded).path();
  expect(backupPath).toBeTruthy();
  expect(JSON.parse(await readFile(backupPath!, "utf8"))).toEqual(original);
  await page
    .getByRole("button", { name: "Reset workspace", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reset everything", exact: true })
    .click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Import an Elephant backup").setInputFiles(backupPath!);
  await page
    .getByRole("button", { name: "Replace current data", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await readState(page)).toEqual({
    ...original,
    focusMode: original.focusMode ?? null,
    diary: original.diary ?? [],
  });
  await page.reload();
  expect(await readState(page)).toEqual({
    ...original,
    focusMode: original.focusMode ?? null,
    diary: original.diary ?? [],
  });
  await page.goto(`/#/still/project/${projectId}`);
  await expect(
    page.getByRole("button", { name: "Edit placeholder", exact: true }),
  ).toBeVisible();
});

test("putting the last completed project step back replaces its blank and returns the task to the front", async ({
  page,
}) => {
  await seed(page);
  await completeCurrent(page);
  await page.goto("/#/still/completed");
  await page
    .getByRole("button", {
      name: "Put back Finish the current step",
      exact: true,
    })
    .click();
  const state = await readState(page);
  expect(state.items.filter((item) => item.isPlaceholder)).toHaveLength(0);
  expect(
    state.items.find((item) => item.id === "last-step")?.completedAt,
  ).toBeNull();
  expect(state.projects[0].status).toBe("active");
  expect(state.queue[0]).toMatchObject({ kind: "project", projectId });
  expect(state.queue.filter((slot) => slot.kind === "project")).toHaveLength(1);
  await page.goto("/#/still/focus");
  await expect(
    page.getByRole("heading", { name: "Finish the current step", exact: true }),
  ).toBeVisible();
});
