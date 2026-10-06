import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addItem,
  completeCurrent,
  createEmptyState,
  resolveQueue,
  validateImport,
} from "./model";
import {
  acknowledgeReminder,
  deleteScheduledItem,
  getActiveReminder,
  getDueReminder,
  presentReminder,
  saveScheduledItem,
  scheduledTimestamp,
  toggleScheduledItem,
} from "./schedule";

const start = Date.parse("2026-10-06T16:00:00.000Z");
const atMinutesBefore = (minutes: number) => start - minutes * 60_000;
function workspace() {
  return saveScheduledItem(
    addItem(addItem(createEmptyState(), "First task"), "Next task"),
    "Dentist",
    new Date(start).toISOString(),
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(atMinutesBefore(240));
});
afterEach(() => vi.useRealTimers());

describe("a separate scheduled timeline", () => {
  it("saves dates without inserting scheduled work into items or queue", () => {
    const original = addItem(createEmptyState(), "A task");
    const next = saveScheduledItem(
      original,
      "  Dentist  ",
      new Date(start).toISOString(),
    );
    expect(next.items).toBe(original.items);
    expect(next.queue).toBe(original.queue);
    expect(next.scheduledItems[0].title).toBe("Dentist");
    expect(validateImport(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });
  it("migrates old backups deterministically and rejects malformed schedules", () => {
    const { scheduledItems, activeReminder, ...legacy } = createEmptyState();
    expect(validateImport(legacy)).toEqual(createEmptyState());
    const state = workspace();
    const item = state.scheduledItems[0];
    for (const patch of [
      { scheduledAt: "2026-02-30T12:00:00Z" },
      { title: "" },
      { acknowledgedReminders: [1] },
      { acknowledgedReminders: [30, 30] },
    ]) {
      expect(() =>
        validateImport({ ...state, scheduledItems: [{ ...item, ...patch }] }),
      ).toThrow("Invalid backup");
    }
    expect(() =>
      validateImport({
        ...state,
        activeReminder: { scheduledItemId: "missing", offsetMinutes: 180 },
      }),
    ).toThrow("Invalid backup");
    expect(() =>
      validateImport({ ...state, scheduledItems: [item, item] }),
    ).toThrow("duplicate");
    expect(scheduledItems).toEqual([]);
    expect(activeReminder).toBeNull();
  });
  it("validates local date/time including impossible dates", () => {
    expect(new Date(scheduledTimestamp("2026-10-06", "16:30")).getHours()).toBe(
      16,
    );
    expect(() => scheduledTimestamp("2026-02-30", "16:30")).toThrow();
    expect(() => scheduledTimestamp("2026-10-06", "24:00")).toThrow();
    expect(() => scheduledTimestamp("", "12:00")).toThrow();
  });
});

describe("reminders at task boundaries", () => {
  it.each([
    [180 + 1 / 60_000, null],
    [180, 180],
    [30 + 1 / 60_000, 180],
    [30, 30],
    [1, 30],
    [0, null],
    [-1, null],
  ] as const)("at %s minutes before, offers %s", (minutes, offset) => {
    expect(
      getDueReminder(workspace(), atMinutesBefore(minutes))?.offsetMinutes ??
        null,
    ).toBe(offset);
  });
  it("completes the actual task then shows a reminder without changing the next queue item", () => {
    const original = workspace();
    vi.setSystemTime(atMinutesBefore(180));
    expect(getActiveReminder(original)).toBeNull();
    const state = completeCurrent(original, 45);
    expect(state.items[0]).toMatchObject({
      completedAt: new Date().toISOString(),
      timeSpentSeconds: 45,
    });
    expect(getActiveReminder(state)?.item.title).toBe("Dentist");
    expect(resolveQueue(state)[0].item.title).toBe("Next task");
    const acknowledged = completeCurrent(state);
    expect(acknowledged.items).toBe(state.items);
    expect(acknowledged.queue).toBe(state.queue);
    expect(acknowledged.scheduledItems[0].completedAt).toBeNull();
    expect(acknowledged.activeReminder).toBeNull();
  });
  it("persists each acknowledgment and shows the second milestone only once", () => {
    vi.setSystemTime(atMinutesBefore(180));
    let state = acknowledgeReminder(presentReminder(workspace()));
    state = validateImport(JSON.parse(JSON.stringify(state)));
    expect(getDueReminder(state)).toBeNull();
    vi.setSystemTime(atMinutesBefore(30));
    state = completeCurrent(state);
    expect(getActiveReminder(state)?.offsetMinutes).toBe(30);
    state = acknowledgeReminder(state);
    expect(state.scheduledItems[0].acknowledgedReminders).toEqual([180, 30]);
    expect(getDueReminder(state)).toBeNull();
  });
  it("catches up with only the 30-minute reminder and drops reminders at start time", () => {
    vi.setSystemTime(atMinutesBefore(15));
    const state = presentReminder(workspace());
    expect(getActiveReminder(state)?.offsetMinutes).toBe(30);
    expect(acknowledgeReminder(state).activeReminder).toBeNull();
    vi.setSystemTime(start);
    expect(getActiveReminder(state)).toBeNull();
    expect(presentReminder(state).activeReminder).toBeNull();
  });
  it("updates a lingering 3-hour reminder to the latest milestone", () => {
    const state = presentReminder(workspace(), atMinutesBefore(180));
    expect(getActiveReminder(state, atMinutesBefore(30))?.offsetMinutes).toBe(
      30,
    );
    expect(
      acknowledgeReminder(state, atMinutesBefore(30)).scheduledItems[0]
        .acknowledgedReminders,
    ).toEqual([180, 30]);
  });
  it("presents overlapping reminders one at a time in event order", () => {
    vi.setSystemTime(atMinutesBefore(20));
    let state = saveScheduledItem(
      workspace(),
      "Earlier call",
      new Date(start - 5 * 60_000).toISOString(),
    );
    state = presentReminder(state);
    expect(getActiveReminder(state)?.item.title).toBe("Earlier call");
    state = acknowledgeReminder(state);
    expect(getActiveReminder(state)?.item.title).toBe("Dentist");
    state = acknowledgeReminder(state);
    expect(state.activeReminder).toBeNull();
    expect(state.items.every((item) => !item.completedAt)).toBe(true);
  });
  it("preserves acknowledgments on rename and resets them on reschedule", () => {
    const state = acknowledgeReminder(
      presentReminder(workspace(), atMinutesBefore(180)),
      atMinutesBefore(180),
    );
    const item = state.scheduledItems[0];
    const renamed = saveScheduledItem(
      state,
      "Dentist visit",
      item.scheduledAt,
      item.id,
    );
    expect(renamed.scheduledItems[0].acknowledgedReminders).toEqual([180]);
    const moved = saveScheduledItem(
      renamed,
      item.title,
      new Date(start + 86_400_000).toISOString(),
      item.id,
    );
    expect(moved.scheduledItems[0].acknowledgedReminders).toEqual([]);
    expect(getDueReminder(moved, start)).toBeNull();
  });
  it("cancels active reminders when edited, completed or deleted, leaving master work alone", () => {
    const state = presentReminder(workspace(), atMinutesBefore(180));
    const item = state.scheduledItems[0];
    for (const next of [
      deleteScheduledItem(state, item.id),
      toggleScheduledItem(state, item.id),
      saveScheduledItem(
        state,
        item.title,
        new Date(start + 86_400_000).toISOString(),
        item.id,
      ),
    ]) {
      expect(next.activeReminder).toBeNull();
      expect(getDueReminder(next, atMinutesBefore(180))).toBeNull();
      expect(next.queue).toBe(state.queue);
      expect(next.items).toBe(state.items);
      expect(validateImport(next)).toEqual(next);
    }
  });
});
