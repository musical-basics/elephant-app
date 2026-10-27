import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addItem,
  addProject,
  completeCurrent,
  createEmptyState,
  currentQueueEntry,
  duplicateItem,
  putBackItem,
  renameItem,
  updateProject,
  validateImport,
} from "./model";
import type { AppState } from "./model";
import { getDailyActivity } from "./analytics";

afterEach(() => vi.useRealTimers());

const title = (state: AppState) => currentQueueEntry(state)?.item.title;
const occurrences = (state: AppState, id: string) =>
  state.items.filter((item) => item.recurrenceOf === id);

function project(titles: [string, boolean?][]) {
  let state = addProject(createEmptyState(), "Practice");
  const projectId = state.projects[0].id;
  for (const [name, recurring] of titles)
    state = addItem(state, name, projectId, undefined, { recurring });
  return state;
}

describe("recurring items", () => {
  it("keeps showing a recurring project step until completed with move on", () => {
    let state = project([["A"], ["B", true], ["C"]]);
    const b = state.items.find((item) => item.title === "B")!;
    expect(b.recurring).toBe(true);
    expect(title(state)).toBe("A");
    state = completeCurrent(state);
    expect(title(state)).toBe("B");
    for (let time = 1; time <= 3; time++) {
      state = completeCurrent(state, undefined, undefined, true);
      expect(title(state)).toBe("B");
      expect(occurrences(state, b.id)).toHaveLength(time);
    }
    expect(state.items.find((item) => item.id === b.id)).toMatchObject({
      completedAt: null,
      recurring: true,
    });
    state = completeCurrent(state);
    expect(title(state)).toBe("C");
    expect(state.items.find((item) => item.id === b.id)?.completedAt).toEqual(
      expect.any(String),
    );
  });

  it("returns to the recurring step the next time its project comes up", () => {
    let state = project([["B", true], ["C"]]);
    state = addItem(state, "Errand");
    expect(title(state)).toBe("B");
    state = completeCurrent(state, undefined, undefined, true);
    expect(title(state)).toBe("Errand");
    state = completeCurrent(state);
    expect(title(state)).toBe("B");
  });

  it("sends a recurring errand to the end of the master list", () => {
    let state = addItem(createEmptyState(), "Stretch", null, undefined, {
      recurring: true,
    });
    state = addItem(state, "Reply to Sam");
    state = completeCurrent(state, undefined, undefined, true);
    expect(title(state)).toBe("Reply to Sam");
    state = completeCurrent(state);
    expect(title(state)).toBe("Stretch");
    state = completeCurrent(state);
    expect(title(state)).toBeUndefined();
  });

  it("records each occurrence with its own time, points, and log entry", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 27, 9));
    let state = project([["Practice 20 minutes", true]]);
    const recurring = state.items.find((item) => !item.isPlaceholder)!;
    state = renameItem(state, recurring.id, recurring.title, {
      points: { kind: "perMinute", value: 1 },
    });
    state = completeCurrent(state, 1200, undefined, true);
    const [occurrence] = occurrences(state, recurring.id);
    expect(occurrence).toMatchObject({
      title: "Practice 20 minutes",
      projectId: recurring.projectId,
      completedAt: expect.any(String),
      timeSpentSeconds: 1200,
      pointsEarned: 20,
      pointsQuantity: 20,
    });
    expect(occurrence.id).not.toBe(recurring.id);
    expect(occurrence.recurring).toBeUndefined();
    expect(state.activityLog?.at(-1)?.taskId).toBe(occurrence.id);
    const remaining = state.items.find((item) => item.id === recurring.id)!;
    expect(remaining.timeSpentSeconds).toBeUndefined();
    expect(remaining.pointsEarned).toBeUndefined();
    // Occurrences are work done, not newly added work.
    const today = getDailyActivity(state.items, 7, new Date(2026, 9, 27)).at(
      -1,
    )!;
    expect(today).toMatchObject({ added: 1, done: 1 });
  });

  it("completes a non-recurring item normally even when asked to repeat", () => {
    let state = addItem(createEmptyState(), "Once");
    const id = state.items[0].id;
    state = completeCurrent(state, undefined, undefined, true);
    expect(state.items).toHaveLength(1);
    expect(state.items[0].id).toBe(id);
    expect(state.items[0].completedAt).toEqual(expect.any(String));
  });

  it("sets and clears recurrence, copies it on duplicates, and restores occurrences as ordinary items", () => {
    let state = addItem(createEmptyState(), "Walk");
    const id = state.items[0].id;
    state = renameItem(state, id, "Walk", { recurring: true });
    expect(state.items[0].recurring).toBe(true);
    state = renameItem(state, id, "Walk the dog");
    expect(state.items[0].recurring).toBe(true);
    state = duplicateItem(state, id);
    expect(state.items.map((item) => item.recurring)).toEqual([true, true]);
    state = renameItem(state, id, "Walk the dog", { recurring: false });
    expect(state.items[0].recurring).toBeUndefined();

    let repeating = addItem(createEmptyState(), "Stretch", null, undefined, {
      recurring: true,
    });
    repeating = completeCurrent(repeating, undefined, undefined, true);
    const occurrence = repeating.items.find((item) => item.recurrenceOf)!;
    repeating = putBackItem(repeating, occurrence.id);
    const restored = repeating.items.find((item) => item.id === occurrence.id)!;
    expect(restored.completedAt).toBeNull();
    expect(restored.recurrenceOf).toBeUndefined();
    expect(title(repeating)).toBe("Stretch");
  });

  it("finishes a recurring step when its project is marked complete", () => {
    let state = project([["B", true]]);
    state = updateProject(state, state.projects[0].id, { status: "completed" });
    expect(state.items[0].completedAt).toEqual(expect.any(String));
    expect(title(state)).toBeUndefined();
  });

  it("round-trips recurrence through backups and rejects invalid flags", () => {
    let state = project([["B", true], ["C"]]);
    state = completeCurrent(state, undefined, undefined, true);
    expect(validateImport(JSON.parse(JSON.stringify(state)))).toEqual(state);
    const b = state.items.find(
      (item) => item.title === "B" && !item.completedAt,
    )!;
    const occurrence = state.items.find((item) => item.recurrenceOf)!;
    const replace = (patch: object, target = b) => ({
      ...state,
      items: state.items.map((item) =>
        item.id === target.id ? { ...item, ...patch } : item,
      ),
    });
    expect(() => validateImport(replace({ recurring: false }))).toThrow(
      "recurring flag must be true",
    );
    expect(() => validateImport(replace({ recurrenceOf: "x" }))).toThrow(
      "only completed items can be occurrences",
    );
    expect(() =>
      validateImport(replace({ recurrenceOf: 7 }, occurrence)),
    ).toThrow("item recurrence ID must be text");
  });
});
