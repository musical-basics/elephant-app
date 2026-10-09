import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET, PUT } from "../api/workspace";
import {
  addProject,
  addItem,
  createEmptyState,
  setFocusMode,
} from "../src/lib/model";

const key = "w".repeat(43);
const endpoint = "https://elephant.test/api/workspace";
const request = (body?: unknown, credential = key) =>
  new Request(endpoint, {
    method: body === undefined ? "GET" : "PUT",
    headers: {
      "X-Elephant-Key": credential,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
beforeEach(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "https://elephant-db.test");
  vi.stubEnv("ELEPHANT_SUPABASE_SERVICE_KEY", "private-server-key");
  vi.stubEnv(
    "ELEPHANT_WORKSPACE_KEY_HASH",
    createHash("sha256").update(key).digest("hex"),
  );
  vi.stubEnv("ELEPHANT_WORKSPACE_ID", "desktop");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("requires the private workspace key for both reads and writes", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  for (const credential of ["", "wrong", "b".repeat(43)]) {
    expect((await GET(request(undefined, credential))).status).toBe(401);
    expect(
      (
        await PUT(
          request(
            { data: createEmptyState(), expectedRevision: null },
            credential,
          ),
        )
      ).status,
    ).toBe(401);
  }
  expect(fetchMock).not.toHaveBeenCalled();
});

it("reads only the configured workspace through a server-only RPC", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init) => {
      expect(String(input)).toBe(
        "https://elephant-db.test/rest/v1/rpc/elephant_read_desktop",
      );
      expect(JSON.parse(init.body)).toEqual({ p_workspace_id: "desktop" });
      expect(new Headers(init.headers).get("apikey")).toBe(
        "private-server-key",
      );
      return Response.json({ data: createEmptyState(), revision: 3 });
    }),
  );
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toBe("X-Elephant-Key");
  expect(await response.json()).toMatchObject({ workspace: { revision: 3 } });
});

it("passes an explicit expected revision and ignores client-supplied workspace IDs", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init) => {
      expect(String(input)).toContain("/rpc/elephant_save_desktop");
      expect(JSON.parse(init.body)).toEqual({
        p_workspace_id: "desktop",
        p_data: {
          ...createEmptyState(),
          settings: { showMasterList: false, diarySort: "newest" },
          activityLog: [],
          focusMode: null,
          diary: [],
        },
        p_expected_revision: 4,
      });
      return Response.json({ revision: 5 });
    }),
  );
  const response = await PUT(
    request({
      data: {
        ...createEmptyState(),
        settings: { showMasterList: false, diarySort: "newest" },
        activityLog: [],
        focusMode: null,
        diary: [],
      },
      expectedRevision: 4,
      workspaceId: "someone-else",
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ revision: 5 });
});

it("reports a conflicting write without overwriting the other copy", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(null)),
  );
  expect(
    (await PUT(request({ data: createEmptyState(), expectedRevision: 1 })))
      .status,
  ).toBe(409);
});

it.each([
  { data: createEmptyState() },
  { data: createEmptyState(), expectedRevision: 0 },
  { data: createEmptyState(), expectedRevision: "2" },
  { data: { version: 1 }, expectedRevision: null },
])("rejects malformed writes before contacting Supabase", async (body) => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  expect((await PUT(request(body))).status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("fails closed without configuration and hides upstream secrets on errors", async () => {
  vi.stubEnv("ELEPHANT_SUPABASE_SERVICE_KEY", "");
  expect((await GET(request())).status).toBe(503);
  vi.stubEnv("ELEPHANT_SUPABASE_SERVICE_KEY", "private-server-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ message: "private-server-key failure" }, { status: 403 }),
    ),
  );
  const response = await PUT(
    request({ data: createEmptyState(), expectedRevision: null }),
  );
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain("private-server-key");
});

it.each([false, true])(
  "preserves logs from older tabs while retaining revision protection (conflict: %s)",
  async (conflict) => {
    const activityLog = [
      {
        id: "log",
        title: "Sleep",
        category: "sleep",
        startedAt: "2026-10-08T00:00:00.000Z",
        endedAt: "2026-10-08T08:00:00.000Z",
        createdAt: "2026-10-08T08:00:00.000Z",
      },
    ];
    const fetchMock = vi.fn(async (input, init) => {
      if (String(input).endsWith("/elephant_read_desktop"))
        return Response.json({
          data: { ...createEmptyState(), activityLog },
          revision: 4,
        });
      expect(JSON.parse(init.body)).toMatchObject({
        p_data: { activityLog },
        p_expected_revision: 4,
      });
      return Response.json(conflict ? null : { revision: 5 });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(
      (await PUT(request({ data: createEmptyState(), expectedRevision: 4 })))
        .status,
    ).toBe(conflict ? 409 : 200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  },
);

it("does not overwrite Supabase when preserving an older tab’s logs fails", async () => {
  const fetchMock = vi.fn(async () =>
    Response.json({ message: "Offline" }, { status: 503 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  expect(
    (await PUT(request({ data: createEmptyState(), expectedRevision: 4 })))
      .status,
  ).toBe(502);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("preserves focus mode omitted by an older tab, and accepts an explicit stop", async () => {
  let state = addProject(createEmptyState(), "Focus");
  state = setFocusMode(
    addItem(state, "Task", state.projects[0].id),
    state.projects[0].id,
    2,
  );
  const { focusMode, ...legacy } = state;
  let readCount = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init) => {
      if (String(input).endsWith("/elephant_read_desktop")) {
        readCount++;
        return Response.json({ data: state, revision: 4 });
      }
      expect(JSON.parse(init.body).p_data.focusMode).toEqual(focusMode);
      return Response.json({ revision: 5 });
    }),
  );
  expect(
    (await PUT(request({ data: legacy, expectedRevision: 4 }))).status,
  ).toBe(200);
  expect(readCount).toBe(1);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init) => {
      expect(String(input)).toContain("/elephant_save_desktop");
      expect(JSON.parse(init.body).p_data.focusMode).toBeNull();
      return Response.json({ revision: 6 });
    }),
  );
  expect(
    (
      await PUT(
        request({
          data: {
            ...state,
            settings: { ...state.settings, diarySort: "newest" },
            focusMode: null,
            activityLog: [],
            diary: [],
          },
          expectedRevision: 5,
        }),
      )
    ).status,
  ).toBe(200);
});

it("preserves diary entries omitted by an older tab, and accepts an explicit empty diary", async () => {
  const diary = [
    {
      id: "note",
      text: "A quiet morning.",
      writtenAt: "2026-10-08T12:00:00.000Z",
      createdAt: "2026-10-08T12:00:00.000Z",
    },
  ];
  const current = {
    ...createEmptyState(),
    settings: { showMasterList: false, diarySort: "newest" as const },
    activityLog: [],
    focusMode: null,
    diary,
  };
  const fetchMock = vi.fn(async (input, init) => {
    if (String(input).endsWith("/elephant_read_desktop"))
      return Response.json({ data: current, revision: 4 });
    expect(JSON.parse(init.body)).toMatchObject({
      p_data: { diary },
      p_expected_revision: 4,
    });
    return Response.json({ revision: 5 });
  });
  vi.stubGlobal("fetch", fetchMock);
  const { diary: _omitted, ...legacy } = current;
  expect(
    (await PUT(request({ data: legacy, expectedRevision: 4 }))).status,
  ).toBe(200);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init) => {
      expect(String(input)).toContain("/elephant_save_desktop");
      expect(JSON.parse(init.body).p_data.diary).toEqual([]);
      return Response.json({ revision: 6 });
    }),
  );
  expect(
    (
      await PUT(
        request({ data: { ...current, diary: [] }, expectedRevision: 5 }),
      )
    ).status,
  ).toBe(200);
});

it("preserves a diary sort preference omitted by an older tab", async () => {
  const saved = {
    ...createEmptyState(),
    settings: { showMasterList: true, diarySort: "oldest" },
  };
  const fetchMock = vi.fn(async (input, init) => {
    if (String(input).endsWith("/elephant_read_desktop"))
      return Response.json({ data: saved, revision: 4 });
    expect(JSON.parse(init.body).p_data.settings).toEqual({
      showMasterList: false,
      diarySort: "oldest",
    });
    return Response.json({ revision: 5 });
  });
  vi.stubGlobal("fetch", fetchMock);
  expect(
    (
      await PUT(
        request({
          data: {
            ...createEmptyState(),
            activityLog: [],
            focusMode: null,
            diary: [],
          },
          expectedRevision: 4,
        }),
      )
    ).status,
  ).toBe(200);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
