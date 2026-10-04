import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

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
  await page.getByRole("button", { name: /Plan a Sunday dinner/ }).click();
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
  await page.getByRole("button", { name: /Export a backup/ }).click();
  const download = await downloaded;
  const backupPath = await download.path();
  expect(backupPath).toBeTruthy();
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
  await page
    .getByLabel("Upload a profile photo")
    .setInputFiles({
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
