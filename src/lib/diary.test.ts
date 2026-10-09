import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyState, validateImport } from "./model";
import {
  groupDiaryByDay,
  MAX_DIARY_LENGTH,
  removeDiaryEntry,
  saveDiaryEntry,
  searchDiary,
  setDiarySort,
  sortDiary,
} from "./diary";
import type { DiaryEntry, DiarySort } from "./diary";
const iso = (hour: number, minute = 0, day = 8) =>
  new Date(2026, 9, day, hour, minute).toISOString();
const entry = (id: string, writtenAt: string, text = id): DiaryEntry => ({
  id,
  text,
  writtenAt,
  createdAt: writtenAt,
});
afterEach(() => vi.useRealTimers());

describe("diary", () => {
  it("timestamps new entries, edits text and time in place, and deletes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(iso(9));
    let state = saveDiaryEntry(createEmptyState(), {
      text: "  Slept well.\nGood day ahead.  ",
      writtenAt: iso(9),
    });
    const [created] = state.diary!;
    expect(created).toEqual({
      id: expect.any(String),
      text: "Slept well.\nGood day ahead.",
      writtenAt: iso(9),
      createdAt: iso(9),
    });
    vi.setSystemTime(iso(18));
    state = saveDiaryEntry(
      state,
      { text: "Slept badly.", writtenAt: iso(7, 30) },
      created.id,
    );
    expect(state.diary).toEqual([
      {
        ...created,
        text: "Slept badly.",
        writtenAt: iso(7, 30),
        updatedAt: iso(18),
      },
    ]);
    expect(
      saveDiaryEntry(
        state,
        { text: "Slept badly.", writtenAt: iso(7, 30) },
        created.id,
      ),
    ).toBe(state);
    expect(removeDiaryEntry(state, created.id).diary).toEqual([]);
  });

  it("rejects blank, oversized, invalid-time, and removed entries", () => {
    const state = createEmptyState();
    expect(() =>
      saveDiaryEntry(state, { text: " \n ", writtenAt: iso(9) }),
    ).toThrow("Write a few words");
    expect(() =>
      saveDiaryEntry(state, {
        text: "x".repeat(MAX_DIARY_LENGTH + 1),
        writtenAt: iso(9),
      }),
    ).toThrow("under 20,000 characters");
    expect(() =>
      saveDiaryEntry(state, { text: "Hi", writtenAt: "not a date" }),
    ).toThrow("valid date");
    expect(() =>
      saveDiaryEntry(state, {
        text: "Hi",
        writtenAt: "+010000-01-01T00:00:00.000Z",
      }),
    ).toThrow("valid date");
    expect(() =>
      saveDiaryEntry(state, { text: "Hi", writtenAt: iso(9) }, "missing"),
    ).toThrow("removed");
  });

  it("sorts newest first, groups by local day, and searches every word", () => {
    const entries = sortDiary([
      entry("a", iso(8, 0, 7), "Walked the dog"),
      entry("b", iso(21, 0, 8), "Piano practice went well"),
      entry("c", iso(7, 0, 8), "Morning walk with coffee"),
    ]);
    expect(entries.map((value) => value.id)).toEqual(["b", "c", "a"]);
    expect(
      groupDiaryByDay(entries).map((group) => [
        group.day,
        group.entries.map((value) => value.id),
      ]),
    ).toEqual([
      ["2026-10-08", ["b", "c"]],
      ["2026-10-07", ["a"]],
    ]);
    expect(searchDiary(entries, "WALK").map((value) => value.id)).toEqual([
      "c",
      "a",
    ]);
    expect(
      searchDiary(entries, "walk coffee").map((value) => value.id),
    ).toEqual(["c"]);
    expect(searchDiary(entries, "  ")).toBe(entries);
  });

  it("sorts in either direction and stores the preference in settings", () => {
    const entries = [
      entry("b", iso(9)),
      entry("a", iso(9)),
      entry("c", iso(7)),
    ];
    expect(sortDiary(entries, "oldest").map((value) => value.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(sortDiary(entries, "newest").map((value) => value.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
    const state = createEmptyState();
    const sorted = setDiarySort(state, "oldest");
    expect(sorted.settings).toEqual({
      showMasterList: false,
      diarySort: "oldest",
    });
    expect(setDiarySort(sorted, "oldest")).toBe(sorted);
    expect(() => setDiarySort(state, "sideways" as DiarySort)).toThrow(
      "sort order",
    );
    expect(validateImport(JSON.parse(JSON.stringify(sorted)))).toEqual(sorted);
    expect(() =>
      validateImport({
        ...state,
        settings: { showMasterList: false, diarySort: "sideways" },
      }),
    ).toThrow("diary sort");
  });

  it("roundtrips through backups and rejects malformed entries", () => {
    const diary = [
      entry("a", iso(9)),
      { ...entry("b", iso(10)), updatedAt: iso(11) },
    ];
    const state = { ...createEmptyState(), diary };
    expect(validateImport(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(validateImport(createEmptyState())).not.toHaveProperty("diary");
    for (const [bad, message] of [
      [{ diary: {} }, "diary must be a list"],
      [{ diary: [{ ...diary[0], text: " " }] }, "diary text"],
      [
        { diary: [{ ...diary[0], text: "x".repeat(MAX_DIARY_LENGTH + 1) }] },
        "too long",
      ],
      [
        { diary: [{ ...diary[0], writtenAt: "yesterday" }] },
        "diary entry time",
      ],
      [{ diary: [{ ...diary[0], updatedAt: null }] }, "updatedAt"],
      [{ diary: [diary[0], diary[0]] }, "duplicate diary entry"],
    ] as const)
      expect(() => validateImport({ ...createEmptyState(), ...bad })).toThrow(
        message,
      );
  });
});
