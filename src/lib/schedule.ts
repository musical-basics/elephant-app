import type { AppState } from "./model";

export type ReminderOffset = 180 | 30;
export interface ScheduledItem {
  id: string;
  title: string;
  scheduledAt: string;
  createdAt: string;
  completedAt: string | null;
  acknowledgedReminders: ReminderOffset[];
}
export interface ScheduledReminder {
  scheduledItemId: string;
  offsetMinutes: ReminderOffset;
}

function reminderOffset(
  item: ScheduledItem,
  now: number,
): ReminderOffset | null {
  const remaining = Date.parse(item.scheduledAt) - now;
  if (item.completedAt || remaining <= 0 || remaining > 180 * 60_000)
    return null;
  const offset = remaining <= 30 * 60_000 ? 30 : 180;
  return item.acknowledgedReminders.includes(offset) ? null : offset;
}

/** Only the latest applicable milestone is useful; order clashes by start time. */
export function getDueReminder(
  state: AppState,
  now = Date.now(),
): ScheduledReminder | null {
  for (const item of [...state.scheduledItems].sort(
    (a, b) =>
      Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt) ||
      a.id.localeCompare(b.id),
  )) {
    const offsetMinutes = reminderOffset(item, now);
    if (offsetMinutes) return { scheduledItemId: item.id, offsetMinutes };
  }
  return null;
}

export function getActiveReminder(state: AppState, now = Date.now()) {
  const item = state.scheduledItems.find(
    (entry) => entry.id === state.activeReminder?.scheduledItemId,
  );
  const offsetMinutes = item ? reminderOffset(item, now) : null;
  return item && offsetMinutes ? { item, offsetMinutes } : null;
}

/** Called at task boundaries, never when the clock crosses a threshold mid-task. */
export function presentReminder(state: AppState, now = Date.now()): AppState {
  const activeReminder = getDueReminder(state, now);
  if (
    activeReminder?.scheduledItemId === state.activeReminder?.scheduledItemId &&
    activeReminder?.offsetMinutes === state.activeReminder?.offsetMinutes
  )
    return state;
  return { ...state, activeReminder };
}

export function acknowledgeReminder(
  state: AppState,
  now = Date.now(),
): AppState {
  const active = getActiveReminder(state, now);
  if (!active) return presentReminder({ ...state, activeReminder: null }, now);
  const acknowledged = ([180, 30] as const).filter(
    (offset) => offset >= active.offsetMinutes,
  );
  const scheduledItems = state.scheduledItems.map((item) =>
    item.id === active.item.id
      ? {
          ...item,
          acknowledgedReminders: [
            ...new Set([...item.acknowledgedReminders, ...acknowledged]),
          ],
        }
      : item,
  );
  return presentReminder(
    { ...state, scheduledItems, activeReminder: null },
    now,
  );
}

export function saveScheduledItem(
  state: AppState,
  value: string,
  scheduledAt: string,
  itemId?: string,
): AppState {
  const title = value.trim();
  if (!title) throw new Error("Please enter an item name.");
  if (!Number.isFinite(Date.parse(scheduledAt)))
    throw new Error("Please choose a valid date and time.");
  const timestamp = new Date(scheduledAt).toISOString();
  const existing = itemId
    ? state.scheduledItems.find((item) => item.id === itemId)
    : undefined;
  if (itemId && !existing) return state;
  const item: ScheduledItem = existing
    ? {
        ...existing,
        title,
        scheduledAt: timestamp,
        acknowledgedReminders:
          timestamp === existing.scheduledAt
            ? existing.acknowledgedReminders
            : [],
      }
    : {
        id: crypto.randomUUID(),
        title,
        scheduledAt: timestamp,
        createdAt: new Date().toISOString(),
        completedAt: null,
        acknowledgedReminders: [],
      };
  return {
    ...state,
    scheduledItems: existing
      ? state.scheduledItems.map((entry) =>
          entry.id === item.id ? item : entry,
        )
      : [...state.scheduledItems, item],
    activeReminder:
      existing &&
      timestamp !== existing.scheduledAt &&
      state.activeReminder?.scheduledItemId === item.id
        ? null
        : state.activeReminder,
  };
}

export function deleteScheduledItem(state: AppState, itemId: string): AppState {
  return {
    ...state,
    scheduledItems: state.scheduledItems.filter((item) => item.id !== itemId),
    activeReminder:
      state.activeReminder?.scheduledItemId === itemId
        ? null
        : state.activeReminder,
  };
}

export function toggleScheduledItem(state: AppState, itemId: string): AppState {
  return {
    ...state,
    scheduledItems: state.scheduledItems.map((item) =>
      item.id === itemId
        ? {
            ...item,
            completedAt: item.completedAt ? null : new Date().toISOString(),
          }
        : item,
    ),
    activeReminder:
      state.activeReminder?.scheduledItemId === itemId
        ? null
        : state.activeReminder,
  };
}

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function localTimeValue(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** Reject dates normalized by JS, including nonexistent local times at a DST jump. */
export function scheduledTimestamp(date: string, time: string): string {
  const value = new Date(`${date}T${time}`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !/^\d{2}:\d{2}$/.test(time) ||
    !Number.isFinite(value.getTime()) ||
    localDateKey(value) !== date ||
    localTimeValue(value) !== time
  ) {
    throw new Error(
      "Please choose a valid local date and time. That time may be skipped by daylight saving time.",
    );
  }
  return value.toISOString();
}
