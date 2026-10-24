import type { AppState } from "./model";
import { addDays, LOG_CATEGORIES, weekStart } from "./activityLog.js";
import type { LogCategory, LogEntry } from "./activityLog";
import { localDateKey } from "./schedule.js";

export const MAX_ROUTINE_TITLE_LENGTH = 200;
export const MAX_ROUTINE_MINUTES = 24 * 60;
export const MAX_WEEKLY_GOAL = 21;

/** Something done every week without a set time, logged with one tap. */
export interface RoutineItem {
  id: string;
  title: string;
  category: LogCategory;
  /** Used to place the logged activity: it ends when logged. */
  durationMinutes: number;
  /** An optional minimum number of times per week. */
  weeklyGoal?: number;
  createdAt: string;
}
export type RoutineDraft = Pick<
  RoutineItem,
  "title" | "category" | "durationMinutes" | "weeklyGoal"
>;

/** A calendar item that repeats every week at a local day and time. */
export interface WeeklyItem {
  id: string;
  title: string;
  /** 0 = Sunday … 6 = Saturday, in the viewer's local time. */
  weekday: number;
  /** Local wall-clock time as HH:MM. */
  time: string;
  createdAt: string;
}
export type WeeklyDraft = Pick<WeeklyItem, "title" | "weekday" | "time">;

export interface WeeklyOccurrence {
  source: "weekly";
  id: string;
  weeklyItemId: string;
  title: string;
  scheduledAt: string;
  weekday: number;
}

/** Shared by the editors and backup validation; throws a readable message. */
export function checkRoutine(draft: RoutineDraft): RoutineDraft {
  const title = String(draft.title ?? "").trim();
  if (!title || title.length > MAX_ROUTINE_TITLE_LENGTH)
    throw new Error("Give the routine item a name of 1–200 characters.");
  if (!LOG_CATEGORIES.includes(draft.category))
    throw new Error("Choose a type for this routine item.");
  if (
    !Number.isInteger(draft.durationMinutes) ||
    draft.durationMinutes < 1 ||
    draft.durationMinutes > MAX_ROUTINE_MINUTES
  )
    throw new Error("Choose a usual duration from 1 minute to 24 hours.");
  if (
    draft.weeklyGoal !== undefined &&
    (!Number.isInteger(draft.weeklyGoal) ||
      draft.weeklyGoal < 1 ||
      draft.weeklyGoal > MAX_WEEKLY_GOAL)
  )
    throw new Error("Choose a weekly goal from 1 to 21, or leave it blank.");
  return {
    title,
    category: draft.category,
    durationMinutes: draft.durationMinutes,
    ...(draft.weeklyGoal === undefined ? {} : { weeklyGoal: draft.weeklyGoal }),
  };
}

export function checkWeeklyItem(draft: WeeklyDraft): WeeklyDraft {
  const title = String(draft.title ?? "").trim();
  if (!title || title.length > MAX_ROUTINE_TITLE_LENGTH)
    throw new Error("Give the weekly item a name of 1–200 characters.");
  if (
    !Number.isInteger(draft.weekday) ||
    draft.weekday < 0 ||
    draft.weekday > 6
  )
    throw new Error("Choose a day of the week.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(draft.time)))
    throw new Error("Choose a time.");
  return { title, weekday: draft.weekday, time: draft.time };
}

export function saveRoutine(
  state: AppState,
  draft: RoutineDraft,
  routineId?: string,
): AppState {
  const fields = checkRoutine(draft);
  const routines = state.routines ?? [];
  const existing = routines.find((routine) => routine.id === routineId);
  if (routineId && !existing)
    throw new Error(
      "This routine item was removed. Reopen Routine to continue.",
    );
  if (existing) {
    const { weeklyGoal: _cleared, ...rest } = existing;
    const routine: RoutineItem = { ...rest, ...fields };
    return {
      ...state,
      routines: routines.map((value) =>
        value.id === routineId ? routine : value,
      ),
    };
  }
  return {
    ...state,
    routines: [
      ...routines,
      {
        id: crypto.randomUUID(),
        ...fields,
        createdAt: new Date().toISOString(),
      },
    ],
  };
}

export function removeRoutine(state: AppState, routineId: string): AppState {
  return {
    ...state,
    routines: (state.routines ?? []).filter(
      (routine) => routine.id !== routineId,
    ),
  };
}

/** Logs the routine as an activity ending now that lasted its usual time. */
export function logRoutine(
  state: AppState,
  routineId: string,
  entryId: string = crypto.randomUUID(),
  at: number = Date.now(),
): AppState {
  const routine = (state.routines ?? []).find(
    (value) => value.id === routineId,
  );
  if (!routine)
    throw new Error(
      "This routine item was removed. Reopen Routine to continue.",
    );
  const endedAt = new Date(at).toISOString();
  const entry: LogEntry = {
    id: entryId,
    title: routine.title,
    category: routine.category,
    startedAt: new Date(at - routine.durationMinutes * 60_000).toISOString(),
    endedAt,
    createdAt: endedAt,
    routineId: routine.id,
  };
  return { ...state, activityLog: [...(state.activityLog ?? []), entry] };
}

/** Times logged this Monday–Sunday week, and the most recent entry ever. */
export function routineProgress(
  state: AppState,
  at: number = Date.now(),
): Map<string, { count: number; last: LogEntry | null }> {
  const from = weekStart(new Date(at)).getTime();
  const until = addDays(new Date(from), 7).getTime();
  const progress = new Map<string, { count: number; last: LogEntry | null }>();
  for (const routine of state.routines ?? [])
    progress.set(routine.id, { count: 0, last: null });
  for (const entry of state.activityLog ?? []) {
    const current = entry.routineId ? progress.get(entry.routineId) : undefined;
    if (!current) continue;
    const ended = Date.parse(entry.endedAt);
    if (ended >= from && ended < until) current.count++;
    if (!current.last || ended > Date.parse(current.last.endedAt))
      current.last = entry;
  }
  return progress;
}

export const STARTER_ROUTINE: RoutineDraft[] = [
  { title: "Walk the dog", category: "other", durationMinutes: 30 },
  { title: "Do laundry", category: "other", durationMinutes: 30 },
  { title: "Sleep", category: "sleep", durationMinutes: 480 },
  { title: "Eat", category: "meal", durationMinutes: 30 },
  {
    title: "Buy groceries and supplies",
    category: "other",
    durationMinutes: 60,
  },
  {
    title: "Refill the dog’s water tank and bowl",
    category: "other",
    durationMinutes: 5,
  },
  {
    title: "Workout",
    category: "exercise",
    durationMinutes: 45,
    weeklyGoal: 2,
  },
];

export function addStarterRoutine(state: AppState): AppState {
  const existing = new Set(
    (state.routines ?? []).map((routine) => routine.title.toLowerCase()),
  );
  return STARTER_ROUTINE.filter(
    (draft) => !existing.has(draft.title.toLowerCase()),
  ).reduce((next, draft) => saveRoutine(next, draft), state);
}

export function saveWeeklyItem(
  state: AppState,
  draft: WeeklyDraft,
  itemId?: string,
): AppState {
  const fields = checkWeeklyItem(draft);
  const items = state.weeklyItems ?? [];
  const existing = items.find((item) => item.id === itemId);
  if (itemId && !existing)
    throw new Error(
      "This weekly item was removed. Reopen Routine to continue.",
    );
  return {
    ...state,
    weeklyItems: existing
      ? items.map((item) =>
          item.id === itemId ? { ...item, ...fields } : item,
        )
      : [
          ...items,
          {
            id: crypto.randomUUID(),
            ...fields,
            createdAt: new Date().toISOString(),
          },
        ],
  };
}

export function removeWeeklyItem(state: AppState, itemId: string): AppState {
  return {
    ...state,
    weeklyItems: (state.weeklyItems ?? []).filter((item) => item.id !== itemId),
  };
}

/** Sunday-first order by day, then time, matching the calendar's weeks. */
export function sortWeeklyItems(items: WeeklyItem[]): WeeklyItem[] {
  return [...items].sort(
    (a, b) =>
      a.weekday - b.weekday ||
      a.time.localeCompare(b.time) ||
      a.title.localeCompare(b.title),
  );
}

/**
 * Occurrences on each local day in [from, from + days), starting from the day
 * the item was added so it never appears in weeks before it existed.
 */
export function weeklyOccurrences(
  items: WeeklyItem[],
  from: Date,
  days: number,
): WeeklyOccurrence[] {
  const occurrences: WeeklyOccurrence[] = [];
  for (let offset = 0; offset < days; offset++) {
    const day = addDays(from, offset);
    const key = localDateKey(day);
    for (const item of items) {
      if (item.weekday !== day.getDay()) continue;
      if (key < localDateKey(new Date(item.createdAt))) continue;
      const [hours, minutes] = item.time.split(":").map(Number);
      occurrences.push({
        source: "weekly",
        id: `weekly:${item.id}:${key}`,
        weeklyItemId: item.id,
        title: item.title,
        scheduledAt: new Date(
          day.getFullYear(),
          day.getMonth(),
          day.getDate(),
          hours,
          minutes,
        ).toISOString(),
        weekday: item.weekday,
      });
    }
  }
  return occurrences;
}

/** The next occurrence at or after `at`, for the Routine page summary. */
export function nextOccurrence(
  item: WeeklyItem,
  at: number = Date.now(),
): Date {
  const [occurrence] = weeklyOccurrences(
    [{ ...item, createdAt: new Date(0).toISOString() }],
    new Date(new Date(at).setHours(0, 0, 0, 0)),
    8,
  ).filter((value) => Date.parse(value.scheduledAt) >= at);
  return new Date(occurrence.scheduledAt);
}
