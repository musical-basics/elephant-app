import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addItem,
  completeCurrent,
  createEmptyState,
  deleteItem,
  putBackItem,
  reprocess,
  validateImport,
} from "./model";
import {
  addDays,
  daySegments,
  latestLogEndpoint,
  localDateTime,
  logDuration,
  parseLocalDateTime,
  removeLogEntry,
  saveLogEntry,
  timeAtMinute,
  weekStart,
} from "./activityLog";
import type { LogEntry } from "./activityLog";
import { saveScheduledItem, toggleScheduledItem } from "./schedule";
const iso = (hour: number, minute = 0, day = 8) =>
  new Date(2026, 9, day, hour, minute).toISOString();
const entry = (id = "sleep", start = iso(0), end = iso(7)): LogEntry => ({
  id,
  title: id,
  category: "sleep",
  startedAt: start,
  endedAt: end,
  createdAt: end,
});
afterEach(() => vi.useRealTimers());

describe("activity history", () => {
  it("records completion from the most recent earlier log or completion and follows edited endpoints", () => {
    vi.useFakeTimers();
    vi.setSystemTime(iso(10));
    let state = addItem(addItem(createEmptyState(), "Practice"), "Email");
    state.activityLog = [entry(), entry("future", iso(11), iso(12))];
    state = completeCurrent(state, 60);
    expect(state.activityLog?.at(-1)).toMatchObject({
      title: "Practice",
      category: "task",
      startedAt: iso(7),
      endedAt: iso(10),
      inferred: true,
    });
    const first = state.activityLog!.at(-1)!;
    state = saveLogEntry(state, { ...first, endedAt: iso(9, 30) }, first.id);
    vi.setSystemTime(iso(10, 30));
    state = completeCurrent(state);
    expect(state.activityLog?.at(-1)?.startedAt).toBe(iso(9, 30));
    expect(state.items[0].completedAt).toBe(iso(10));
    expect(reprocess(state).activityLog).toBe(state.activityLog);
    expect(validateImport(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });
  it("uses legacy completion boundaries without fabricating historical log entries", () => {
    vi.useFakeTimers();
    vi.setSystemTime(iso(10));
    const state = addItem(createEmptyState(), "Next");
    state.items.push({
      id: "old",
      title: "Old",
      projectId: null,
      createdAt: iso(6),
      completedAt: iso(8),
    });
    const next = completeCurrent(state);
    expect(next.activityLog).toHaveLength(1);
    expect(next.activityLog?.[0].startedAt).toBe(iso(8));
  });
  it("leaves the first start unknown unless recorded timer time is available", () => {
    vi.useFakeTimers();
    vi.setSystemTime(iso(10));
    const state = addItem(createEmptyState(), "First");
    expect(completeCurrent(state).activityLog?.[0].startedAt).toBeNull();
    expect(completeCurrent(state, 90).activityLog?.[0].startedAt).toBe(
      iso(9, 58).replace(":00.000Z", ":30.000Z"),
    );
    expect(
      completeCurrent(state, Number.MAX_SAFE_INTEGER).activityLog?.[0]
        .startedAt,
    ).toBeNull();
  });
  it("keeps log history independent when tasks are reopened or deleted", () => {
    vi.useFakeTimers();
    vi.setSystemTime(iso(10));
    const done = completeCurrent(addItem(createEmptyState(), "Practice"), 600);
    const id = done.items[0].id;
    expect(putBackItem(done, id).activityLog).toBe(done.activityLog);
    expect(deleteItem(done, id).activityLog).toBe(done.activityLog);
    const removed = removeLogEntry(done, done.activityLog![0].id);
    expect(removed.items).toBe(done.items);
    expect(removed.activityLog).toEqual([]);
  });
  it("records calendar item completions, with edited endpoints replacing completion timestamps", () => {
    vi.useFakeTimers();
    vi.setSystemTime(iso(10));
    let state = saveScheduledItem(createEmptyState(), "Appointment", iso(8));
    state.activityLog = [entry()];
    state = toggleScheduledItem(state, state.scheduledItems[0].id);
    const logged = state.activityLog!.at(-1)!;
    expect(logged).toMatchObject({
      startedAt: iso(7),
      endedAt: iso(10),
      scheduledItemId: state.scheduledItems[0].id,
    });
    state = saveLogEntry(state, { ...logged, endedAt: iso(9) }, logged.id);
    expect(latestLogEndpoint(state)).toBe(Date.parse(iso(9)));
    expect(validateImport(state)).toEqual(state);
    expect(
      toggleScheduledItem(state, state.scheduledItems[0].id).activityLog,
    ).toEqual(state.activityLog);
  });
  it("validates manual ranges and supports overnight activities", () => {
    const state = createEmptyState();
    const draft = {
      title: " Sleep ",
      category: "sleep" as const,
      startedAt: iso(23, 0, 7),
      endedAt: iso(7),
    };
    const next = saveLogEntry(state, draft);
    expect(next.activityLog?.[0].title).toBe("Sleep");
    expect(logDuration(next.activityLog![0])).toBe("8h");
    expect(() =>
      saveLogEntry(state, { ...draft, endedAt: iso(22, 0, 7) }),
    ).toThrow("later");
    expect(() => saveLogEntry(state, { ...draft, startedAt: null })).toThrow();
    expect(() => saveLogEntry(state, { ...draft, title: " " })).toThrow();
    expect(() => saveLogEntry(state, draft, "missing")).toThrow("removed");
    expect(state.activityLog).toBeUndefined();
  });
  it("roundtrips legacy backups and rejects corrupt new logs", () => {
    const legacy = createEmptyState();
    expect(validateImport(legacy)).toEqual(legacy);
    for (const patch of [
      { category: "invalid" },
      { startedAt: "bad" },
      { endedAt: iso(0, 0, 7) },
      { title: "" },
      { inferred: "yes" },
    ]) {
      expect(() =>
        validateImport({ ...legacy, activityLog: [{ ...entry(), ...patch }] }),
      ).toThrow();
    }
    expect(() =>
      validateImport({ ...legacy, activityLog: [entry(), entry()] }),
    ).toThrow("duplicate");
    expect(
      validateImport({
        ...legacy,
        activityLog: [{ ...entry(), startedAt: null }],
      }).activityLog?.[0].startedAt,
    ).toBeNull();
  });
});

describe("weekly layout and time editing", () => {
  it("splits overnight periods at midnight with handles only on their real endpoints", () => {
    const logged = entry("sleep", iso(23, 0, 7), iso(7));
    expect(daySegments([logged], new Date(2026, 9, 7))[0]).toMatchObject({
      start: 1380,
      end: 1440,
      first: true,
      last: false,
    });
    expect(daySegments([logged], new Date(2026, 9, 8))[0]).toMatchObject({
      start: 0,
      end: 420,
      first: false,
      last: true,
    });
    expect(daySegments([logged], new Date(2026, 9, 9))).toEqual([]);
    expect(
      daySegments(
        [entry("midnight", iso(22, 0, 7), iso(0))],
        new Date(2026, 9, 8),
      ),
    ).toEqual([]);
  });
  it("gives overlapping and very short blocks separate usable lanes including near midnight", () => {
    const segments = daySegments(
      [
        entry("a", iso(9), iso(11)),
        entry("b", iso(10), iso(12)),
        entry("c", iso(12), iso(13)),
        entry("d", iso(23, 58), iso(23, 59)),
        entry("e", iso(23, 59), iso(23, 59)),
      ],
      new Date(2026, 9, 8),
    );
    expect(segments.map(({ lane, lanes }) => [lane, lanes])).toEqual([
      [0, 2],
      [1, 2],
      [0, 1],
      [0, 2],
      [1, 2],
    ]);
  });
  it("covers Monday through Sunday across month/year boundaries and local time roundtrips", () => {
    const monday = weekStart(new Date(2027, 0, 3));
    expect(localDateTime(monday.toISOString())).toBe("2026-12-28T00:00");
    expect(localDateTime(addDays(monday, 7).toISOString())).toBe(
      "2027-01-04T00:00",
    );
    expect(timeAtMinute(new Date(2026, 9, 8), 1440)).toBe(iso(0, 0, 9));
    expect(parseLocalDateTime("2026-10-08T08:25")).toBe(iso(8, 25));
    expect(() => parseLocalDateTime("2026-02-30T08:25")).toThrow();
  });
});

it("allows renaming an instantaneous completion without inventing duration", () => {
  const instant = entry("Quick task", iso(10), iso(10));
  const state = { ...createEmptyState(), activityLog: [instant] };
  expect(
    saveLogEntry(state, { ...instant, title: "Renamed" }, instant.id)
      .activityLog?.[0].startedAt,
  ).toBe(iso(10));
});

it("handles skipped and repeated local daylight-saving hours", () => {
  const original = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    expect(() => parseLocalDateTime("2026-03-08T02:30")).toThrow();
    expect(() => timeAtMinute(new Date(2026, 2, 8), 150)).toThrow();
    const repeated = entry(
      "Sleep",
      "2026-11-01T01:30:00-04:00",
      "2026-11-01T01:30:00-05:00",
    );
    expect(logDuration(repeated)).toBe("1h");
    expect(daySegments([repeated], new Date(2026, 10, 1))).toHaveLength(1);
    expect(addDays(new Date(2026, 2, 8), 1).getHours()).toBe(0);
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});
