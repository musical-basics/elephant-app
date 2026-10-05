import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDailyActivity } from "./analytics";
import type { Item } from "./model";

const item = (createdAt: string, completedAt: string | null = null): Item => ({
  id: crypto.randomUUID(),
  projectId: null,
  title: "A task",
  createdAt,
  completedAt,
});

describe("daily task activity", () => {
  beforeAll(() => vi.stubEnv("TZ", "America/New_York"));
  afterAll(() => vi.unstubAllEnvs());

  it("includes today and fills missing days with zeroes", () => {
    const days = getDailyActivity([], 7, new Date(2026, 9, 5, 14));
    expect(days.map((day) => day.key)).toEqual([
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
    ]);
    expect(days.every((day) => day.added === 0 && day.done === 0)).toBe(true);
  });

  it("counts creation and completion independently, using local rather than UTC dates", () => {
    const days = getDailyActivity(
      [
        item("2026-10-05T02:30:00Z", "2026-10-05T06:30:00Z"),
        item("2026-10-05T04:00:00Z"),
        item("2026-09-01T12:00:00Z", "2026-10-05T12:00:00Z"),
        item("2026-09-01T12:00:00Z", "2026-09-02T12:00:00Z"),
        item("2026-10-06T12:00:00Z"),
      ],
      7,
      new Date(2026, 9, 5, 18),
    );
    expect(days.at(-2)).toMatchObject({ key: "2026-10-04", added: 1, done: 0 });
    expect(days.at(-1)).toMatchObject({ key: "2026-10-05", added: 1, done: 2 });
    expect(days.reduce((sum, day) => sum + day.added, 0)).toBe(2);
    expect(days.reduce((sum, day) => sum + day.done, 0)).toBe(2);
  });

  it("keeps exact local dates over spring daylight saving time", () => {
    const days = getDailyActivity(
      [
        item("2026-03-08T04:59:59Z"), // March 7, just before midnight.
        item("2026-03-08T05:00:00Z"), // March 8, midnight before the clock changes.
        item("2026-03-09T03:59:59Z", "2026-03-09T04:00:00Z"),
      ],
      7,
      new Date(2026, 2, 10, 0, 15),
    );
    expect(days.map((day) => day.key)).toEqual([
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
      "2026-03-07",
      "2026-03-08",
      "2026-03-09",
      "2026-03-10",
    ]);
    expect(days[4].date.getTime() - days[3].date.getTime()).toBe(
      23 * 60 * 60 * 1000,
    );
    expect(days[3]).toMatchObject({ added: 1, done: 0 });
    expect(days[4]).toMatchObject({ added: 2, done: 0 });
    expect(days[5]).toMatchObject({ added: 0, done: 1 });
  });

  it("counts both repeated hours on the same day when daylight saving time ends", () => {
    const days = getDailyActivity(
      [
        item("2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z"),
        item("2026-11-02T04:59:59Z", "2026-11-02T05:00:00Z"),
      ],
      7,
      new Date(2026, 10, 3, 23),
    );
    expect(days.map((day) => day.key)).toEqual([
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
    ]);
    expect(days[4].date.getTime() - days[3].date.getTime()).toBe(
      25 * 60 * 60 * 1000,
    );
    expect(days[4]).toMatchObject({ added: 2, done: 1 });
    expect(days[5]).toMatchObject({ added: 0, done: 1 });
  });

  it("creates the requested range across year and leap-day boundaries", () => {
    const thirty = getDailyActivity([], 30, new Date(2026, 0, 5));
    expect(thirty).toHaveLength(30);
    expect(thirty[0].key).toBe("2025-12-07");
    expect(thirty.at(-1)?.key).toBe("2026-01-05");
    const ninety = getDailyActivity([], 90, new Date(2024, 2, 1));
    expect(ninety).toHaveLength(90);
    expect(ninety[0].key).toBe("2023-12-03");
    expect(ninety.at(-2)?.key).toBe("2024-02-29");
    expect(new Set(ninety.map((day) => day.key)).size).toBe(90);
  });

  it("uses retained task records, ignores malformed dates, and does not mutate items", () => {
    const items = [
      item("2026-10-05T12:00:00Z", "2026-10-05T13:00:00Z"),
      item("not a date", "not a date"),
    ];
    const before = structuredClone(items);
    const completed = getDailyActivity(items, 7, new Date(2026, 9, 5));
    expect(completed.at(-1)).toMatchObject({ added: 1, done: 1 });
    expect(items).toEqual(before);
    expect(
      getDailyActivity(
        [{ ...items[0], completedAt: null }],
        7,
        new Date(2026, 9, 5),
      ).at(-1),
    ).toMatchObject({ added: 1, done: 0 });
  });
});
