import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

test.use({
  viewport: { width: 320, height: 844 },
  timezoneId: "America/New_York",
});
const baseTime = new Date("2026-10-05T16:00:00Z").getTime();
const item = (id: string, createdAt: string, completedAt: string | null) => ({
  id,
  projectId: null,
  title: id,
  createdAt,
  completedAt,
});
const fixture = {
  version: 1,
  profile: { name: "" },
  settings: { showMasterList: true },
  projects: [],
  items: [
    item(
      "Added yesterday, done today",
      "2026-10-04T20:00:00Z",
      "2026-10-05T14:00:00Z",
    ),
    item(
      "Added and done today",
      "2026-10-05T13:00:00Z",
      "2026-10-05T15:00:00Z",
    ),
    item("Yesterday's task", "2026-10-04T12:00:00Z", "2026-10-04T15:00:00Z"),
    item("Current task", "2026-10-05T13:00:00Z", null),
    item("Older task", "2026-09-07T13:00:00Z", "2026-09-08T13:00:00Z"),
  ],
  queue: [
    {
      id: "slot",
      kind: "errand",
      itemId: "Current task",
      createdAt: "2026-10-05T13:00:00Z",
    },
  ],
};

async function seed(page: Page) {
  await page.clock.setFixedTime(baseTime);
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
}

for (const design of ["still", "ember", "orbit", "tide", "pop"]) {
  test(`${design}: analytics compares local daily counts and supports each range on mobile`, async ({
    page,
  }) => {
    await seed(page);
    await page.goto(`/#/${design}/home`);
    const nav = page.getByRole("navigation", { name: "Mobile navigation" });
    await nav.getByRole("button", { name: "Analytics", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Analytics", exact: true }),
    ).toBeVisible();
    await expect(
      nav.getByRole("button", { name: "Analytics", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".analytics-total strong")).toHaveText([
      "3",
      "4",
    ]);
    await expect(page.locator(".analytics-day")).toHaveCount(7);
    await page.locator(".analytics-daily-details summary").click();
    await expect(
      page.locator(".analytics-daily-details tbody tr").first().locator("td"),
    ).toHaveText(["2", "2"]);
    await expect(
      page.locator(".analytics-daily-details tbody tr").nth(1).locator("td"),
    ).toHaveText(["1", "2"]);
    await expect(
      page.locator(".analytics-daily-details tbody tr").nth(2).locator("td"),
    ).toHaveText(["0", "0"]);
    for (const days of [30, 90]) {
      await page
        .getByRole("button", { name: `${days} days`, exact: true })
        .click();
      await expect(page.locator(".analytics-total strong")).toHaveText([
        "4",
        "5",
      ]);
      await expect(
        page.locator(".analytics-daily-details tbody tr"),
      ).toHaveCount(days);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
    for (const button of await nav.getByRole("button").all()) {
      const bounds = await button.boundingBox();
      expect(bounds!.width).toBeGreaterThanOrEqual(44);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    }
  });
}

test("adding and completing tasks updates separate daily series and survives reload", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/#/still/focus");
  await page.getByRole("button", { name: /Completed!/ }).click();
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Analytics", exact: true })
    .click();
  await expect(page.locator(".analytics-total strong")).toHaveText(["4", "4"]);
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await page
    .getByLabel("What would you like to do?")
    .fill("One more task today");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add item", exact: true })
    .click();
  await expect(page.locator(".analytics-total strong")).toHaveText(["4", "5"]);
  await page.reload();
  await expect(page.locator(".analytics-total strong")).toHaveText(["4", "5"]);
  await page.locator(".analytics-daily-details summary").click();
  await expect(
    page.locator(".analytics-daily-details tbody tr").first().locator("td"),
  ).toHaveText(["3", "3"]);
});
