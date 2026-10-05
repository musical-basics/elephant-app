import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });
const baseTime = new Date("2026-10-05T12:00:00Z").getTime();

async function openTask(page: Page, design: string, title: string) {
  await page.goto(`/#/${design}/project/demo-dinner`);
  await page.locator(".item-title").first().click();
  await page.getByLabel("Item name").fill(title);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.goto(`/#/${design}/focus`);
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
}

for (const [design, title, minutes, seconds, display] of [
  ["still", "5 minutes cleaning", "5", "0", "05:00"],
  ["ember", "10-min stretch", "10", "0", "10:00"],
  ["orbit", "1h 30m planning", "90", "0", "1:30:00"],
  ["tide", "30 seconds breathing", "0", "30", "00:30"],
  ["pop", "Clean the kitchen", "5", "0", "05:00"],
]) {
  test(`${design}: optional timer uses the task duration and fits a narrow phone`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.clock.setFixedTime(baseTime);
    await openTask(page, design, title);
    await expect(
      page.getByRole("region", { name: "Task countdown" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Add timer", exact: true }).click();
    await expect(page.getByLabel("Timer minutes", { exact: true })).toHaveValue(
      minutes,
    );
    await expect(page.getByLabel("Timer seconds", { exact: true })).toHaveValue(
      seconds,
    );
    await page
      .getByRole("button", { name: "Start timer", exact: true })
      .click();
    await expect(page.getByRole("timer")).toHaveText(display);
    const bounds = await page
      .getByRole("button", { name: "Pause timer", exact: true })
      .boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Remove timer", exact: true })
      .click();
    await expect(page.getByRole("timer")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Add timer", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Add timer", exact: true }),
    ).toBeVisible();
  });
}

test("timer pauses, resumes, survives navigation/reload, and finishes without completing the item", async ({
  page,
}) => {
  await page.clock.setFixedTime(baseTime);
  await openTask(page, "still", "5 minutes cleaning");
  await page.getByRole("button", { name: "Add timer", exact: true }).click();
  await page.getByRole("button", { name: "Start timer", exact: true }).click();
  await page.clock.setFixedTime(baseTime + 2_000);
  await expect(page.getByRole("timer")).toHaveText("04:58");
  await page.getByRole("button", { name: "Pause timer", exact: true }).click();
  await page.clock.setFixedTime(baseTime + 122_000);
  await expect(page.getByRole("timer")).toHaveText("04:58");
  await page.goto("/#/still/home");
  await page.goto("/#/still/focus");
  await page.reload();
  await expect(page.getByRole("timer")).toHaveText("04:58");
  await page.getByRole("button", { name: "Resume timer", exact: true }).click();
  await page.goto("/#/still/projects");
  await page.clock.setFixedTime(baseTime + 125_000);
  await page.goto("/#/still/focus");
  await page.reload();
  await expect(page.getByRole("timer")).toHaveText("04:55");
  await page.clock.setFixedTime(baseTime + 422_000);
  await expect(page.getByRole("timer")).toHaveText("00:00");
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Time’s up. Your item stays open" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "5 minutes cleaning", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("timer")).toHaveText("00:00");
  await page
    .getByRole("button", { name: "Restart timer", exact: true })
    .click();
  await expect(page.getByRole("timer")).toHaveText("05:00");
  await page.getByRole("button", { name: "Reset timer", exact: true }).click();
  await expect(page.getByLabel("Timer minutes", { exact: true })).toHaveValue(
    "5",
  );
  await page.getByLabel("Timer minutes", { exact: true }).fill("0");
  await page.getByRole("button", { name: "Start timer", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Choose a time from 1 second to 24 hours",
  );
  await expect(page.getByRole("timer")).toHaveCount(0);
  await page.getByLabel("Timer seconds", { exact: true }).fill("3");
  await page.getByRole("button", { name: "Start timer", exact: true }).click();
  await expect(page.getByRole("timer")).toHaveText("00:03");
  await page.getByRole("button", { name: /Completed!/ }).click();
  await expect(
    page.getByRole("heading", { name: "Water the plants", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("timer")).toHaveCount(0);
  await page.clock.setFixedTime(baseTime + 600_000);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Water the plants", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add timer", exact: true }).click();
  await expect(page.getByLabel("Timer minutes", { exact: true })).toHaveValue(
    "5",
  );
  await expect(page.getByLabel("Timer seconds", { exact: true })).toHaveValue(
    "0",
  );
});

test("a timer that expires while the page is closed catches up on reload", async ({
  page,
}) => {
  await page.clock.setFixedTime(baseTime);
  await openTask(page, "still", "5 minutes cleaning");
  await page.getByRole("button", { name: "Add timer", exact: true }).click();
  await page.getByRole("button", { name: "Start timer", exact: true }).click();
  await page.goto("about:blank");
  await page.clock.setFixedTime(baseTime + 600_000);
  await page.goto("/#/still/focus");
  await expect(page.getByRole("timer")).toHaveText("00:00");
  await expect(
    page.getByRole("heading", { name: "5 minutes cleaning", exact: true }),
  ).toBeVisible();
});

test("timer still works when tab storage is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window.sessionStorage, "getItem", {
      value: () => {
        throw new DOMException("Unavailable", "SecurityError");
      },
    });
    Object.defineProperty(window.sessionStorage, "setItem", {
      value: () => {
        throw new DOMException("Unavailable", "SecurityError");
      },
    });
    Object.defineProperty(window.sessionStorage, "removeItem", {
      value: () => {
        throw new DOMException("Unavailable", "SecurityError");
      },
    });
  });
  await page.clock.setFixedTime(baseTime);
  await openTask(page, "still", "One second of focus");
  await page.getByRole("button", { name: "Add timer", exact: true }).click();
  await page.getByLabel("Timer minutes", { exact: true }).fill("0");
  await page.getByLabel("Timer seconds", { exact: true }).fill("1");
  await page.getByRole("button", { name: "Start timer", exact: true }).click();
  await page.clock.setFixedTime(baseTime + 2_000);
  await expect(page.getByRole("timer")).toHaveText("00:00");
  await page.getByRole("button", { name: "Remove timer", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add timer", exact: true }),
  ).toBeVisible();
});
