import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PianoLesson } from "../src/lib/pianoLessons";
import { readFile } from "node:fs/promises";

const authUrl = "https://piano-calendar-tests.supabase.co";
const account = "10000000-0000-4000-8000-000000000001";
const lesson: PianoLesson = {
  source: "piano-studio",
  id: "piano-studio:1",
  title: "Piano lesson · Test Student",
  scheduledAt: "2026-10-07T22:30:00.000Z",
  endsAt: "2026-10-07T23:15:00.000Z",
  durationMinutes: 45,
  status: "scheduled",
};
test.use({
  viewport: { width: 390, height: 844 },
  timezoneId: "America/New_York",
});
let server: ViteDevServer;
let baseUrl: string;
test.beforeAll(async ({}, workerInfo) => {
  const port = 6400 + workerInfo.workerIndex;
  server = await createServer({
    configFile: false,
    envFile: false,
    root: process.cwd(),
    cacheDir: join(tmpdir(), `elephant-piano-test-${process.pid}-${port}`),
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(authUrl),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
        "sb_publishable_test",
      ),
      "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(""),
    },
    esbuild: { jsx: "automatic" },
    server: { host: "127.0.0.1", port, strictPort: true },
  });
  await server.listen();
  baseUrl = `http://127.0.0.1:${port}`;
});
test.afterAll(async () => {
  await server?.close();
});

async function setup(page: Page) {
  await page.clock.install({ time: new Date("2026-10-07T16:00:00Z") });
  const user = {
    id: account,
    email: "owner@example.test",
    aud: "authenticated",
    role: "authenticated",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
  };
  const token = `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: account, exp: 2100000000 })).toString("base64url")}.test`;
  await page.addInitScript(
    ({ token, user }) => {
      localStorage.setItem(
        "sb-piano-calendar-tests-auth-token",
        JSON.stringify({
          access_token: token,
          refresh_token: "test-refresh",
          token_type: "bearer",
          expires_at: 2100000000,
          expires_in: 3600,
          user,
        }),
      );
    },
    { token, user },
  );
  await page.route(`${authUrl}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path.startsWith("/auth/")
      ? user
      : [
          {
            revision: 1,
            data: {
              version: 1,
              profile: { name: "Test Owner" },
              settings: { showMasterList: true },
              projects: [],
              items: [],
              queue: [],
              activeReminder: null,
              scheduledItems: [
                {
                  id: "personal",
                  title: "Personal appointment",
                  scheduledAt: "2026-10-07T21:00:00Z",
                  createdAt: "2026-10-01T00:00:00Z",
                  completedAt: null,
                  acknowledgedReminders: [],
                },
              ],
            },
          },
        ];
    await route.fulfill({ json: body });
  });
  const feed = {
    lessons: [lesson],
    fail: false,
    connected: true,
    calls: 0,
    ranges: [] as string[],
  };
  await page.route("**/api/piano-lessons?**", async (route) => {
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    feed.calls++;
    feed.ranges.push(route.request().url());
    await route.fulfill({
      status: feed.fail ? 502 : 200,
      json: feed.fail
        ? { error: "Unavailable" }
        : {
            connected: feed.connected,
            lessons: feed.lessons,
            fetchedAt: "2026-10-07T16:00:00Z",
          },
    });
  });
  return feed;
}

for (const design of ["still", "ember", "orbit", "tide", "pop"]) {
  test(`${design}: studio lessons share the timeline with personal items`, async ({
    page,
  }) => {
    await setup(page);
    await page.goto(`${baseUrl}/#/${design}/calendar`);
    await expect(page.locator(".schedule-title")).toHaveText([
      "Personal appointment",
      lesson.title,
    ]);
    const row = page.locator(".schedule-row.is-lesson");
    await expect(row.locator("time")).toHaveText("6:30 PM");
    await expect(row).toContainText("45 min · Ends 7:15 PM");
    await expect(row.getByRole("button")).toHaveCount(0);
    await expect(row.getByRole("link")).toHaveAttribute(
      "href",
      "https://lessons.musicalbasics.com/admin",
    );
    await expect(
      page.getByRole("button", {
        name: "Wednesday, October 7, 2026, 2 scheduled items",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const cache = await page.evaluate(
      (id) => localStorage.getItem(`elephant.workspace.account.${id}.v1`),
      account,
    );
    expect(cache).not.toContain("Test Student");
  });
}

test("refresh replaces canceled/rescheduled lessons, polls, and loads browsed months", async ({
  page,
}) => {
  const feed = await setup(page);
  await page.goto(`${baseUrl}/#/still/calendar`);
  await expect(page.locator(".is-lesson")).toHaveCount(1);
  feed.lessons = [
    {
      ...lesson,
      scheduledAt: "2026-10-08T22:30:00Z",
      endsAt: "2026-10-08T23:15:00Z",
    },
  ];
  await page.clock.fastForward(60_000);
  await expect(page.locator(".is-lesson")).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "Thursday, October 8, 2026, 1 scheduled item",
      exact: true,
    })
    .click();
  await expect(page.locator(".is-lesson")).toHaveCount(1);
  feed.lessons = [];
  await page.getByRole("button", { name: "Refresh piano lessons" }).click();
  await expect(page.locator(".is-lesson")).toHaveCount(0);
  await expect(page.locator(".calendar-upcoming")).not.toContainText(
    lesson.title,
  );
  await page.getByRole("button", { name: "Next month" }).click();
  await expect.poll(() => feed.ranges.at(-1)).toContain("from=2026-10-31");
  await expect.poll(() => feed.ranges.at(-1)).toContain("to=2026-12-13");
});

test("failed refresh keeps a labeled stale schedule; sign-out hides lesson data", async ({
  page,
}) => {
  const feed = await setup(page);
  await page.goto(`${baseUrl}/#/still/calendar`);
  await expect(page.locator(".is-lesson")).toHaveCount(1);
  feed.fail = true;
  await page.getByRole("button", { name: "Refresh piano lessons" }).click();
  await expect(
    page.getByRole("region", { name: "Piano studio connection" }),
  ).toContainText("Showing the last loaded schedule.");
  await expect(page.locator(".is-lesson")).toHaveCount(1);
  feed.fail = false;
  feed.lessons = [{ ...lesson, status: "completed" }];
  await page.getByRole("button", { name: "Refresh piano lessons" }).click();
  await expect(page.locator(".is-lesson")).toHaveClass(/is-completed/);
  await page.goto(`${baseUrl}/#/still/settings`);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.goto(`${baseUrl}/#/still/calendar`);
  await expect(page.locator(".is-lesson")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Piano studio connection" }),
  ).toContainText("No Elephant sign-in needed");
});

test("other accounts see only their own calendar", async ({ page }) => {
  const feed = await setup(page);
  feed.connected = false;
  feed.lessons = [];
  await page.goto(`${baseUrl}/#/still/calendar`);
  await expect(page.locator(".schedule-title")).toHaveText([
    "Personal appointment",
  ]);
  await expect(
    page.getByRole("region", { name: "Piano studio connection" }),
  ).toHaveCount(0);
});

async function desktopStorage(page: Page, key: string) {
  let workspace: { data: unknown; revision: number } | null = null;
  await page.route("**/api/workspace", async (route) => {
    expect(route.request().headers()["x-elephant-key"]).toBe(key);
    if (route.request().method() === "GET")
      return route.fulfill({ json: { workspace } });
    const body = route.request().postDataJSON();
    expect(body.expectedRevision).toBe(workspace?.revision ?? null);
    workspace = { data: body.data, revision: (workspace?.revision ?? 0) + 1 };
    return route.fulfill({ json: { revision: workspace.revision } });
  });
}

test("private connection opens the existing desktop workspace despite a saved cloud sign-in, and survives reload", async ({
  page,
}) => {
  await setup(page);
  const localKey = "a".repeat(43);
  await desktopStorage(page, localKey);
  const state = {
    version: 1,
    profile: { name: "Desktop Owner" },
    settings: { showMasterList: true },
    projects: [],
    items: [
      {
        id: "desktop-task",
        projectId: null,
        title: "My existing desktop task",
        createdAt: "2026-10-01T00:00:00Z",
        completedAt: null,
      },
    ],
    queue: [
      {
        id: "desktop-slot",
        kind: "errand",
        itemId: "desktop-task",
        createdAt: "2026-10-01T00:00:00Z",
      },
    ],
    activeReminder: null,
    scheduledItems: [
      {
        id: "desktop-appointment",
        title: "Desktop appointment",
        scheduledAt: "2026-10-07T21:00:00Z",
        createdAt: "2026-10-01T00:00:00Z",
        completedAt: null,
        acknowledgedReminders: [],
      },
    ],
  };
  const cloudCache = JSON.stringify({
    storageVersion: 1,
    revision: 4,
    dirty: true,
    state: { ...state, profile: { name: "Account Owner" } },
  });
  await page.addInitScript(
    ({ state, account, cloudCache }) => {
      if (!localStorage.getItem("elephant.workspace.local.v1"))
        localStorage.setItem(
          "elephant.workspace.local.v1",
          JSON.stringify({
            storageVersion: 1,
            revision: null,
            dirty: false,
            state,
          }),
        );
      if (!localStorage.getItem(`elephant.workspace.account.${account}.v1`))
        localStorage.setItem(
          `elephant.workspace.account.${account}.v1`,
          cloudCache,
        );
    },
    { state, account, cloudCache },
  );
  const cloudRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/rest/v1/elephant_workspaces"))
      cloudRequests.push(request.url());
  });
  await page.route("**/api/piano-lessons?**", async (route) => {
    expect(route.request().headers()["x-piano-key"]).toBe(localKey);
    expect(route.request().headers().authorization).toBeUndefined();
    await route.fulfill({
      json: {
        connected: true,
        lessons: [lesson],
        fetchedAt: "2026-10-07T16:00:00Z",
      },
    });
  });
  await page.goto(`${baseUrl}/#piano-connect=${localKey}`);
  await expect(page).toHaveURL(`${baseUrl}/#/still/calendar`);
  await expect(page.locator(".schedule-title")).toHaveText([
    "Desktop appointment",
    lesson.title,
  ]);
  await expect(
    page.getByText("Saved to Supabase", { exact: true }),
  ).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".schedule-title")).toHaveText([
    "Desktop appointment",
    lesson.title,
  ]);
  await page.goto(`${baseUrl}/#/still/focus`);
  await expect(
    page.getByRole("heading", {
      name: "My existing desktop task",
      exact: true,
    }),
  ).toBeVisible();
  await page.goto(`${baseUrl}/#/still/settings`);
  await expect(
    page.getByText(/Your existing workspace saves automatically to Supabase/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send sign-in link" }),
  ).toHaveCount(0);
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download backup", exact: true })
    .click();
  const path = await (await downloaded).path();
  const backup = await readFile(path!, "utf8");
  expect(backup).not.toContain(localKey);
  expect(backup).not.toContain("Test Student");
  expect(JSON.parse(backup).items).toEqual(state.items);
  expect(
    await page.evaluate(
      (account) =>
        localStorage.getItem(`elephant.workspace.account.${account}.v1`),
      account,
    ),
  ).toBe(cloudCache);
  expect(cloudRequests).toEqual([]);
});

test("private connection also works with no saved Elephant account", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-07T16:00:00Z") });
  const localKey = "b".repeat(43);
  await desktopStorage(page, localKey);
  let authRequests = 0;
  await page.route(`${authUrl}/**`, async (route) => {
    authRequests++;
    await route.fulfill({ status: 401, json: {} });
  });
  await page.route("**/api/piano-lessons?**", async (route) => {
    expect(route.request().headers()["x-piano-key"]).toBe(localKey);
    expect(route.request().headers().authorization).toBeUndefined();
    await route.fulfill({
      json: {
        connected: true,
        lessons: [lesson],
        fetchedAt: "2026-10-07T16:00:00Z",
      },
    });
  });
  await page.goto(`${baseUrl}/#/still/calendar`);
  await expect(
    page.getByText(
      "Open your private calendar link to connect piano lessons to this browser. No Elephant sign-in needed.",
    ),
  ).toBeVisible();
  await page.goto(`${baseUrl}/#piano-connect=${localKey}`);
  await expect(page.locator(".is-lesson")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".is-lesson")).toHaveCount(1);
  expect(authRequests).toBe(0);
});
