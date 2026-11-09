import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../api/piano-lessons";
import { calendarLesson, studioTimestamp, validTimeZone } from "./pianoLessons";
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

const pacific = [{ value: "America/Los_Angeles" }];
const isSettings = (url: URL) =>
  url.pathname.endsWith("/rest/v1/studio_settings");

function mockServices(
  userId = owner,
  confirmed = true,
  settings: unknown[] | (() => Response) = pacific,
) {
  const studioRequests: URL[] = [];
  const settingsRequests: URL[] = [];
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
      if (isSettings(url)) {
        settingsRequests.push(url);
        return typeof settings === "function"
          ? settings()
          : Response.json(settings);
      }
      studioRequests.push(url);
      return Response.json([row]);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, studioRequests, settingsRequests };
}

describe("private piano lesson feed", () => {
  it("reads lessons with a local calendar key without any Elephant account or auth configuration", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("PIANO_STUDIO_OWNER_ID", "");
    const { studioRequests, settingsRequests, fetchMock } = mockServices();
    const response = await GET(
      new Request(endpoint, { headers: { "X-Piano-Key": localKey } }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      connected: true,
      lessons: [{ title: "Piano lesson · Test Student" }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(studioRequests).toHaveLength(1);
    expect(settingsRequests).toHaveLength(1);
    expect(settingsRequests[0].searchParams.get("key")).toBe("eq.timezone");
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
      const { studioRequests, settingsRequests } = mockServices(id, confirmed);
      const response = await GET(request());
      expect(await response.json()).toMatchObject({
        connected: false,
        lessons: [],
      });
      expect(studioRequests).toHaveLength(0);
      expect(settingsRequests).toHaveLength(0);
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
      .mockImplementationOnce(async () => Response.json(pacific))
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
      .mockImplementationOnce(async () => Response.json(pacific))
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

describe("the studio's own time zone setting", () => {
  const lessonTimes = async (settings: unknown[] | (() => Response)) => {
    mockServices(owner, true, settings);
    const response = await GET(request());
    return { response, body: await response.json() };
  };

  it("reads lesson times in the studio's time zone, three hours apart for Eastern and Pacific", async () => {
    const eastern = await lessonTimes([{ value: "America/New_York" }]);
    expect(eastern.body.lessons[0]).toMatchObject({
      scheduledAt: "2026-10-07T19:30:00.000Z",
      endsAt: "2026-10-07T20:15:00.000Z",
    });
    const pacificTimes = await lessonTimes(pacific);
    expect(pacificTimes.body.lessons[0].scheduledAt).toBe(
      "2026-10-07T22:30:00.000Z",
    );
    expect(
      Date.parse(pacificTimes.body.lessons[0].scheduledAt) -
        Date.parse(eastern.body.lessons[0].scheduledAt),
    ).toBe(3 * 3_600_000);
  });

  it("falls back to Pacific when the studio has no setting yet", async () => {
    const { body } = await lessonTimes([]);
    expect(body.lessons[0].scheduledAt).toBe("2026-10-07T22:30:00.000Z");
  });

  it.each([["Mars/Olympus"], [""], [null], [5]])(
    "refuses an invalid time zone setting instead of guessing (%j)",
    async (value) => {
      const { response, body } = await lessonTimes([{ value }]);
      expect(response.status).toBe(502);
      expect(body.error).toContain("time zone setting");
      expect(body.lessons).toBeUndefined();
    },
  );

  it("fails the refresh, without reading lessons, when the setting can't be read", async () => {
    const { studioRequests } = mockServices(owner, true, () =>
      Response.json({ message: "private-studio-key down" }, { status: 500 }),
    );
    const response = await GET(request());
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).toContain("could not refresh");
    expect(text).not.toContain("private-studio-key");
    expect(studioRequests).toHaveLength(0);
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
    expect(studioTimestamp(date, time, "America/Los_Angeles")).toBe(expected);
  });
  it.each([
    ["2026-07-10", "15:30:00", "2026-07-10T19:30:00.000Z"],
    ["2026-12-10", "15:30", "2026-12-10T20:30:00.000Z"],
    ["2026-11-10", "13:15", "2026-11-10T18:15:00.000Z"],
    // Spring forward: 1:30 is still EST, 3:30 is EDT.
    ["2026-03-08", "01:30", "2026-03-08T06:30:00.000Z"],
    ["2026-03-08", "03:30", "2026-03-08T07:30:00.000Z"],
    // Fall back: midnight is EDT, 3:30 is EST.
    ["2026-11-01", "00:30", "2026-11-01T04:30:00.000Z"],
    ["2026-11-01", "03:30", "2026-11-01T08:30:00.000Z"],
  ])("converts %s %s using Eastern DST rules", (date, time, expected) => {
    expect(studioTimestamp(date, time, "America/New_York")).toBe(expected);
  });
  it("rejects nonexistent times and invalid dates", () => {
    expect(() =>
      studioTimestamp("2026-03-08", "02:30", "America/Los_Angeles"),
    ).toThrow();
    expect(() =>
      studioTimestamp("2026-03-08", "02:30", "America/New_York"),
    ).toThrow();
    expect(() =>
      studioTimestamp("2026-02-30", "15:30", "America/Los_Angeles"),
    ).toThrow();
    expect(() =>
      studioTimestamp("2026-10-07", "25:00", "America/Los_Angeles"),
    ).toThrow();
  });
  it("accepts only real time zones", () => {
    expect(validTimeZone("America/New_York")).toBe(true);
    expect(validTimeZone("America/Los_Angeles")).toBe(true);
    for (const value of ["Mars/Olympus", "", null, undefined, 5])
      expect(validTimeZone(value)).toBe(false);
  });
  it("preserves completion and uses safe fallbacks for unnamed students", () => {
    expect(
      calendarLesson(
        {
          ...row,
          status: "completed",
          student: null,
          duration: 0,
        },
        "America/Los_Angeles",
      ),
    ).toMatchObject({
      title: "Piano lesson · Student",
      durationMinutes: 30,
      status: "completed",
    });
  });
});

describe("completing a lesson through Piano Studio", () => {
  const completeUrl = "https://elephant.test/api/piano-lessons";
  const complete = (body: unknown, headers: Record<string, string> = {}) =>
    POST(
      new Request(completeUrl, {
        method: "POST",
        headers: { "X-Piano-Key": localKey, ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T00:00:00Z"));
    vi.stubEnv("PIANO_STUDIO_AGENT_SECRET", "agent-secret");
    vi.stubEnv("PIANO_STUDIO_APP_URL", "https://studio-app.test/");
  });
  afterEach(() => vi.useRealTimers());

  function mockStudio(
    lesson:
      | (Partial<Omit<typeof row, "status">> & {
          status?: string;
          notes?: string | null;
        })
      | null = {},
    agent: () => Response = () =>
      Response.json({
        success: true,
        credit_deducted: true,
        previous_credits: 5,
        new_credits: 4,
        next_lesson: { date: "2026-10-14" },
      }),
    settings: unknown[] | (() => Response) = pacific,
  ) {
    const logs: { url: string; init: RequestInit }[] = [];
    const lookups: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.hostname === "studio-db.test" && isSettings(url))
          return typeof settings === "function"
            ? settings()
            : Response.json(settings);
        if (url.hostname === "studio-db.test") {
          lookups.push(url);
          return Response.json(
            lesson ? [{ ...row, notes: "Earlier notes", ...lesson }] : [],
          );
        }
        logs.push({ url: String(input), init: init! });
        return agent();
      }),
    );
    return { logs, lookups };
  }

  it("logs a started lesson with Piano Studio's agent API, keeping existing notes", async () => {
    const { logs, lookups } = mockStudio();
    const response = await complete({ lessonId: "piano-studio:lesson-1" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      lesson: expect.objectContaining({
        id: "piano-studio:lesson-1",
        status: "completed",
      }),
      alreadyCompleted: false,
      creditDeducted: true,
      previousCredits: 5,
      newCredits: 4,
      nextLessonDate: "2026-10-14",
    });
    expect(lookups[0].searchParams.get("id")).toBe("eq.lesson-1");
    expect(logs).toHaveLength(1);
    expect(logs[0].url).toBe(
      "https://studio-app.test/api/agent/lessons/lesson-1/log",
    );
    expect(logs[0].init.method).toBe("POST");
    expect(new Headers(logs[0].init.headers).get("authorization")).toBe(
      "Bearer agent-secret",
    );
    expect(JSON.parse(String(logs[0].init.body))).toEqual({
      notes: "Earlier notes",
    });
  });

  it("sends newly written notes instead", async () => {
    const { logs } = mockStudio();
    await complete({ lessonId: "lesson-1", notes: "  Scales, then Chopin.  " });
    expect(JSON.parse(String(logs[0].init.body))).toEqual({
      notes: "Scales, then Chopin.",
    });
  });

  it("does not log an already completed lesson again", async () => {
    const { logs } = mockStudio({ status: "completed" });
    const response = await complete({ lessonId: "lesson-1" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      alreadyCompleted: true,
      lesson: { status: "completed" },
    });
    expect(logs).toHaveLength(0);
  });

  it.each([
    [{ status: "cancelled" }, 409, "cancelled"],
    [{ date: "2026-10-09" }, 409, "hasn’t started"],
    [null, 404, "no longer exists"],
  ])(
    "refuses lessons that cannot be completed (%j)",
    async (lesson, status, message) => {
      const { logs } = mockStudio(lesson);
      const response = await complete({ lessonId: "lesson-1" });
      expect(response.status).toBe(status);
      expect((await response.json()).error).toContain(message);
      expect(logs).toHaveLength(0);
    },
  );

  it("decides whether a lesson has started in the studio's time zone", async () => {
    // 7:30 PM on Oct 7: already past in Eastern (23:30Z), not yet in Pacific (02:30Z).
    const lesson = { date: "2026-10-07", time: "19:30:00" };
    let { logs } = mockStudio(lesson, undefined, [
      { value: "America/New_York" },
    ]);
    const eastern = await complete({ lessonId: "lesson-1" });
    expect(eastern.status).toBe(200);
    expect((await eastern.json()).lesson.scheduledAt).toBe(
      "2026-10-07T23:30:00.000Z",
    );
    expect(logs).toHaveLength(1);
    ({ logs } = mockStudio(lesson, undefined, pacific));
    const pacificResponse = await complete({ lessonId: "lesson-1" });
    expect(pacificResponse.status).toBe(409);
    expect((await pacificResponse.json()).error).toContain("hasn’t started");
    expect(logs).toHaveLength(0);
  });

  it.each([
    [
      () => Response.json({ message: "down" }, { status: 500 }),
      "couldn’t be reached",
    ],
    [[{ value: "Mars/Olympus" }], "time zone setting"],
  ])(
    "doesn't log a lesson when the studio's time zone can't be read (%#)",
    async (settings, message) => {
      const { logs } = mockStudio({}, undefined, settings);
      const response = await complete({ lessonId: "lesson-1" });
      expect(response.status).toBe(502);
      expect((await response.json()).error).toContain(message);
      expect(logs).toHaveLength(0);
    },
  );

  it.each([
    ["not json", 400],
    [{ lessonId: "../admin" }, 400],
    [{ lessonId: "" }, 400],
    [{ lessonId: "lesson-1", notes: 5 }, 400],
    [{ lessonId: "lesson-1", notes: "x".repeat(10_001) }, 400],
  ])(
    "validates the request before contacting Piano Studio (%j)",
    async (body, status) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      expect((await complete(body)).status).toBe(status);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("requires the private key or the verified owner account", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(
      (await complete({ lessonId: "lesson-1" }, { "X-Piano-Key": "wrong" }))
        .status,
    ).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    const { studioRequests } = mockServices("another-account");
    const response = await POST(
      new Request(completeUrl, {
        method: "POST",
        headers: { authorization: "Bearer owner-token" },
        body: JSON.stringify({ lessonId: "lesson-1" }),
      }),
    );
    expect(response.status).toBe(403);
    expect(studioRequests).toHaveLength(0);
  });

  it("explains a missing connection secret without touching Piano Studio", async () => {
    vi.stubEnv("PIANO_STUDIO_AGENT_SECRET", "");
    const { logs, lookups } = mockStudio();
    const response = await complete({ lessonId: "lesson-1" });
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain(
      "PIANO_STUDIO_AGENT_SECRET",
    );
    expect(logs).toHaveLength(0);
    expect(lookups).toHaveLength(0);
  });

  it.each([
    [() => new Response("", { status: 401 }), 502, "rejected"],
    [
      () => Response.json({ error: "Boom" }, { status: 500 }),
      502,
      "couldn’t log",
    ],
    [
      () => {
        throw new DOMException("Timed out", "TimeoutError");
      },
      504,
      "didn’t confirm",
    ],
  ])(
    "reports Piano Studio failures without leaking secrets (%#)",
    async (agent, status, message) => {
      mockStudio({}, agent);
      const response = await complete({ lessonId: "lesson-1" });
      expect(response.status).toBe(status);
      const text = await response.text();
      expect(text).toContain(message);
      expect(text).not.toContain("agent-secret");
      expect(text).not.toContain("private-studio-key");
    },
  );
});
