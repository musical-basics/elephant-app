import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { addItem, createEmptyState } from "../src/lib/model";
const key = "c".repeat(43);
const cacheKey = "elephant.workspace.local.v1";
const connectionKey = "elephant.piano-studio.connection.v1";
const state = {
  ...addItem(createEmptyState(), "Real desktop task"),
  profile: { name: "Desktop owner" },
  activityLog: [
    {
      id: "sleep",
      title: "Sleep",
      category: "sleep",
      startedAt: "2026-10-08T04:00:00.000Z",
      endedAt: "2026-10-08T11:00:00.000Z",
      createdAt: "2026-10-08T11:00:00.000Z",
    },
  ],
};
async function cloud(page: Page, available = true) {
  const writes: unknown[] = [];
  await page.route("**/api/workspace", async (route) => {
    expect(route.request().headers()["x-elephant-key"]).toBe(key);
    if (route.request().method() === "PUT") {
      writes.push(route.request().postDataJSON());
      return route.fulfill({
        status: 409,
        json: { error: "Unexpected write" },
      });
    }
    return route.fulfill({
      status: available ? 200 : 401,
      json: available
        ? { workspace: { data: state, revision: 18 } }
        : { error: "This private link is invalid." },
    });
  });
  return writes;
}

test("phone joins the desktop from a private link after already opening sample data; reload remembers it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const writes = await cloud(page);
  await page.goto("/#/still/home");
  await expect(
    page.getByRole("link", { name: "Connect existing workspace" }),
  ).toBeVisible();
  const original = await page.evaluate(
    (key) => localStorage.getItem(key),
    cacheKey,
  );
  expect(original).toContain("demo-dinner");
  await page.goto(`/#workspace-connect=${key}`);
  await expect(page).toHaveURL(/#\/still\/home$/);
  await expect(
    page.getByRole("heading", { name: /Welcome, Desktop owner/ }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Do now", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Real desktop task", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Real desktop task", exact: true }),
  ).toBeVisible();
  const stored = await page.evaluate(
    ({ cacheKey, connectionKey }) => ({
      key: localStorage.getItem(connectionKey),
      cache: JSON.parse(localStorage.getItem(cacheKey)!),
      backups: Object.keys(localStorage)
        .filter((key) => key.startsWith(cacheKey + ".before-connect."))
        .map((key) => localStorage.getItem(key)),
    }),
    { cacheKey, connectionKey },
  );
  expect(stored.key).toBe(key);
  expect(stored.cache).toMatchObject({
    state,
    revision: 18,
    dirty: false,
    cloudStore: "elephant",
  });
  expect(stored.backups).toEqual([original]);
  expect(writes).toEqual([]);
});

test("desktop offers a locally generated QR and private link; another browser loads the same workspace", async ({
  page,
  browser,
}) => {
  await page.addInitScript(
    ({ connectionKey, key }) => localStorage.setItem(connectionKey, key),
    { connectionKey, key },
  );
  const writes = await cloud(page);
  await page.goto("/#/still/settings");
  await page.getByRole("button", { name: "Connect another device" }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("img", {
      name: "QR code to connect this workspace on another device",
    }),
  ).toHaveAttribute("src", /^data:image\/png;base64,/);
  const link = await dialog.getByLabel("Private workspace link").inputValue();
  expect(link).toBe(`${new URL(page.url()).origin}/#workspace-connect=${key}`);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  const context = await browser.newContext({
    viewport: { width: 320, height: 844 },
  });
  try {
    const phone = await context.newPage();
    const otherWrites = await cloud(phone);
    await phone.goto(link);
    await expect(
      phone.getByRole("heading", { name: /Welcome, Desktop owner/ }),
    ).toBeVisible();
    expect(
      await phone.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await phone.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(
      phone.getByRole("button", { name: "Send sign-in link" }),
    ).toHaveCount(0);
    expect(otherWrites).toEqual([]);
  } finally {
    await context.close();
  }
  expect(writes).toEqual([]);
});

test("the public mobile flow explains how to connect and accepts an older private calendar link", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await cloud(page);
  await page.goto("/");
  await page
    .getByRole("link", { name: "Connect your existing workspace" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Connect your workspace" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByLabel("Private workspace link")
    .fill(`https://elephant-app-gold.vercel.app/#piano-connect=${key}`);
  await page
    .getByRole("button", { name: "Connect workspace", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /Welcome, Desktop owner/ }),
  ).toBeVisible();
});

test("invalid private links leave the mobile workspace untouched and support retry", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/#/still/home");
  const original = await page.evaluate(
    (key) => localStorage.getItem(key),
    cacheKey,
  );
  await cloud(page, false);
  await page.goto(`/#workspace-connect=${key}`);
  await expect(page.getByRole("alert")).toContainText(
    "private link is invalid",
  );
  expect(page.url()).not.toContain(key);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), cacheKey),
  ).toBe(original);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), connectionKey),
  ).toBeNull();
  await page.unroute("**/api/workspace");
  await cloud(page);
  await page
    .getByRole("button", { name: "Connect workspace", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /Welcome, Desktop owner/ }),
  ).toBeVisible();
});

test("browser Back leaves the connection screen and returns to the untouched local workspace", async ({
  page,
}) => {
  await page.goto("/#/still/home");
  await expect(
    page.getByRole("link", { name: "Connect existing workspace" }),
  ).toBeVisible();
  const original = await page.evaluate(
    (key) => localStorage.getItem(key),
    cacheKey,
  );
  await page.getByRole("link", { name: "Connect existing workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Connect your workspace" }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("link", { name: "Connect existing workspace" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!),
      cacheKey,
    ),
  ).toEqual(JSON.parse(original!));
});
