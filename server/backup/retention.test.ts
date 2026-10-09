import { describe, expect, it } from "vitest";
import { archiveName, parseArchiveName, planRetention } from "./retention";

const DAY_MS = 86_400_000;
const name = (timestamp: string, partial = false, runId = "0123abcd") =>
  archiveName(new Date(timestamp), partial, runId);

describe("backup archive names", () => {
  it("round-trips milliseconds and partial status in UTC", () => {
    const timestamp = "2026-10-09T03:30:12.345Z";
    const archive = name(timestamp, true);
    expect(archive).toBe("elephant-2026-10-09-033012345-0123abcd-PARTIAL");
    expect(parseArchiveName(archive)).toEqual({
      name: archive,
      at: new Date(timestamp),
      partial: true,
    });
    expect(parseArchiveName(name(timestamp))?.partial).toBe(false);
  });

  it("gives runs at the same timestamp distinct folders", () => {
    const at = new Date("2026-10-09T03:30:00.000Z");
    const names = Array.from({ length: 50 }, () => archiveName(at));
    expect(new Set(names).size).toBe(names.length);
    expect(
      names.every(
        (value) => parseArchiveName(value)?.at.getTime() === at.getTime(),
      ),
    ).toBe(true);
    expect(archiveName(at, false, "deadBEEF")).toContain("deadbeef");
  });

  it.each([
    "elephant-2026-02-29-033000000-0123abcd",
    "elephant-2026-04-31-033000000-0123abcd",
    "elephant-2026-13-01-033000000-0123abcd",
    "elephant-2026-00-01-033000000-0123abcd",
    "elephant-2026-10-00-033000000-0123abcd",
    "elephant-2026-10-09-243000000-0123abcd",
    "elephant-2026-10-09-036000000-0123abcd",
    "elephant-2026-10-09-033060000-0123abcd",
    "elephant-0000-00-01-033000000-0123abcd",
    "elephant-9999-12-31-243000000-0123abcd",
    "elephant-2026-10-09-033000000-0123abcg",
    "elephant-2026-10-09-033000000-0123abcd/manifest.json",
    "musicalbasics-2026-10-09-0330",
  ])("rejects unsafe or foreign archive name %s", (value) => {
    expect(parseArchiveName(value)).toBeNull();
  });

  it("accepts a leap day and preserves four-digit years below 100", () => {
    for (const timestamp of [
      "2024-02-29T00:00:00.000Z",
      "0099-01-01T00:00:00.000Z",
    ]) {
      expect(parseArchiveName(name(timestamp))?.at.toISOString()).toBe(
        timestamp,
      );
    }
    expect(() => archiveName(new Date("invalid"))).toThrow();
    expect(() => name("2026-10-09T00:00:00Z", false, "bad-id")).toThrow();
  });
});

describe("GFS retention", () => {
  it("keeps the newest backup in each daily, weekly, monthly and yearly bucket", () => {
    const now = new Date("2026-10-09T12:00:00Z");
    const pairs = [
      ["2026-10-08T03:00:00Z", "2026-10-08T04:00:00Z"],
      ["2026-09-21T03:00:00Z", "2026-09-25T03:00:00Z"],
      ["2026-08-01T03:00:00Z", "2026-08-30T03:00:00Z"],
      ["2024-01-01T03:00:00Z", "2024-12-31T03:00:00Z"],
      ["2001-01-01T03:00:00Z", "2001-12-31T03:00:00Z"],
    ].map((pair) => pair.map((timestamp) => name(timestamp)));
    const plan = planRetention(pairs.flat().reverse(), now);
    expect(new Set(plan.keep)).toEqual(new Set(pairs.map((pair) => pair[1])));
    expect(new Set(plan.remove)).toEqual(new Set(pairs.map((pair) => pair[0])));
    expect(plan.foreign).toEqual([]);
  });

  it.each([7, 35, 400])("moves to the next tier at exactly %i days", (days) => {
    const now = new Date("2026-10-09T12:00:00Z");
    const cutoff = now.getTime() - days * DAY_MS;
    const younger = archiveName(new Date(cutoff + 1), false, "00000001");
    const boundary = archiveName(new Date(cutoff), false, "00000002");
    const older = archiveName(new Date(cutoff - 1), false, "00000003");
    expect(planRetention([older, younger, boundary], now)).toEqual({
      keep: [younger, boundary],
      remove: [older],
      foreign: [],
    });
  });

  it("prefers an older complete archive to a newer partial in every tier", () => {
    const now = new Date("2026-10-09T12:00:00Z");
    const dates = ["2026-10-08", "2026-09-24", "2026-08-20", "2024-07-01"];
    const complete = dates.map((date) => name(`${date}T03:00:00Z`));
    const partial = dates.map((date) => name(`${date}T04:00:00Z`, true));
    const plan = planRetention([...partial, ...complete], now);
    expect(plan.keep).toEqual(complete);
    expect(plan.remove).toEqual(partial);
  });

  it("keeps the newest partial when a bucket has no complete archive", () => {
    const older = name("2026-10-08T03:00:00Z", true);
    const newer = name("2026-10-08T04:00:00Z", true);
    expect(
      planRetention([newer, older], new Date("2026-10-09T12:00:00Z")),
    ).toEqual({
      keep: [newer],
      remove: [older],
      foreign: [],
    });
  });

  it("groups ISO weeks across the calendar year and starts a new week on Monday", () => {
    const sundayBefore = name("2026-12-27T03:00:00Z");
    const monday = name("2026-12-28T03:00:00Z");
    const sunday = name("2027-01-03T03:00:00Z");
    const nextMonday = name("2027-01-04T03:00:00Z");
    expect(
      planRetention(
        [sundayBefore, monday, sunday, nextMonday],
        new Date("2027-01-20T12:00:00Z"),
      ),
    ).toEqual({
      keep: [sundayBefore, sunday, nextMonday],
      remove: [monday],
      foreign: [],
    });
  });

  it("protects unknown, impossible and future-dated folders from pruning", () => {
    const now = new Date("2026-10-09T12:00:00Z");
    const current = archiveName(now, false, "00000001");
    const future = archiveName(new Date(now.getTime() + 1), false, "00000002");
    const foreign = [
      "manual-backup",
      "elephant-2026-02-30-033000000-0123abcd",
      future,
    ];
    expect(planRetention([current, ...foreign], now)).toEqual({
      keep: [current],
      remove: [],
      foreign,
    });
  });

  it("resolves timestamp ties deterministically and does not duplicate deletion candidates", () => {
    const now = new Date("2026-10-09T12:00:00Z");
    const first = archiveName(now, false, "00000001");
    const second = archiveName(now, false, "00000002");
    const expected = { keep: [second], remove: [first], foreign: [] };
    expect(planRetention([first, second, first], now)).toEqual(expected);
    expect(planRetention([second, first], now)).toEqual(expected);
    expect(() => planRetention([first], new Date("invalid"))).toThrow();
  });
});
