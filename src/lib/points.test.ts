import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addItem,
  completeCurrent,
  createEmptyState,
  currentQueueEntry,
  duplicateItem,
  putBackItem,
  renameItem,
  takeBite,
  validateImport,
} from "./model";
import type { AppState, Item } from "./model";
import {
  checkItemPoints,
  describePoints,
  earnedPoints,
  formatPoints,
  inferQuantity,
  nextWeeklyTarget,
  pointsSummary,
  rollPointsWeek,
  setWeeklyTarget,
  setWeekStart,
} from "./points";

// Monday 26 October 2026, local time.
const at = (day: number, hour = 12, minute = 0) =>
  new Date(2026, 9, day, hour, minute).getTime();
const done = (id: string, day: number, pointsEarned: number): Item => ({
  id,
  projectId: null,
  title: id,
  createdAt: new Date(at(day, 8)).toISOString(),
  completedAt: new Date(at(day)).toISOString(),
  pointsEarned,
});
const withGoal = (items: Item[], weeklyTarget = 700): AppState => ({
  ...createEmptyState(),
  items,
  pointsGoal: { weeklyTarget, weekOf: "2026-10-26", history: [] },
});
afterEach(() => vi.useRealTimers());

describe("item points", () => {
  it("describes fixed, per-minute, and per-unit points with decimals", () => {
    expect(describePoints({ kind: "fixed", value: 5 })).toBe("5 points");
    expect(describePoints({ kind: "fixed", value: 1 })).toBe("1 point");
    expect(describePoints({ kind: "perMinute", value: 2.5 })).toBe(
      "2.5 points per minute",
    );
    expect(describePoints({ kind: "perUnit", value: 1 })).toBe("1 point each");
    expect(formatPoints(0.1 + 0.2)).toBe("0.3");
    expect(formatPoints(750 / 7)).toBe("107.14");
  });

  it("validates kinds and values, rounding to hundredths", () => {
    expect(checkItemPoints({ kind: "perUnit", value: 0.255 })).toEqual({
      kind: "perUnit",
      value: 0.26,
    });
    for (const value of [0, -1, 0.001, 100_001, NaN, Infinity])
      expect(() => checkItemPoints({ kind: "fixed", value })).toThrow(
        "Enter a point value from 0.01 to 100,000.",
      );
    expect(() =>
      checkItemPoints({ kind: "bonus" as "fixed", value: 1 }),
    ).toThrow("Choose how this item earns points.");
  });

  it("earns fixed points once and rate points per minute or unit", () => {
    expect(earnedPoints({ kind: "fixed", value: 5 }, 99)).toBe(5);
    expect(earnedPoints({ kind: "perMinute", value: 1 }, 10)).toBe(10);
    expect(earnedPoints({ kind: "perUnit", value: 0.5 }, 5)).toBe(2.5);
    expect(earnedPoints({ kind: "perUnit", value: 0.1 }, 3)).toBe(0.3);
    expect(earnedPoints({ kind: "perUnit", value: 1 }, 0)).toBe(0);
    expect(() => earnedPoints({ kind: "perMinute", value: 1 })).toThrow(
      "Enter the minutes you worked",
    );
    expect(() => earnedPoints({ kind: "perUnit", value: 1 }, -1)).toThrow(
      "Enter how many you completed",
    );
  });

  it("suggests a quantity from the first standalone number in a title", () => {
    expect(inferQuantity("Send out 5 emails")).toBe(5);
    expect(inferQuantity("Read 12.5 pages")).toBe(12.5);
    expect(inferQuantity("Draft Q4 plan")).toBeNull();
    expect(inferQuantity("Call at 3:30")).toBeNull();
    expect(inferQuantity("Do laundry")).toBeNull();
    expect(inferQuantity("Send 0 emails")).toBeNull();
  });
});

describe("weekly goal", () => {
  it("raises the goal by half a surplus and lowers it by twice a shortfall", () => {
    expect(nextWeeklyTarget(700, 800)).toBe(750);
    expect(nextWeeklyTarget(700, 650)).toBe(600);
    expect(nextWeeklyTarget(700, 700)).toBe(700);
    expect(nextWeeklyTarget(700, 701)).toBe(700.5);
    // A very hard week can't push the goal to zero or below.
    expect(nextWeeklyTarget(700, 300)).toBe(7);
    expect(nextWeeklyTarget(700, 0)).toBe(7);
  });

  it("splits the goal into a daily share and tracks schedule from finished days", () => {
    // Monday morning: nothing yet.
    let summary = pointsSummary(withGoal([]), at(26, 9));
    expect(summary).toMatchObject({
      today: 0,
      week: 0,
      dayOfWeek: 0,
      weeklyTarget: 700,
      dailyTarget: 100,
      pace: 0,
      neededToday: 100,
    });
    // 150 points on Monday, seen on Tuesday.
    const state = withGoal([done("a", 26, 100), done("b", 26, 50)]);
    summary = pointsSummary(state, at(27, 9));
    expect(summary).toMatchObject({
      today: 0,
      week: 150,
      dayOfWeek: 1,
      dailyTarget: 100,
      pace: 50,
      neededToday: 50,
    });
    // Nothing more by Thursday: two days' share behind.
    summary = pointsSummary(state, at(29, 9));
    expect(summary).toMatchObject({ week: 150, pace: -150, neededToday: 250 });
  });

  it("counts points only within the local day and week", () => {
    const state = withGoal([
      done("last-sunday", 25, 40),
      done("monday", 26, 10),
      {
        ...done("late", 27, 5),
        completedAt: new Date(at(27, 23, 59)).toISOString(),
      },
      { ...done("unscored", 27, 0), pointsEarned: undefined },
    ]);
    expect(pointsSummary(state, at(27, 10))).toMatchObject({
      today: 5,
      week: 15,
    });
    expect(pointsSummary(state, at(28, 0, 1)).today).toBe(0);
  });

  it("shows points without a goal", () => {
    const state = { ...createEmptyState(), items: [done("a", 26, 3.5)] };
    expect(pointsSummary(state, at(26, 18))).toMatchObject({
      today: 3.5,
      week: 3.5,
      weeklyTarget: null,
      dailyTarget: null,
      pace: null,
      neededToday: null,
      lastWeek: null,
    });
  });

  it("closes finished weeks, including weeks with nothing done", () => {
    const state = withGoal([done("a", 26, 500), done("b", 30, 300)]);
    expect(rollPointsWeek(state, at(1, 23))).toBe(state); // Sunday, same week
    // Next Monday: 800 of 700 → 750.
    const rolled = rollPointsWeek(state, new Date(2026, 10, 2, 9).getTime());
    expect(rolled.pointsGoal).toEqual({
      weeklyTarget: 750,
      weekOf: "2026-11-02",
      history: [{ weekOf: "2026-10-26", target: 700, earned: 800 }],
    });
    // Two weeks later with an empty week between: 750 then 0 of 750 → 7.
    const later = rollPointsWeek(state, new Date(2026, 10, 10).getTime());
    expect(later.pointsGoal).toEqual({
      weeklyTarget: 7,
      weekOf: "2026-11-09",
      history: [
        { weekOf: "2026-10-26", target: 700, earned: 800 },
        { weekOf: "2026-11-02", target: 750, earned: 0 },
      ],
    });
    expect(
      pointsSummary(state, new Date(2026, 10, 2, 9).getTime()),
    ).toMatchObject({
      weeklyTarget: 750,
      week: 0,
      lastWeek: { target: 700, earned: 800 },
    });
    const missed = withGoal([done("a", 26, 650)]);
    expect(
      rollPointsWeek(missed, new Date(2026, 10, 2).getTime()).pointsGoal
        ?.weeklyTarget,
    ).toBe(600);
    expect(rollPointsWeek(createEmptyState(), at(30))).toEqual(
      createEmptyState(),
    );
  });

  it("sets a goal for this week and keeps finished-week history", () => {
    let state = setWeeklyTarget(createEmptyState(), 700, at(28));
    expect(state.pointsGoal).toEqual({
      weeklyTarget: 700,
      weekOf: "2026-10-26",
      history: [],
    });
    state = setWeeklyTarget(state, 812.345, at(29));
    expect(state.pointsGoal?.weeklyTarget).toBe(812.35);
    expect(() => setWeeklyTarget(state, 6, at(29))).toThrow(
      "Choose a weekly goal from 7 to 1,000,000 points.",
    );
    state = setWeeklyTarget(state, 700, new Date(2026, 10, 3).getTime());
    expect(state.pointsGoal).toMatchObject({
      weeklyTarget: 700,
      weekOf: "2026-11-02",
      history: [{ weekOf: "2026-10-26", target: 812.35, earned: 0 }],
    });
  });

  it("starts weeks on the chosen day", () => {
    // Sunday 1 November: last day of a Monday week, first of a Sunday week.
    const state = withGoal([done("sat", 31, 20), done("sun", 32, 10)]);
    const sunday = new Date(2026, 10, 1, 12).getTime();
    expect(pointsSummary(state, sunday)).toMatchObject({
      week: 30,
      dayOfWeek: 6,
    });
    const changed = setWeekStart(state, 0, sunday);
    expect(changed.settings.weekStartsOn).toBe(0);
    expect(changed.pointsGoal).toMatchObject({
      weeklyTarget: 700,
      weekOf: "2026-11-01",
    });
    expect(pointsSummary(changed, sunday)).toMatchObject({
      week: 10,
      today: 10,
      dayOfWeek: 0,
      pace: 10,
    });
    expect(() => setWeekStart(state, 7, sunday)).toThrow(
      "Choose a day of the week.",
    );
  });
});

describe("points on items", () => {
  const queued = (points: Item["points"], title = "Task") =>
    addItem(createEmptyState(), title, null, undefined, points);

  it("records points earned when completing the current item", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(26, 10));
    let state = completeCurrent(queued({ kind: "fixed", value: 5 }));
    expect(state.items[0]).toMatchObject({
      points: { kind: "fixed", value: 5 },
      pointsEarned: 5,
    });
    expect(state.items[0].pointsQuantity).toBeUndefined();

    state = completeCurrent(
      queued({ kind: "perUnit", value: 1 }, "Send 5 emails"),
      undefined,
      6,
    );
    expect(state.items[0]).toMatchObject({
      pointsEarned: 6,
      pointsQuantity: 6,
    });

    // Per-minute items use entered minutes, or else the saved timer.
    state = completeCurrent(queued({ kind: "perMinute", value: 2 }), 330, 10);
    expect(state.items[0]).toMatchObject({
      timeSpentSeconds: 330,
      pointsEarned: 20,
      pointsQuantity: 10,
    });
    state = completeCurrent(queued({ kind: "perMinute", value: 2 }), 330);
    expect(state.items[0]).toMatchObject({
      pointsEarned: 11,
      pointsQuantity: 5.5,
    });
    expect(() =>
      completeCurrent(queued({ kind: "perMinute", value: 2 })),
    ).toThrow("Enter the minutes you worked");

    state = completeCurrent(queued(undefined));
    expect(state.items[0].pointsEarned).toBeUndefined();
  });

  it("clears earned points when put back, and keeps rates on copies and bites", () => {
    let state = completeCurrent(
      queued({ kind: "perUnit", value: 1 }),
      undefined,
      3,
    );
    state = putBackItem(state, state.items[0].id);
    expect(state.items[0]).toEqual(
      expect.not.objectContaining({ pointsEarned: expect.anything() }),
    );
    expect(state.items[0].pointsQuantity).toBeUndefined();
    expect(state.items[0].points).toEqual({ kind: "perUnit", value: 1 });

    state = duplicateItem(state, state.items[0].id);
    expect(state.items.map((item) => item.points)).toEqual([
      { kind: "perUnit", value: 1 },
      { kind: "perUnit", value: 1 },
    ]);

    let bitten = takeBite(
      queued({ kind: "perMinute", value: 1 }),
      "Start",
      "Finish",
    );
    expect(bitten.items.map((item) => item.points)).toEqual([
      { kind: "perMinute", value: 1 },
      { kind: "perMinute", value: 1 },
    ]);
    // A fixed award stays with the original so splitting can't double it.
    bitten = takeBite(queued({ kind: "fixed", value: 5 }), "Sort", "Wash");
    expect(bitten.items.map((item) => item.points)).toEqual([
      { kind: "fixed", value: 5 },
      undefined,
    ]);
  });

  it("sets, keeps, and clears points when editing an item", () => {
    let state = queued(undefined);
    const id = state.items[0].id;
    state = renameItem(state, id, "Task", { kind: "fixed", value: 2.5 });
    expect(state.items[0].points).toEqual({ kind: "fixed", value: 2.5 });
    state = renameItem(state, id, "Renamed");
    expect(state.items[0].points).toEqual({ kind: "fixed", value: 2.5 });
    state = renameItem(state, id, "Renamed", null);
    expect(state.items[0].points).toBeUndefined();
    expect(() =>
      renameItem(state, id, "Renamed", { kind: "fixed", value: 0 }),
    ).toThrow("Enter a point value");
    expect(currentQueueEntry(state)?.item.title).toBe("Renamed");
  });

  it("round-trips points through backups and rejects invalid points", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(26, 10));
    let state = completeCurrent(
      queued({ kind: "perUnit", value: 1.5 }),
      undefined,
      4,
    );
    state = addItem(state, "Next", null, undefined, {
      kind: "perMinute",
      value: 1,
    });
    state = setWeekStart(setWeeklyTarget(state, 700), 0);
    const restored = validateImport(JSON.parse(JSON.stringify(state)));
    expect(restored).toEqual(state);
    expect(restored.items[0]).toMatchObject({
      pointsEarned: 6,
      pointsQuantity: 4,
    });
    expect(restored.settings.weekStartsOn).toBe(0);
    expect(
      validateImport({ ...state, pointsGoal: null }).pointsGoal,
    ).toBeNull();

    const pending = state.items[1];
    const invalid: [unknown, string][] = [
      [
        { ...state, settings: { ...state.settings, weekStartsOn: 7 } },
        "week must start",
      ],
      [
        {
          ...state,
          items: [
            state.items[0],
            { ...pending, points: { kind: "fixed", value: -1 } },
          ],
        },
        "Invalid backup: Enter a point value",
      ],
      [
        { ...state, items: [state.items[0], { ...pending, pointsEarned: 3 }] },
        "only completed items",
      ],
      [
        {
          ...state,
          items: [{ ...state.items[0], pointsEarned: undefined }, pending],
        },
        "needs its earned points",
      ],
      [
        {
          ...state,
          items: [{ ...state.items[0], pointsEarned: "6" }, pending],
        },
        "points earned is out of range",
      ],
      [
        { ...state, pointsGoal: { ...state.pointsGoal, weeklyTarget: 3 } },
        "weekly points goal is out of range",
      ],
      [
        { ...state, pointsGoal: { ...state.pointsGoal, weekOf: "2026-02-30" } },
        "points week must be a valid date",
      ],
      [
        {
          ...state,
          pointsGoal: {
            ...state.pointsGoal,
            history: [{ weekOf: "2026-10-19", target: 700 }],
          },
        },
        "points history week is invalid",
      ],
    ];
    for (const [data, message] of invalid)
      expect(() => validateImport(data)).toThrow(message);
  });
});
