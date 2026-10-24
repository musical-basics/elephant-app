import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyState, validateImport } from "./model";
import { removeLogEntry, saveLogEntry } from "./activityLog";
import {
  addStarterRoutine,
  logRoutine,
  nextOccurrence,
  removeRoutine,
  removeWeeklyItem,
  routineProgress,
  saveRoutine,
  saveWeeklyItem,
  sortWeeklyItems,
  STARTER_ROUTINE,
  weeklyOccurrences,
} from "./routine";
import type { WeeklyItem } from "./routine";

// Thursday 22 October 2026, local time.
const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 9, day, hour, minute).getTime();
afterEach(() => vi.useRealTimers());

describe("routine items", () => {
  it("saves, edits (clearing a goal), and removes routine items", () => {
    let state = saveRoutine(createEmptyState(), {
      title: "  Workout ",
      category: "exercise",
      durationMinutes: 45,
      weeklyGoal: 2,
    });
    const [workout] = state.routines!;
    expect(workout).toMatchObject({
      title: "Workout",
      category: "exercise",
      durationMinutes: 45,
      weeklyGoal: 2,
    });
    state = saveRoutine(
      state,
      { title: "Gym", category: "exercise", durationMinutes: 60 },
      workout.id,
    );
    expect(state.routines).toEqual([
      {
        id: workout.id,
        title: "Gym",
        category: "exercise",
        durationMinutes: 60,
        createdAt: workout.createdAt,
      },
    ]);
    expect(removeRoutine(state, workout.id).routines).toEqual([]);
  });

  it.each([
    [{ title: " " }, "name"],
    [{ title: "x".repeat(201) }, "name"],
    [{ category: "nap" }, "type"],
    [{ durationMinutes: 0 }, "duration"],
    [{ durationMinutes: 1441 }, "duration"],
    [{ durationMinutes: 2.5 }, "duration"],
    [{ weeklyGoal: 0 }, "goal"],
    [{ weeklyGoal: 22 }, "goal"],
  ])("rejects invalid fields (%j)", (patch, message) => {
    expect(() =>
      saveRoutine(createEmptyState(), {
        title: "Walk",
        category: "other",
        durationMinutes: 30,
        ...patch,
      } as never),
    ).toThrow(message);
  });

  it("logs one tap as an activity ending now that lasted the usual time", () => {
    let state = saveRoutine(createEmptyState(), {
      title: "Sleep",
      category: "sleep",
      durationMinutes: 480,
    });
    const sleep = state.routines![0];
    state = logRoutine(state, sleep.id, "entry-1", at(22, 7, 30));
    expect(state.activityLog).toEqual([
      {
        id: "entry-1",
        title: "Sleep",
        category: "sleep",
        startedAt: new Date(at(21, 23, 30)).toISOString(),
        endedAt: new Date(at(22, 7, 30)).toISOString(),
        createdAt: new Date(at(22, 7, 30)).toISOString(),
        routineId: sleep.id,
      },
    ]);
    // Edits in Log keep the link to the routine; undo removes the entry.
    const edited = saveLogEntry(
      state,
      {
        title: "Sleep",
        category: "sleep",
        startedAt: new Date(at(21, 23)).toISOString(),
        endedAt: new Date(at(22, 7, 30)).toISOString(),
      },
      "entry-1",
    );
    expect(edited.activityLog![0].routineId).toBe(sleep.id);
    expect(removeLogEntry(state, "entry-1").activityLog).toEqual([]);
    expect(() => logRoutine(state, "missing")).toThrow("removed");
  });

  it("counts this Monday–Sunday week and remembers the latest entry across renames", () => {
    let state = saveRoutine(createEmptyState(), {
      title: "Workout",
      category: "exercise",
      durationMinutes: 45,
      weeklyGoal: 2,
    });
    const id = state.routines![0].id;
    state = logRoutine(state, id, "last-week", at(18, 9)); // Sunday before
    state = logRoutine(state, id, "monday", at(19, 0, 1));
    state = logRoutine(state, id, "thursday", at(22, 18));
    state = saveRoutine(
      state,
      { title: "Gym", category: "exercise", durationMinutes: 45 },
      id,
    );
    const progress = routineProgress(state, at(22, 20));
    expect(progress.get(id)?.count).toBe(2);
    expect(progress.get(id)?.last?.id).toBe("thursday");
    // The next Monday starts a fresh count.
    expect(routineProgress(state, at(26, 8)).get(id)?.count).toBe(0);
  });

  it("adds the usual routine once, skipping items that already exist", () => {
    let state = saveRoutine(createEmptyState(), {
      title: "sleep",
      category: "sleep",
      durationMinutes: 420,
    });
    state = addStarterRoutine(state);
    expect(state.routines).toHaveLength(STARTER_ROUTINE.length);
    expect(state.routines![0]).toMatchObject({ durationMinutes: 420 });
    expect(addStarterRoutine(state).routines).toHaveLength(
      STARTER_ROUTINE.length,
    );
    expect(state.routines!.find((r) => r.title === "Workout")).toMatchObject({
      weeklyGoal: 2,
    });
  });
});

describe("weekly items", () => {
  const item = (
    weekday: number,
    time: string,
    created = at(1, 0),
  ): WeeklyItem => ({
    id: `w${weekday}`,
    title: `Day ${weekday}`,
    weekday,
    time,
    createdAt: new Date(created).toISOString(),
  });

  it("saves, edits, sorts, and removes weekly items", () => {
    let state = saveWeeklyItem(createEmptyState(), {
      title: "Fellowship",
      weekday: 5,
      time: "19:30",
    });
    state = saveWeeklyItem(state, {
      title: "Church",
      weekday: 0,
      time: "10:00",
    });
    const fellowship = state.weeklyItems![0];
    state = saveWeeklyItem(
      state,
      { title: "Fellowship", weekday: 5, time: "20:00" },
      fellowship.id,
    );
    expect(sortWeeklyItems(state.weeklyItems!).map((i) => i.title)).toEqual([
      "Church",
      "Fellowship",
    ]);
    expect(state.weeklyItems![0].time).toBe("20:00");
    expect(removeWeeklyItem(state, fellowship.id).weeklyItems).toHaveLength(1);
    for (const draft of [
      { title: "", weekday: 1, time: "21:00" },
      { title: "Study", weekday: 7, time: "21:00" },
      { title: "Study", weekday: 1, time: "9pm" },
      { title: "Study", weekday: 1, time: "24:00" },
    ])
      expect(() => saveWeeklyItem(createEmptyState(), draft)).toThrow();
  });

  it("repeats on the right local days and times, only from the day it was added", () => {
    const study = item(1, "21:00", at(13, 12)); // added Tuesday 13 October
    const occurrences = weeklyOccurrences([study], new Date(2026, 9, 1), 31);
    expect(occurrences.map((o) => o.scheduledAt)).toEqual([
      new Date(at(19, 21)).toISOString(),
      new Date(at(26, 21)).toISOString(),
    ]);
    expect(occurrences[0]).toMatchObject({
      source: "weekly",
      id: `weekly:${study.id}:2026-10-19`,
      weeklyItemId: study.id,
      title: "Day 1",
    });
  });

  it("finds the next occurrence, including later today", () => {
    expect(nextOccurrence(item(4, "19:30"), at(22, 18)).getTime()).toBe(
      at(22, 19, 30),
    );
    expect(nextOccurrence(item(4, "19:30"), at(22, 20)).getTime()).toBe(
      at(29, 19, 30),
    );
  });
});

describe("routine backups", () => {
  it("roundtrips routine items, weekly items, and routine log links", () => {
    let state = addStarterRoutine(createEmptyState());
    state = saveWeeklyItem(state, {
      title: "Bible study",
      weekday: 1,
      time: "21:00",
    });
    state = logRoutine(state, state.routines![0].id, "entry", at(22, 8));
    expect(validateImport(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(validateImport(createEmptyState())).not.toHaveProperty("routines");
  });

  it.each([
    [{ routines: {} }, "routines must be a list"],
    [
      {
        routines: [
          {
            id: "r",
            title: 5,
            category: "other",
            durationMinutes: 5,
            createdAt: "2026-10-22T00:00:00.000Z",
          },
        ],
      },
      "routine title",
    ],
    [
      {
        routines: [
          {
            id: "r",
            title: "Walk",
            category: "other",
            durationMinutes: 0,
            createdAt: "2026-10-22T00:00:00.000Z",
          },
        ],
      },
      "Invalid backup: Choose a usual duration",
    ],
    [
      {
        weeklyItems: [
          {
            id: "w",
            title: "Church",
            weekday: 9,
            time: "10:00",
            createdAt: "2026-10-22T00:00:00.000Z",
          },
        ],
      },
      "Invalid backup: Choose a day",
    ],
    [
      {
        activityLog: [
          {
            id: "l",
            title: "Walk",
            category: "other",
            startedAt: null,
            endedAt: "2026-10-22T00:00:00.000Z",
            createdAt: "2026-10-22T00:00:00.000Z",
            routineId: 3,
          },
        ],
      },
      "log routine ID",
    ],
  ])("rejects malformed routine data (%#)", (patch, message) => {
    expect(() => validateImport({ ...createEmptyState(), ...patch })).toThrow(
      message,
    );
  });
});
