import type { AppState, Item } from "./model";

export const LOG_CATEGORIES = [
  "task",
  "sleep",
  "meal",
  "exercise",
  "other",
] as const;
export type LogCategory = (typeof LOG_CATEGORIES)[number];
export const MIN_LOG_MINUTES = 37.5; // 40 px at 64 px/hour; keep short blocks editable.
export interface LogEntry {
  id: string;
  title: string;
  category: LogCategory;
  startedAt: string | null;
  endedAt: string;
  createdAt: string;
  taskId?: string;
  scheduledItemId?: string;
  inferred?: boolean;
}
export type LogDraft = Pick<
  LogEntry,
  "title" | "category" | "startedAt" | "endedAt"
>;

/** Edited log endpoints take precedence over their original task timestamps. */
export function latestLogEndpoint(
  state: AppState,
  before = Date.now(),
): number | null {
  const loggedTasks = new Set(
    (state.activityLog ?? []).map((entry) => entry.taskId),
  );
  const loggedScheduled = new Set(
    (state.activityLog ?? []).map((entry) => entry.scheduledItemId),
  );
  const endpoints = [
    ...(state.activityLog ?? []).map((entry) => Date.parse(entry.endedAt)),
    ...state.items
      .filter((item) => !loggedTasks.has(item.id) && item.completedAt)
      .map((item) => Date.parse(item.completedAt!)),
    ...state.scheduledItems
      .filter((item) => !loggedScheduled.has(item.id) && item.completedAt)
      .map((item) => Date.parse(item.completedAt!)),
  ].filter((time) => Number.isFinite(time) && time <= before);
  return endpoints.length ? Math.max(...endpoints) : null;
}

export function logCompletedTask(
  state: AppState,
  item: Pick<Item, "id" | "title">,
  endedAt: string,
  trackedSeconds?: number,
): LogEntry {
  const end = Date.parse(endedAt);
  const previous = latestLogEndpoint(state, end);
  const start =
    previous ??
    (trackedSeconds === undefined ? null : end - trackedSeconds * 1000);
  const startDate = start === null ? null : new Date(start);
  const validStart =
    startDate &&
    Number.isFinite(startDate.getTime()) &&
    startDate.getUTCFullYear() >= 0 &&
    startDate.getUTCFullYear() <= 9999;
  return {
    id: crypto.randomUUID(),
    title: item.title.slice(0, 500),
    category: "task",
    startedAt: validStart ? startDate.toISOString() : null,
    endedAt,
    createdAt: endedAt,
    taskId: item.id,
    inferred: true,
  };
}

export function saveLogEntry(
  state: AppState,
  draft: LogDraft,
  entryId?: string,
): AppState {
  const title = draft.title.trim();
  const start = draft.startedAt === null ? NaN : Date.parse(draft.startedAt);
  const end = Date.parse(draft.endedAt);
  const entries = state.activityLog ?? [];
  const existing = entries.find((entry) => entry.id === entryId);
  const unchangedInstant =
    existing?.startedAt === draft.startedAt &&
    existing?.endedAt === draft.endedAt &&
    start === end;
  if (!title || title.length > 500)
    throw new Error("Enter an activity name of 1–500 characters.");
  if (!LOG_CATEGORIES.includes(draft.category))
    throw new Error("Choose an activity type.");
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end < start ||
    (end === start && !unchangedInstant)
  )
    throw new Error(
      "The end must be later than the start. For an overnight activity, choose the next date.",
    );
  if (entryId && !existing)
    throw new Error("This log entry was removed. Reopen the log to continue.");
  const entry: LogEntry = {
    ...existing,
    id: existing?.id ?? crypto.randomUUID(),
    title,
    category: draft.category,
    startedAt: new Date(start).toISOString(),
    endedAt: new Date(end).toISOString(),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    inferred: false,
  };
  return {
    ...state,
    activityLog: existing
      ? entries.map((value) => (value.id === entryId ? entry : value))
      : [...entries, entry],
  };
}

export function removeLogEntry(state: AppState, id: string): AppState {
  return {
    ...state,
    activityLog: (state.activityLog ?? []).filter((entry) => entry.id !== id),
  };
}

export function weekStart(date: Date): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  return result;
}
export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}
export function minutesOnDay(time: number): number {
  const date = new Date(time);
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}
export function timeAtMinute(day: Date, minute: number): string {
  const date = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    0,
    minute,
  );
  // A spring-forward time that does not exist cannot be silently saved.
  if (
    minute >= 0 &&
    minute < 1440 &&
    date.getHours() * 60 + date.getMinutes() !== minute
  )
    throw new Error(
      "That time is skipped by daylight saving time. Choose another time.",
    );
  return date.toISOString();
}
export function localDateTime(iso: string): string {
  const date = new Date(iso);
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function parseLocalDateTime(value: string): string {
  const date = new Date(value);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ||
    !Number.isFinite(date.getTime()) ||
    localDateTime(date.toISOString()) !== value
  )
    throw new Error("Choose a valid local date and time.");
  return date.toISOString();
}
export function logDuration(entry: LogEntry): string {
  if (entry.startedAt === null) return "Set start time";
  const minutes = Math.round(
    (Date.parse(entry.endedAt) - Date.parse(entry.startedAt)) / 60000,
  );
  return minutes < 60
    ? `${minutes}m`
    : `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
}

export interface LogSegment {
  entry: LogEntry;
  start: number;
  end: number;
  first: boolean;
  last: boolean;
  lane: number;
  lanes: number;
}
/** Split at local midnight and put overlapping activities in separate lanes. */
export function daySegments(entries: LogEntry[], day: Date): LogSegment[] {
  const from = day.getTime(),
    until = addDays(day, 1).getTime();
  const segments = entries
    .flatMap((entry): LogSegment[] => {
      if (entry.startedAt === null) return [];
      const start = Date.parse(entry.startedAt),
        end = Date.parse(entry.endedAt);
      if (start >= until || end < from || (end === from && start !== end))
        return [];
      const top = start < from ? 0 : minutesOnDay(start);
      // Repeated DST hours can end at an earlier wall-clock minute; retain a
      // visible block and show the actual elapsed duration in its label.
      const bottom = end >= until ? 1440 : Math.max(top, minutesOnDay(end));
      return [
        {
          entry,
          start: top,
          end: bottom,
          first: start >= from,
          last: end <= until,
          lane: 0,
          lanes: 1,
        },
      ];
    })
    .sort(
      (a, b) =>
        a.start - b.start ||
        b.end - a.end ||
        a.entry.id.localeCompare(b.entry.id),
    );
  let group: LogSegment[] = [],
    laneEnds: number[] = [],
    groupEnd = -1;
  const finish = () => {
    for (const segment of group) segment.lanes = laneEnds.length;
    group = [];
    laneEnds = [];
  };
  for (const segment of segments) {
    const visualStart = Math.min(segment.start, 1440 - MIN_LOG_MINUTES);
    if (visualStart >= groupEnd) finish();
    const bottom = Math.max(segment.end, visualStart + MIN_LOG_MINUTES);
    let lane = laneEnds.findIndex((end) => end <= visualStart);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = bottom;
    segment.lane = lane;
    group.push(segment);
    groupEnd = Math.max(...laneEnds);
  }
  finish();
  return segments;
}
