import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../api/piano-lessons";
import { calendarLesson, studioTimestamp } from "./pianoLessons";
import { createHash } from "node:crypto";

const owner = "10000000-0000-4000-8000-000000000001";
const localKey = "a".repeat(43);
const row = {
  id: "lesson-1",
  date: "2026-10-07",
  time: "15:30:00",
  duration: 45,
  status: "scheduled" as const,
  student: { name: "Test Student" },
};
const endpoint =
  "https://elephant.test/api/piano-lessons?from=2026-10-01&to=2026-10-31";
const request = (token = "owner-token", url = endpoint) =>
  new Request(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

beforeEach(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "https://elephant-auth.test");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("PIANO_STUDIO_SUPABASE_URL", "https://studio-db.test");
  vi.stubEnv("PIANO_STUDIO_SERVICE_KEY", "private-studio-key");
  vi.stubEnv("PIANO_STUDIO_OWNER_ID", owner);
  vi.stubEnv(
    "PIANO_STUDIO_LOCAL_KEY_HASH",
    createHash("sha256").update(localKey).digest("hex"),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function mockServices(userId = owner, confirmed = true) {
  const studioRequests: URL[] = [];
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.hostname === "elephant-auth.test") {
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer owner-token",
        );
        return Response.json({
          id: userId,
          email: "owner@example.test",
          email_confirmed_at: confirmed ? "2026-01-01T00:00:00Z" : null,
        });
      }
      expect(url.hostname).toBe("studio-db.test");
      expect(init?.method).toBe("GET");
      expect(new Headers(init?.headers).get("apikey")).toBe(
        "private-studio-key",
      );
      studioRequests.push(url);
      return Response.json([row]);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, studioRequests };
}

describe("private piano lesson feed", () => {
  it("reads lessons with a local calendar key without any Elephant account or auth configuration", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("PIANO_STUDIO_OWNER_ID", "");
    const { studioRequests, fetchMock } = mockServices();
    const response = await GET(
      new Request(endpoint, { headers: { "X-Piano-Key": localKey } }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      connected: true,
      lessons: [{ title: "Piano lesson · Test Student" }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(studioRequests).toHaveLength(1);
  });

  it.each(["wrong", "b".repeat(43), ""])(
    "rejects an invalid local key before reading lessons (%s)",
    async (key) => {
      const { fetchMock } = mockServices();
      expect(
        (await GET(new Request(endpoint, { headers: { "X-Piano-Key": key } })))
          .status,
      ).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("revoking the local key immediately blocks local access", async () => {
    const { fetchMock } = mockServices();
    vi.stubEnv("PIANO_STUDIO_LOCAL_KEY_HASH", "");
    expect(
      (
        await GET(
          new Request(endpoint, { headers: { "X-Piano-Key": localKey } }),
        )
      ).status,
    ).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires authentication before touching either database", async () => {
    const { fetchMock } = mockServices();
    expect((await GET(request(""))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects expired/forged tokens", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        { message: "Invalid JWT", code: "bad_jwt" },
        { status: 401 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect((await GET(request())).status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["another-account", true],
    [owner, false],
  ])(
    "never reads studio data for an unauthorized account (%s, %s)",
    async (id, confirmed) => {
      const { studioRequests } = mockServices(id, confirmed);
      const response = await GET(request());
      expect(await response.json()).toMatchObject({
        connected: false,
        lessons: [],
      });
      expect(studioRequests).toHaveLength(0);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    },
  );

  it("returns only calendar fields, scopes dates/statuses, and prevents caching", async () => {
    const { studioRequests } = mockServices();
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("vary")).toBe("Authorization, X-Piano-Key");
    const body = await response.json();
    expect(body).toMatchObject({
      connected: true,
      lessons: [
        {
          source: "piano-studio",
          id: "piano-studio:lesson-1",
          title: "Piano lesson · Test Student",
          scheduledAt: "2026-10-07T22:30:00.000Z",
          endsAt: "2026-10-07T23:15:00.000Z",
          durationMinutes: 45,
          status: "scheduled",
        },
      ],
    });
    expect(Object.keys(body.lessons[0])).toHaveLength(7);
    expect(JSON.stringify(body)).not.toContain("private-studio-key");
    expect(studioRequests[0].searchParams.getAll("date")).toEqual([
      "gte.2026-10-01",
      "lte.2026-10-31",
    ]);
    expect(studioRequests[0].searchParams.get("status")).toBe(
      "in.(scheduled,completed)",
    );
    expect(studioRequests[0].searchParams.get("select")).not.toContain("*");
  });

  it.each([
    "from=2026-02-30&to=2026-03-01",
    "from=2026-10-31&to=2026-10-01",
    "from=2026-01-01&to=2026-12-31",
    "from=oops&to=2026-10-31",
  ])("rejects invalid or unbounded ranges: %s", async (query) => {
    const { fetchMock } = mockServices();
    expect(
      (
        await GET(
          request(
            "owner-token",
            `https://elephant.test/api/piano-lessons?${query}`,
          ),
        )
      ).status,
    ).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports missing configuration and studio failures without leaking upstream details", async () => {
    vi.stubEnv("PIANO_STUDIO_OWNER_ID", "");
    expect((await GET(request())).status).toBe(503);
    vi.stubEnv("PIANO_STUDIO_OWNER_ID", owner);
    const { fetchMock } = mockServices();
    fetchMock
      .mockImplementationOnce(async () =>
        Response.json({ id: owner, email_confirmed_at: "2026-01-01" }),
      )
      .mockImplementationOnce(async () =>
        Response.json(
          { message: "private-studio-key internal failure" },
          { status: 403 },
        ),
      );
    const response = await GET(request());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("private-studio-key");
  });

  it("pages past the database row limit", async () => {
    const { fetchMock } = mockServices();
    fetchMock
      .mockImplementationOnce(async () =>
        Response.json({ id: owner, email_confirmed_at: "2026-01-01" }),
      )
      .mockImplementationOnce(async () =>
        Response.json(
          Array.from({ length: 500 }, (_, i) => ({
            ...row,
            id: `lesson-${i}`,
          })),
        ),
      )
      .mockImplementationOnce(async (input) => {
        expect(new URL(String(input)).searchParams.get("offset")).toBe("500");
        return Response.json([{ ...row, id: "lesson-500" }]);
      });
    expect((await (await GET(request())).json()).lessons).toHaveLength(501);
  });
});

describe("Pacific studio times", () => {
  it.each([
    ["2026-07-10", "15:30:00", "2026-07-10T22:30:00.000Z"],
    ["2026-12-10", "15:30", "2026-12-10T23:30:00.000Z"],
    ["2026-03-08", "03:30", "2026-03-08T10:30:00.000Z"],
    ["2026-11-01", "03:30", "2026-11-01T11:30:00.000Z"],
    ["2026-10-07", "23:30", "2026-10-08T06:30:00.000Z"],
    ["2026-10-07", "00:00", "2026-10-07T07:00:00.000Z"],
  ])("converts %s %s using Pacific DST rules", (date, time, expected) => {
    expect(studioTimestamp(date, time)).toBe(expected);
  });
  it("rejects nonexistent times and invalid dates", () => {
    expect(() => studioTimestamp("2026-03-08", "02:30")).toThrow();
    expect(() => studioTimestamp("2026-02-30", "15:30")).toThrow();
    expect(() => studioTimestamp("2026-10-07", "25:00")).toThrow();
  });
  it("preserves completion and uses safe fallbacks for unnamed students", () => {
    expect(
      calendarLesson({
        ...row,
        status: "completed",
        student: null,
        duration: 0,
      }),
    ).toMatchObject({
      title: "Piano lesson · Student",
      durationMinutes: 30,
      status: "completed",
    });
  });
});
