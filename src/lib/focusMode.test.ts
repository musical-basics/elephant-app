import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acknowledgeReminder,
  presentReminder,
  saveScheduledItem,
} from "./schedule";
import {
  activeFocusMode,
  addItem,
  addProject,
  completeCurrent,
  createEmptyState,
  currentQueueEntry,
  deleteItem,
  deleteProject,
  duplicateItem,
  putBackItem,
  renameItem,
  reorderItem,
  resolveQueue,
  setFocusMode,
  takeBite,
  updateProject,
  validateImport,
} from "./model";
import type { AppState, Item, Project, QueueSlot } from "./model";
const timestamp = "2026-10-08T12:00:00.000Z";
function fixture() {
  const project = (id: string): Project => ({
    id,
    name: id,
    status: "active",
    createdAt: timestamp,
    dueDate: null,
    completedAt: null,
  });
  const item = (id: string, projectId: string | null): Item => ({
    id,
    title: id,
    projectId,
    createdAt: timestamp,
    completedAt: null,
  });
  const p = (id: string, projectId: string): QueueSlot => ({
    id,
    kind: "project",
    projectId,
    createdAt: timestamp,
  });
  const e = (itemId: string): QueueSlot => ({
    id: `slot-${itemId}`,
    kind: "errand",
    itemId,
    createdAt: timestamp,
  });
  return {
    ...createEmptyState(),
    projects: [project("P"), project("Q")],
    items: [
      item("P1", "P"),
      item("P2", "P"),
      item("P3", "P"),
      item("Q1", "Q"),
      item("Q2", "Q"),
      ...["E1", "E2", "E3", "E4", "E5", "E6"].map((id) => item(id, null)),
    ],
    queue: [
      e("E1"),
      p("p1", "P"),
      p("p2", "P"),
      p("q1", "Q"),
      e("E2"),
      p("p3", "P"),
      e("E3"),
      p("q2", "Q"),
      e("E4"),
      e("E5"),
      e("E6"),
    ],
  } satisfies AppState;
}
afterEach(() => vi.useRealTimers());
const current = (state: AppState) => currentQueueEntry(state)?.item.id;

describe("project focus sequence", () => {
  it.each([
    [0, ["P1", "P2", "P3"]],
    [1, ["P1", "E1", "P2", "Q1", "P3"]],
    [2, ["P1", "E1", "Q1", "P2", "E2", "E3", "P3"]],
    [3, ["P1", "E1", "Q1", "E2", "P2", "E3", "Q2", "E4", "P3"]],
  ] as const)(
    "spacing %s selects exactly one focused step then the next other master-list items",
    (between, expected) => {
      const original = fixture();
      let state = setFocusMode(original, "P", between);
      expect(state.queue).toBe(original.queue);
      expect(state.items).toBe(original.items);
      expect(resolveQueue(state)).toEqual(resolveQueue(original));
      for (const id of expected) {
        expect(current(state)).toBe(id);
        const previousOtherOrder = resolveQueue(state)
          .filter(
            (entry) =>
              entry.item.projectId !== "P" && !entry.item.isPlaceholder,
          )
          .map((entry) => entry.item.id);
        state = completeCurrent(state);
        expect(
          state.items.find((item) => item.id === id)?.completedAt,
        ).toBeTruthy();
        expect(state.activityLog?.at(-1)?.taskId).toBe(id);
        expect(
          resolveQueue(state)
            .filter(
              (entry) =>
                entry.item.projectId !== "P" && !entry.item.isPlaceholder,
            )
            .map((entry) => entry.item.id),
        ).toEqual(previousOtherOrder.filter((other) => other !== id));
        state = validateImport(JSON.parse(JSON.stringify(state)));
      }
      expect(state.focusMode).toBeNull();
      expect(current(state)).toBe(resolveQueue(state)[0].item.id);
      expect(state.projects[0].status).toBe("active");
    },
  );
  it("stopping or cancelling focus does not reorder, complete, or duplicate any work", () => {
    const original = fixture();
    const started = setFocusMode(original, "P", 3);
    const stopped = setFocusMode(started, null);
    expect(stopped).toEqual({ ...original, focusMode: null });
    expect(stopped.queue).toBe(original.queue);
    expect(current(stopped)).toBe("E1");
  });
  it("runs consecutive focus tasks if other real tasks run out and ignores empty placeholders", () => {
    let state = addProject(createEmptyState(), "Focus");
    const id = state.projects[0].id;
    state = addItem(addItem(state, "First", id), "Second", id);
    state = addProject(state, "Empty");
    state = setFocusMode(state, id, 3);
    expect(currentQueueEntry(state)?.item.title).toBe("First");
    state = completeCurrent(state);
    expect(currentQueueEntry(state)?.item.title).toBe("Second");
    expect(state.focusMode?.remaining).toBe(0);
    const withNewErrand = addItem(state, "New errand");
    expect(currentQueueEntry(withNewErrand)?.item.title).toBe("Second");
    expect(completeCurrent(state).focusMode).toBeNull();
  });
  it("changes project or spacing immediately, while saving unchanged settings preserves the cycle", () => {
    const state = completeCurrent(setFocusMode(fixture(), "P", 2));
    expect(current(state)).toBe("E1");
    expect(setFocusMode(state, "P", 2)).toBe(state);
    expect(current(setFocusMode(state, "P", 1))).toBe("P2");
    expect(current(setFocusMode(state, "Q", 3))).toBe("Q1");
  });
  it("splits the selected task even when it is not first in the normal master queue", () => {
    let state = setFocusMode(fixture(), "P", 1);
    state = takeBite(state, "Small bite", "Remainder");
    expect(state.items.find((item) => item.id === "E1")?.title).toBe("E1");
    expect(currentQueueEntry(state)?.item.title).toBe("Small bite");
    expect(state.focusMode?.remaining).toBe(0);
    state = completeCurrent(state, 90);
    expect(state.items.find((item) => item.id === "P1")?.timeSpentSeconds).toBe(
      90,
    );
    expect(current(state)).toBe("E1");
    state = completeCurrent(state);
    expect(currentQueueEntry(state)?.item.title).toBe("Remainder");
  });
  it("editing, reordering, copying, deleting, and putting back work keep the mode coherent", () => {
    let state = setFocusMode(fixture(), "P", 1);
    state = renameItem(state, "P1", "Renamed");
    state = reorderItem(state, "P2", "up");
    expect(current(state)).toBe("P2");
    state = duplicateItem(state, "P2");
    state = completeCurrent(state);
    state = deleteItem(state, "E1");
    expect(current(state)).toBe("Q1");
    state = completeCurrent(state);
    expect(currentQueueEntry(state)?.item.title).toBe("P2");
    state = putBackItem(state, "P2");
    expect(current(state)).toBe("P2");
    expect(validateImport(state)).toEqual(state);
  });
  it.each(["pause", "complete", "delete", "remove tasks"])(
    "ends focus safely when its project changes: %s",
    (action) => {
      let state = setFocusMode(fixture(), "P", 2);
      if (action === "pause")
        state = updateProject(state, "P", { status: "inactive" });
      else if (action === "complete")
        state = updateProject(state, "P", { status: "completed" });
      else if (action === "delete") state = deleteProject(state, "P");
      else for (const id of ["P1", "P2", "P3"]) state = deleteItem(state, id);
      expect(state.focusMode).toBeNull();
      expect(activeFocusMode(state)).toBeNull();
      expect(current(state)).toBe(resolveQueue(state)[0].item.id);
      expect(validateImport(state)).toEqual(state);
    },
  );
  it("reminders never consume an interleaved task turn", () => {
    vi.useFakeTimers();
    vi.setSystemTime(timestamp);
    let state = setFocusMode(fixture(), "P", 2);
    state = saveScheduledItem(state, "Dentist", "2026-10-08T14:00:00.000Z");
    state = completeCurrent(state);
    expect(state.activeReminder).not.toBeNull();
    expect(state.focusMode?.remaining).toBe(2);
    const acknowledged = completeCurrent(state);
    expect(acknowledged.focusMode).toEqual(state.focusMode);
    expect(current(acknowledged)).toBe("E1");
    expect(acknowledged.activityLog).toHaveLength(1);
    expect(
      acknowledgeReminder(presentReminder(acknowledged)).focusMode,
    ).toEqual(state.focusMode);
  });
});

describe("focus state validation and backups", () => {
  it("keeps old backups unchanged and roundtrips progress or an explicit stop", () => {
    expect(validateImport(fixture())).toEqual(fixture());
    const state = completeCurrent(
      completeCurrent(setFocusMode(fixture(), "P", 3)),
    );
    expect(state.focusMode).toEqual({
      projectId: "P",
      between: 3,
      remaining: 2,
    });
    expect(validateImport(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(validateImport(setFocusMode(state, null)).focusMode).toBeNull();
  });
  it.each([-1, 4, 1.5, NaN, "2"])("rejects invalid spacing %s", (value) => {
    expect(() => setFocusMode(fixture(), "P", value as number)).toThrow();
  });
  it("rejects invalid counters and clears stale project selections", () => {
    for (const focusMode of [
      { projectId: "P", between: 1, remaining: 2 },
      { projectId: "P", between: 2, remaining: -1 },
      { projectId: "P", between: "1", remaining: 0 },
    ]) {
      expect(() => validateImport({ ...fixture(), focusMode })).toThrow(
        "focus mode",
      );
    }
    expect(() => setFocusMode(fixture(), "missing")).toThrow("active project");
    expect(
      validateImport({
        ...fixture(),
        focusMode: { projectId: "missing", between: 2, remaining: 1 },
      }).focusMode,
    ).toBeNull();
  });
});
