import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.use({ viewport: { width: 390, height: 844 } });

for (const design of ["still", "ember", "orbit", "tide", "pop"]) {
  test(`${design}: put a completed item back at the front of Do now on a narrow phone`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    const title = "Write a few ideas for Sunday dinner";
    await page.goto(`/#/${design}/focus`);
    await page.getByRole("button", { name: /Completed!/ }).click();
    await expect(
      page.getByRole("heading", { name: "Water the plants", exact: true }),
    ).toBeVisible();
    await page.goto(`/#/${design}/completed`);
    const putBack = page.getByRole("button", {
      name: `Put back ${title}`,
      exact: true,
    });
    await expect(putBack).toBeVisible();
    const bounds = await putBack.boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await putBack.click();
    await expect(page.locator(".completed-row")).toHaveCount(0);
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Item put back at the front of Do now." }),
    ).toBeVisible();
    await page
      .getByRole("navigation", { name: "Mobile navigation" })
      .getByRole("button", { name: "Do now", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Completed!/ }).click();
    await expect(
      page.getByRole("heading", { name: "Water the plants", exact: true }),
    ).toBeVisible();
  });
}

test("putting back an errand preserves other completed items and the rest of the queue", async ({
  page,
}) => {
  await page.goto("/#/still/focus");
  await page.getByRole("button", { name: /Completed!/ }).click();
  await expect(
    page.getByRole("heading", { name: "Water the plants", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Completed!/ }).click();
  await page.goto("/#/still/queue");
  await expect(page.locator(".queue-row").first()).toBeVisible();
  const before = await page.locator(".queue-row strong").allTextContents();
  await page.goto("/#/still/completed");
  await page
    .getByRole("button", { name: "Put back Water the plants", exact: true })
    .click();
  await expect(page.locator(".completed-row strong")).toHaveText(
    "Write a few ideas for Sunday dinner",
  );
  await page.goto("/#/still/queue");
  await expect(page.locator(".queue-row strong")).toHaveText([
    "Water the plants",
    ...before,
  ]);
  await page.goto("/#/still/focus");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Water the plants", exact: true }),
  ).toBeVisible();
});

for (const design of ["still", "ember", "orbit", "tide", "pop"]) {
  test(`${design}: projects stay active after the last item and complete only when marked`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(`/#/${design}/settings`);
    await page
      .getByRole("button", { name: "Reset workspace", exact: true })
      .click();
    await page.getByRole("button", { name: "Reset everything" }).click();
    await page.goto(`/#/${design}/projects`);
    await page
      .locator(".page-heading")
      .getByRole("button", { name: "Add project", exact: true })
      .click();
    await page
      .getByLabel("Project name", { exact: true })
      .fill("A finished project");
    await page.getByRole("button", { name: "Create project" }).click();
    const projectUrl = page.url();
    const addStep = async (title: string) => {
      await page.getByRole("button", { name: "Add a little step" }).click();
      await page.getByLabel("What would you like to do?").fill(title);
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Add item", exact: true })
        .click();
    };
    await addStep("One final step");
    await page.goto(`/#/${design}/focus`);
    await page.getByRole("button", { name: /Completed!/ }).click();
    await page.goto(`/#/${design}/projects`);
    await page
      .getByRole("button", {
        name: "Open project A finished project",
        exact: true,
      })
      .click();
    await page.reload();
    await expect(
      page.getByText("ACTIVE PROJECT", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".project-item")).toHaveCount(0);
    await expect(page.locator(".project-empty-note")).toContainText(
      "Add more whenever you’re ready",
    );
    await addStep("Another step I still need");
    await page.goto(`/#/${design}/focus`);
    await expect(
      page.getByRole("heading", {
        name: "Another step I still need",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Completed!/ }).click();
    await page.goto(projectUrl);
    await expect(
      page.getByText("ACTIVE PROJECT", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Mark project complete", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Move this project to Completed.");
    await dialog
      .getByRole("button", { name: "Keep project open", exact: true })
      .click();
    await expect(
      page.getByText("ACTIVE PROJECT", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Mark project complete", exact: true })
      .click();
    const confirm = dialog.getByRole("button", {
      name: "Mark project complete",
      exact: true,
    });
    await expect(confirm).toBeVisible();
    const bounds = await confirm.boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await confirm.click();
    await expect(
      page.getByText("COMPLETED PROJECT", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Reopen project", exact: true }),
    ).toBeVisible();
    await page.goto(`/#/${design}/completed`);
    await page.getByRole("tab", { name: /^Projects/ }).click();
    await expect(page.locator(".completed-project strong")).toHaveText(
      "A finished project",
    );
    await page.getByRole("tab", { name: /^Items/ }).click();
    await page
      .getByRole("button", { name: "Put back One final step", exact: true })
      .click();
    await page.goto(`/#/${design}/focus`);
    await expect(
      page.getByRole("heading", { name: "One final step", exact: true }),
    ).toBeVisible();
    await page.goto(projectUrl);
    await expect(
      page.getByText("ACTIVE PROJECT", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".project-item")).toHaveCount(1);
    await expect(page.locator(".item-title")).toHaveText("One final step");
    await page.goto(`/#/${design}/focus`);
    await page.getByRole("button", { name: /Completed!/ }).click();
    await page.goto(projectUrl);
    await expect(
      page.getByText("ACTIVE PROJECT", { exact: true }),
    ).toBeVisible();
  });
}

test("explicit project completion explains remaining items and can be cancelled or reopened", async ({
  page,
}) => {
  await page.goto("/#/still/project/demo-dinner");
  await page
    .getByRole("button", { name: "Mark project complete", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(
    "mark the project and its remaining items as completed",
  );
  await dialog
    .getByRole("button", { name: "Keep project open", exact: true })
    .click();
  await expect(page.locator(".project-item")).toHaveCount(5);
  await page
    .getByRole("button", { name: "Mark project complete", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Mark project complete", exact: true })
    .click();
  await expect(
    page.getByText("COMPLETED PROJECT", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".project-item")).toHaveCount(0);
  await page.goto("/#/still/completed");
  await expect(page.locator(".completed-row")).toHaveCount(5);
  await page.goto("/#/still/focus");
  await expect(
    page.getByRole("heading", { name: "Water the plants", exact: true }),
  ).toBeVisible();
  await page.goto("/#/still/project/demo-dinner");
  await page
    .getByRole("button", { name: "Reopen project", exact: true })
    .click();
  await expect(page.getByText("ACTIVE PROJECT", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("ACTIVE PROJECT", { exact: true })).toBeVisible();
  await expect(page.locator(".project-item")).toHaveCount(0);
});

for (const design of ["still", "ember", "orbit", "tide", "pop"]) {
  test(`${design}: duplicate project items on a narrow phone and edit copies independently`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(`/#/${design}/project/demo-dinner`);
    const title = "Write a few ideas for Sunday dinner";
    const source = page.locator('[data-item-id="dinner-1"]');
    await source
      .getByRole("button", { name: `Duplicate ${title}`, exact: true })
      .click();
    const rows = page.locator(".project-item");
    await expect(rows).toHaveCount(6);
    await expect(rows.nth(0)).toHaveAttribute("data-item-id", "dinner-1");
    await expect(rows.nth(1).locator(".item-title")).toHaveText(title);
    await expect(rows.nth(2).locator(".item-title")).toHaveText(
      "Choose one simple recipe",
    );
    expect(await rows.nth(1).getAttribute("data-item-id")).not.toBe("dinner-1");
    await rows.nth(1).getByRole("button", { name: title, exact: true }).click();
    await page.getByLabel("Item name").fill("Plan next Sunday's menu");
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.reload();
    await expect(source.locator(".item-title")).toHaveText(title);
    await expect(rows.nth(1).locator(".item-title")).toHaveText(
      "Plan next Sunday's menu",
    );
    const copyButton = source.getByRole("button", {
      name: `Duplicate ${title}`,
      exact: true,
    });
    const bounds = await copyButton.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(40);
    expect(bounds!.height).toBeGreaterThanOrEqual(40);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}

test("duplicate an errand from the master list and keep both copies after reload", async ({
  page,
}) => {
  await page.goto("/#/still/queue");
  const title = "Water the plants";
  const errands = page
    .locator(".queue-row")
    .filter({ has: page.getByText(title, { exact: true }) });
  await expect(errands).toHaveCount(1);
  await errands
    .getByRole("button", { name: `Duplicate ${title}`, exact: true })
    .click();
  await expect(errands).toHaveCount(2);
  const titles = await page.locator(".queue-row strong").allTextContents();
  expect(titles.lastIndexOf(title)).toBeGreaterThan(titles.indexOf(title));
  await errands
    .last()
    .getByRole("button", { name: `Edit ${title}`, exact: true })
    .click();
  await page.getByLabel("Item name").fill("Water the balcony plants");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.reload();
  await expect(errands).toHaveCount(1);
  await expect(
    page.getByText("Water the balcony plants", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("duplicate the focused item and project steps without changing their originals", async ({
  page,
}) => {
  const title = "Write a few ideas for Sunday dinner";
  await page.goto("/#/tide/focus");
  await page
    .getByRole("button", { name: `Duplicate ${title}`, exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Completed!/ }).click();
  await page.goto("/#/tide/completed");
  await expect(page.getByRole("button", { name: /^Duplicate / })).toHaveCount(
    1,
  );
  await expect(page.locator(".completed-row")).toHaveCount(1);
  await expect(page.locator(".completed-row strong")).toHaveText(title);
  await page.goto("/#/tide/project/demo-dinner");
  await expect(
    page.locator(".project-item .item-title").filter({ hasText: title }),
  ).toHaveCount(1);
  await page.locator(".finished-details summary").click();
  await page
    .locator(".finished-step")
    .getByRole("button", { name: `Duplicate ${title}`, exact: true })
    .click();
  await expect(page.locator(".finished-step")).toHaveCount(1);
  await page.reload();
  await expect(
    page.locator(".project-item .item-title").filter({ hasText: title }),
  ).toHaveCount(2);
});

test("five design options open the corresponding working app", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Five fresh perspectives/ }),
  ).toBeVisible();
  for (const name of ["Still", "Ember", "Orbit", "Tide", "Pop"]) {
    await page
      .getByRole("button", { name: new RegExp(`Explore ${name}\\.`) })
      .click();
    await expect(
      page.getByRole("button", { name: "Start working", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Start working", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Write a few ideas for Sunday dinner",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Completed!/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Take a bite/ }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `/tmp/elephant-${name.toLowerCase()}-focus.png`,
      fullPage: true,
    });
    await page.getByRole("link", { name: "All designs" }).click();
  }
  expect(errors).toEqual([]);
});

test("taking a bite preserves the current item until explicitly completed and persists", async ({
  page,
}) => {
  await page.goto("/#/still/focus");
  await page.getByRole("button", { name: /Take a bite/ }).click();
  await page
    .getByLabel("What can you do right now?", { exact: false })
    .fill("Choose a dinner theme");
  await page
    .getByLabel("What will you do after that?", { exact: false })
    .fill("Write three menu ideas");
  await page
    .getByRole("button", { name: "Make it smaller", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Choose a dinner theme" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Choose a dinner theme" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Completed!/ }).click();
  await expect(
    page.getByRole("heading", { name: "Water the plants" }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Completed" })
    .click();
  await expect(
    page.getByText("Choose a dinner theme", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Projects", exact: true })
    .click();
  await page
    .getByRole("button", { name: "View projects", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Open project Plan a Sunday dinner",
      exact: true,
    })
    .click();
  await expect(page.locator(".item-title").first()).toHaveText(
    "Write three menu ideas",
  );
});

test("projects can be created, ordered, edited, paused, and reactivated", async ({
  page,
}) => {
  await page.goto("/#/tide/projects");
  await page.getByRole("button", { name: "Add project", exact: true }).click();
  await page
    .getByLabel("Project name", { exact: true })
    .fill("Test a little idea");
  await page.getByRole("button", { name: "Create project" }).click();
  for (const title of ["First step", "Second step"]) {
    await page.getByRole("button", { name: "Add a little step" }).click();
    await page.getByLabel("What would you like to do?").fill(title);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Add item", exact: true })
      .click();
  }
  await page
    .getByRole("button", { name: "Move Second step up", exact: true })
    .click();
  await expect(page.locator(".item-title").first()).toHaveText("Second step");
  await page.getByRole("button", { name: "Second step", exact: true }).click();
  await page.getByLabel("Item name").fill("A revised first step");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByLabel("Project due date").fill("2026-12-31");
  await page.getByRole("button", { name: "Move to upcoming" }).click();
  await expect(
    page.getByText("UPCOMING PROJECT", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Activate project" }).click();
  await expect(page.getByText("ACTIVE PROJECT", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator(".item-title").first()).toHaveText(
    "A revised first step",
  );
  await expect(page.getByLabel("Project due date")).toHaveValue("2026-12-31");
});

test("master queue stays hidden until enabled, JSON export and guarded reset/import work", async ({
  page,
}) => {
  await page.goto("/#/ember/focus");
  await page.getByRole("button", { name: /Completed!/ }).click();
  await page.goto("/#/ember/home");
  await expect(
    page.getByRole("button", { name: "Start working", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /View master list/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("switch", { name: "Show the master list" }).click();
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Home", exact: true })
    .click();
  await page.getByRole("button", { name: /View master list/ }).click();
  await expect(
    page.getByRole("heading", { name: "Master list", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".queue-row")).toHaveCount(6);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const downloaded = page.waitForEvent("download");
  const original = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("elephant.workspace.local.v1")!).state,
  );
  await page.getByRole("button", { name: /Download JSON backup/ }).click();
  const download = await downloaded;
  const backupPath = await download.path();
  expect(backupPath).toBeTruthy();
  expect(download.suggestedFilename()).toMatch(
    /^elephant-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/,
  );
  const saved = JSON.parse(await readFile(backupPath!, "utf8"));
  expect(saved).toEqual(original);
  expect(
    saved.items.filter(
      (item: { completedAt: string | null }) => item.completedAt,
    ),
  ).toHaveLength(1);
  await page
    .getByRole("button", { name: "Reset workspace", exact: true })
    .click();
  await page.getByRole("button", { name: "Keep my space" }).click();
  await page
    .getByRole("button", { name: "Reset workspace", exact: true })
    .click();
  await page.getByRole("button", { name: "Reset everything" }).click();
  await expect(
    page.getByRole("button", { name: "Find your next step" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Import an Elephant backup").setInputFiles(backupPath!);
  await page.getByRole("button", { name: "Replace current data" }).click();
  await expect(
    page.getByRole("button", { name: "Start working", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Start working", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("elephant.workspace.local.v1")!).state,
    ),
  ).toEqual(original);
});

test("a downloaded JSON backup restores a corrupted browser workspace", async ({
  page,
}) => {
  const key = "elephant.workspace.local.v1";
  const damaged = '{"storageVersion":1,"state":BROKEN';
  await page.goto("/#/still/settings");
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download backup", exact: true })
    .click();
  const download = await downloaded;
  const backupPath = (await download.path())!;
  const original = JSON.parse(await readFile(backupPath, "utf8"));
  await page.evaluate(
    ({ key, damaged }) => localStorage.setItem(key, damaged),
    { key, damaged },
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Download backup", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: /Download JSON backup/ }),
  ).toBeDisabled();
  await page.getByLabel("Import an Elephant backup").setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":999}'),
  });
  await expect(
    page.getByRole("status").filter({ hasText: "Could not import:" }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    damaged,
  );
  await page.getByLabel("Import an Elephant backup").setInputFiles(backupPath);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    damaged,
  );
  await page.getByLabel("Import an Elephant backup").setInputFiles(backupPath);
  await page
    .getByRole("button", { name: "Replace current data", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start working", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!).state,
      key,
    ),
  ).toEqual(original);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Start working", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!).state,
      key,
    ),
  ).toEqual(original);
});

test("320px project/settings screens fit and dialogs support Escape", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  for (const design of ["still", "ember", "orbit", "tide", "pop"]) {
    for (const screen of ["projects", "settings"]) {
      await page.goto(`/#/${design}/${screen}`);
      await expect(page.locator(".page-heading")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        `${design}/${screen}`,
      ).toBe(true);
    }
  }
  await page.goto("/#/pop/projects");
  await page.getByRole("button", { name: "Add project", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("desktop layout retains all app controls", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/#/still/home");
  await expect(
    page.getByRole("navigation", { name: "Main navigation", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start working", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "/tmp/elephant-still-desktop.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("swiping an item title opens removal confirmation without opening edit", async ({
  page,
}) => {
  await page.goto("/#/still/project/demo-dinner");
  const title = page.locator(".item-title").first();
  await expect(title).toBeVisible();
  await title.dispatchEvent("pointerdown", {
    clientX: 245,
    clientY: 430,
    pointerId: 1,
    pointerType: "touch",
    bubbles: true,
  });
  await title.dispatchEvent("pointerup", {
    clientX: 140,
    clientY: 430,
    pointerId: 1,
    pointerType: "touch",
    bubbles: true,
  });
  await title.dispatchEvent("click");
  await expect(
    page.getByRole("heading", { name: "Remove this item?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Edit your item" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Keep item" }).click();
  await expect(title).toHaveText("Write a few ideas for Sunday dinner");
});

test("profile photo upload survives reload and can be removed", async ({
  page,
}) => {
  await page.goto("/#/still/settings");
  await expect(
    page.getByRole("button", { name: "Add a profile photo" }),
  ).toBeVisible();
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#344b3d";
    ctx.fillRect(0, 0, 2, 2);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.getByLabel("Upload a profile photo").setInputFiles({
    name: "profile.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await expect(
    page.getByRole("button", { name: "Remove photo" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".profile-form img")).toBeVisible();
  await page.getByRole("button", { name: "Remove photo" }).click();
  await expect(page.locator(".profile-form img")).toHaveCount(0);
});

for (const design of ["still", "ember", "orbit", "tide", "pop"]) {
  test(`${design}: delete active and upcoming projects from their cards while keeping completed items`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto(`/#/${design}/focus`);
    await page.getByRole("button", { name: /Completed!/ }).click();
    await page.goto(`/#/${design}/projects`);
    const openDinner = page.getByRole("button", {
      name: "Open project Plan a Sunday dinner",
      exact: true,
    });
    const deleteDinner = page.getByRole("button", {
      name: "Delete project Plan a Sunday dinner",
      exact: true,
    });
    await deleteDinner.click();
    await expect(page).toHaveURL(new RegExp(`/${design}/projects$`));
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByText("Plan a Sunday dinner", { exact: true }),
    ).toBeVisible();
    await expect(dialog).toContainText(
      "Completed items will stay in your history.",
    );
    await dialog
      .getByRole("button", { name: "Keep project", exact: true })
      .click();
    await expect(openDinner).toBeVisible();
    await deleteDinner.click();
    await dialog
      .getByRole("button", { name: "Delete project", exact: true })
      .click();
    await expect(openDinner).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: "Open project Make room for creativity",
        exact: true,
      }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("button", {
        name: "Open project Make room for creativity",
        exact: true,
      }),
    ).toBeVisible();
    await expect(openDinner).toHaveCount(0);
    await page.getByRole("tab", { name: /Upcoming/ }).click();
    await page
      .getByRole("button", {
        name: "Delete project A little more movement",
        exact: true,
      })
      .click();
    await dialog
      .getByRole("button", { name: "Delete project", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Something for later.", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.goto(`/#/${design}/completed`);
    await expect(page.locator(".completed-row strong")).toHaveText(
      "Write a few ideas for Sunday dinner",
    );
    await expect(page.locator(".completed-row p")).toHaveText(
      "Plan a Sunday dinner (deleted project)",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}

test("delete from project details removes unfinished items and keeps restorable completion history", async ({
  page,
}) => {
  await page.goto("/#/still/focus");
  await page.getByRole("button", { name: /Completed!/ }).click();
  await page.goto("/#/still/project/demo-dinner");
  const deleteButton = page.getByRole("button", {
    name: "Delete project",
    exact: true,
  });
  await deleteButton.click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Keep project" })
    .click();
  await expect(page.getByLabel("Project name", { exact: true })).toHaveValue(
    "Plan a Sunday dinner",
  );
  await deleteButton.click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete project", exact: true })
    .click();
  await expect(page).toHaveURL(/\/still\/projects$/);
  await expect(
    page.getByRole("button", {
      name: "Open project Plan a Sunday dinner",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.goto("/#/still/completed");
  await expect(page.locator(".completed-row strong")).toHaveText(
    "Write a few ideas for Sunday dinner",
  );
  await expect(page.locator(".completed-row p")).toHaveText(
    "Plan a Sunday dinner (deleted project)",
  );
  await page.goto("/#/still/queue");
  await expect(
    page.getByRole("heading", { name: "Master list", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".queue-row").filter({ hasText: "Plan a Sunday dinner" }),
  ).toHaveCount(0);
  await expect(
    page.locator(".queue-row").filter({ hasText: "Make room for creativity" }),
  ).not.toHaveCount(0);
  await page.goto("/#/still/focus");
  await expect(
    page.getByRole("heading", { name: "Water the plants", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Water the plants", exact: true }),
  ).toBeVisible();
  await page.goto("/#/still/settings");
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download backup", exact: true })
    .click();
  const backupPath = (await (await downloaded).path())!;
  const saved = JSON.parse(await readFile(backupPath, "utf8"));
  expect(
    saved.projects.some(
      (project: { id: string }) => project.id === "demo-dinner",
    ),
  ).toBe(false);
  expect(
    saved.items.filter((item: { id: string }) => item.id.startsWith("dinner-")),
  ).toEqual([
    expect.objectContaining({
      id: "dinner-1",
      projectId: null,
      deletedProjectName: "Plan a Sunday dinner",
      completedAt: expect.any(String),
    }),
  ]);
  await page.getByLabel("Import an Elephant backup").setInputFiles(backupPath);
  await page
    .getByRole("button", { name: "Replace current data", exact: true })
    .click();
  await page.goto("/#/still/completed");
  await expect(page.locator(".completed-row p")).toHaveText(
    "Plan a Sunday dinner (deleted project)",
  );
  await page
    .getByRole("button", {
      name: "Put back Write a few ideas for Sunday dinner",
      exact: true,
    })
    .click();
  await expect(page.locator(".completed-row")).toHaveCount(0);
  await page.goto("/#/still/focus");
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Write a few ideas for Sunday dinner",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Completed!/ }).click();
  await expect(
    page.getByRole("heading", { name: "Water the plants", exact: true }),
  ).toBeVisible();
  await page.goto("/#/still/projects");
  await expect(
    page.getByRole("button", {
      name: "Open project Plan a Sunday dinner",
      exact: true,
    }),
  ).toHaveCount(0);
});

test("deleting an upcoming project from details returns to the upcoming list", async ({
  page,
}) => {
  await page.goto("/#/ember/project/demo-movement");
  await page
    .getByRole("button", { name: "Delete project", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete project", exact: true })
    .click();
  await expect(page).toHaveURL(/\/ember\/projects$/);
  await expect(page.getByRole("tab", { name: /Upcoming/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByRole("heading", { name: "Something for later.", exact: true }),
  ).toBeVisible();
});
