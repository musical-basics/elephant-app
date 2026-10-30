import type { AppState, Item } from "./model";
import { addDays } from "./activityLog.js";
import { localDateKey } from "./schedule.js";

export const POINTS_KINDS = ["fixed", "perMinute", "perUnit"] as const;
export type PointsKind = (typeof POINTS_KINDS)[number];

/** How completing an item earns points: once, or per minute or unit of work. */
export interface ItemPoints {
  kind: PointsKind;
  value: number;
}

/** A finished week: the target it had and what was earned against it. */
export interface PointsWeek {
  weekOf: string;
  target: number;
  earned: number;
}

export interface PointsGoal {
  weeklyTarget: number;
  /** Local date (YYYY-MM-DD) of the first day of the week this target is for. */
  weekOf: string;
  /** Closed weeks, oldest first. */
  history: PointsWeek[];
}

export interface PointsSummary {
  today: number;
  week: number;
  /** 0 on the first day of the week, 6 on the last. */
  dayOfWeek: number;
  weeklyTarget: number | null;
  dailyTarget: number | null;
  /** Points above (+) or below (−) the target for the days already finished. */
  pace: number | null;
  /** Points still needed today to be on schedule by tonight. */
  neededToday: number | null;
  lastWeek: PointsWeek | null;
}

export const MAX_POINTS_VALUE = 100_000;
export const MAX_POINTS_QUANTITY = 100_000;
/** One point a day, so a hard week never leaves a zero or negative goal. */
export const MIN_WEEKLY_TARGET = 7;
export const MAX_WEEKLY_TARGET = 1_000_000;
export const DEFAULT_WEEK_START = 1;
export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** Two decimal places keeps sums like 0.1 + 0.2 displaying as 0.3. */
export function roundPoints(value: number): number {
  return Math.round(value * 100) / 100;
}

export function formatPoints(value: number): string {
  return roundPoints(value).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}

/** "5 points", "2 points per minute", "1 point each". */
export function describePoints(points: ItemPoints): string {
  const amount = `${formatPoints(points.value)} ${points.value === 1 ? "point" : "points"}`;
  return points.kind === "fixed"
    ? amount
    : points.kind === "perMinute"
      ? `${amount} per minute`
      : `${amount} each`;
}

/** Compact form for list rows: "5 pts", "2 pts/min", "1 pt each". */
export function shortPoints(points: ItemPoints): string {
  const amount = `${formatPoints(points.value)} ${points.value === 1 ? "pt" : "pts"}`;
  return points.kind === "fixed"
    ? amount
    : points.kind === "perMinute"
      ? `${amount}/min`
      : `${amount} each`;
}

/** Shared by the item editors and backup validation; throws a readable message. */
export function checkItemPoints(points: ItemPoints): ItemPoints {
  if (!POINTS_KINDS.includes(points?.kind))
    throw new Error("Choose how this item earns points.");
  const value =
    typeof points.value === "number" ? roundPoints(points.value) : NaN;
  if (!Number.isFinite(value) || value <= 0 || value > MAX_POINTS_VALUE)
    throw new Error("Enter a point value from 0.01 to 100,000.");
  return { kind: points.kind, value };
}

/** Points for one completion. Rate-based items need the minutes or units done. */
export function earnedPoints(points: ItemPoints, quantity?: number): number {
  if (points.kind === "fixed") return points.value;
  if (
    quantity === undefined ||
    !Number.isFinite(quantity) ||
    quantity < 0 ||
    quantity > MAX_POINTS_QUANTITY
  )
    throw new Error(
      points.kind === "perMinute"
        ? "Enter the minutes you worked, from 0 to 100,000."
        : "Enter how many you completed, from 0 to 100,000.",
    );
  return roundPoints(points.value * quantity);
}

/** A sensible starting count for "Send out 5 emails": the first standalone number. */
export function inferQuantity(title: string): number | null {
  const match =
    /(?<![\p{L}\p{N}_.,:/-])(\d+(?:\.\d+)?)(?![\p{L}\p{N}_:/]|[.,]\d)/u.exec(
      title,
    );
  const value = match ? Number(match[1]) : NaN;
  return value > 0 && value <= MAX_POINTS_QUANTITY ? value : null;
}

export function weekStartsOn(state: AppState): number {
  return state.settings.weekStartsOn ?? DEFAULT_WEEK_START;
}

export function pointsWeekStart(date: Date, startsOn: number): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() - ((date.getDay() - startsOn + 7) % 7),
  );
}

function dateFromKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function pointsBetween(
  items: readonly Item[],
  from: number,
  until: number,
): number {
  let total = 0;
  for (const item of items) {
    if (item.pointsEarned === undefined || !item.completedAt) continue;
    const at = Date.parse(item.completedAt);
    if (at >= from && at < until) total += item.pointsEarned;
  }
  return roundPoints(total);
}

/** Beating the goal raises it by half the surplus; missing it lowers it by twice the gap. */
export function nextWeeklyTarget(target: number, earned: number): number {
  const next =
    earned >= target
      ? target + (earned - target) / 2
      : target - (target - earned) * 2;
  return Math.min(
    MAX_WEEKLY_TARGET,
    Math.max(MIN_WEEKLY_TARGET, roundPoints(next)),
  );
}

/** Closes every finished week, setting each new target from what was earned. */
export function rollPointsWeek(
  state: AppState,
  at: number = Date.now(),
): AppState {
  const goal = state.pointsGoal;
  if (!goal) return state;
  const current = localDateKey(
    pointsWeekStart(new Date(at), weekStartsOn(state)),
  );
  if (goal.weekOf >= current) return state;
  const history = [...goal.history];
  let weeklyTarget = goal.weeklyTarget;
  let start = dateFromKey(goal.weekOf);
  for (let end = addDays(start, 7); localDateKey(end) <= current;) {
    const earned = pointsBetween(state.items, start.getTime(), end.getTime());
    history.push({ weekOf: localDateKey(start), target: weeklyTarget, earned });
    weeklyTarget = nextWeeklyTarget(weeklyTarget, earned);
    start = end;
    end = addDays(start, 7);
  }
  return {
    ...state,
    pointsGoal: { weeklyTarget, weekOf: current, history },
  };
}

export function setWeeklyTarget(
  state: AppState,
  target: number,
  at: number = Date.now(),
): AppState {
  const value = roundPoints(target);
  if (
    !Number.isFinite(value) ||
    value < MIN_WEEKLY_TARGET ||
    value > MAX_WEEKLY_TARGET
  )
    throw new Error("Choose a weekly goal from 7 to 1,000,000 points.");
  const rolled = rollPointsWeek(state, at);
  return {
    ...rolled,
    pointsGoal: {
      weeklyTarget: value,
      weekOf:
        rolled.pointsGoal?.weekOf ??
        localDateKey(pointsWeekStart(new Date(at), weekStartsOn(state))),
      history: rolled.pointsGoal?.history ?? [],
    },
  };
}

/** Finished weeks close on the old boundary; the current target carries over. */
export function setWeekStart(
  state: AppState,
  weekday: number,
  at: number = Date.now(),
): AppState {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6)
    throw new Error("Choose a day of the week.");
  const rolled = rollPointsWeek(state, at);
  return {
    ...rolled,
    settings: { ...rolled.settings, weekStartsOn: weekday },
    ...(rolled.pointsGoal
      ? {
          pointsGoal: {
            ...rolled.pointsGoal,
            weekOf: localDateKey(pointsWeekStart(new Date(at), weekday)),
          },
        }
      : {}),
  };
}

export function pointsSummary(
  state: AppState,
  at: number = Date.now(),
): PointsSummary {
  const goal = rollPointsWeek(state, at).pointsGoal ?? null;
  const now = new Date(at);
  const startsOn = weekStartsOn(state);
  const start = pointsWeekStart(now, startsOn);
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const today = pointsBetween(
    state.items,
    midnight.getTime(),
    addDays(midnight, 1).getTime(),
  );
  const week = pointsBetween(
    state.items,
    start.getTime(),
    addDays(start, 7).getTime(),
  );
  const dayOfWeek = (now.getDay() - startsOn + 7) % 7;
  const weeklyTarget = goal?.weeklyTarget ?? null;
  const dailyTarget = weeklyTarget === null ? null : weeklyTarget / 7;
  return {
    today,
    week,
    dayOfWeek,
    weeklyTarget,
    dailyTarget: dailyTarget === null ? null : roundPoints(dailyTarget),
    pace:
      dailyTarget === null ? null : roundPoints(week - dailyTarget * dayOfWeek),
    neededToday:
      dailyTarget === null
        ? null
        : roundPoints(Math.max(0, dailyTarget * (dayOfWeek + 1) - week)),
    lastWeek: goal?.history.at(-1) ?? null,
  };
}

/** Backup validation for the stored goal; throws a readable message. */
export function checkPointsGoal(value: PointsGoal): PointsGoal {
  const date = (key: unknown) =>
    typeof key === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(key) &&
    localDateKey(dateFromKey(key)) === key;
  const amount = (number: unknown, min: number) =>
    typeof number === "number" &&
    Number.isFinite(number) &&
    number >= min &&
    number <= MAX_WEEKLY_TARGET * 100;
  if (!value || typeof value !== "object")
    throw new Error("the points goal must be an object.");
  if (
    !amount(value.weeklyTarget, MIN_WEEKLY_TARGET) ||
    value.weeklyTarget > MAX_WEEKLY_TARGET
  )
    throw new Error("the weekly points goal is out of range.");
  if (!date(value.weekOf))
    throw new Error("the points week must be a valid date.");
  if (!Array.isArray(value.history))
    throw new Error("the points history must be a list.");
  const history = value.history.map((week): PointsWeek => {
    if (
      !week ||
      !date(week.weekOf) ||
      !amount(week.target, 0) ||
      !amount(week.earned, 0)
    )
      throw new Error("a points history week is invalid.");
    return { weekOf: week.weekOf, target: week.target, earned: week.earned };
  });
  return { weeklyTarget: value.weeklyTarget, weekOf: value.weekOf, history };
}
