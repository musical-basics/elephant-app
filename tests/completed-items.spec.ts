import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 320, height: 844 } });

for (const design of ["still", "ember", "orbit", "tide", "pop"]) {
  test(`${design}: remove unwanted completed items without changing active work`, async ({
    page,
  }) => {
    await page.goto(`/#/${design}/focus`);
    await page.getByRole("button", { name: /Completed!/ }).click();
    await expect(
      page.getByRole("heading", { name: "Water the plants", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Completed!/ }).click();
    await expect(
      page.getByRole("heading", {
        name: "Clear one corner of your desk",
        exact: true,
      }),
    ).toBeVisible();
    await page.goto(`/#/${design}/completed`);
    await expect(page.locator(".completed-row")).toHaveCount(2);
    await expect(page.getByRole("button", { name: /^Duplicate / })).toHaveCount(
      0,
    );
    await expect(page.getByRole("button", { name: /^Put back / })).toHaveCount(
      2,
    );
    const before = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("elephant.workspace.local.v1")!).state,
    );
    const trash = page.getByRole("button", {
      name: "Delete Write a few ideas for Sunday dinner",
      exact: true,
    });
    const bounds = await trash.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    await trash.click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", {
        name: "Remove completed item?",
        exact: true,
      }),
    ).toBeVisible();
    await expect(dialog).toContainText(
      "permanently removes the item from your completed history",
    );
    await dialog
      .getByRole("button", { name: "Keep item", exact: true })
      .click();
    await expect(page.locator(".completed-row")).toHaveCount(2);
    await trash.click();
    await dialog
      .getByRole("button", { name: "Remove item", exact: true })
      .click();
    await expect(page.locator(".completed-row strong")).toHaveText(
      "Water the plants",
    );
    await page.reload();
    await expect(page.locator(".completed-row strong")).toHaveText(
      "Water the plants",
    );
    const after = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("elephant.workspace.local.v1")!).state,
    );
    expect(after).toEqual({
      ...before,
      items: before.items.filter(
        (item: { id: string }) => item.id !== "dinner-1",
      ),
    });
    await page.goto(`/#/${design}/focus`);
    await expect(
      page.getByRole("heading", {
        name: "Clear one corner of your desk",
        exact: true,
      }),
    ).toBeVisible();
    await page.goto(`/#/${design}/completed`);
    await page
      .getByRole("button", { name: "Delete Water the plants", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Remove item", exact: true })
      .click();
    await expect(page.locator(".completed-row")).toHaveCount(0);
    await expect(
      page.getByRole("heading", {
        name: "Your little wins will live here.",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}
