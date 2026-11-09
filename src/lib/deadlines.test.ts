import { describe, expect, it } from "vitest";
import {
  addProject,
  createEmptyState,
  updateProject,
  validateImport,
} from "./model";
import type { AppState } from "./model";
import {
  checkDeadline,
  deadlineEntries,
  deadlineStatus,
  removeDeadline,
  saveDeadline,
  toggleDeadline,
  validDueDate,
} from "./deadlines";

const local = (year: number, month: number, day: number, hour = 12) =>
  new Date(year, month - 1, day, hour);

describe("deadline status", () => {
  it("counts whole calendar days, before and after the due date", () => {
    const today = local(2026, 11, 9, 23);
    expect(deadlineStatus("2026-11-09", today)).toEqual({
      days: 0,
      overdue: false,
      label: "Due today",
    });
    expect(deadlineStatus("2026-11-10", today).label).toBe("Due tomorrow");
    expect(deadlineStatus("2026-11-14", today).label).toBe("Due in 5 days");
    expect(deadlineStatus("2026-11-22", today).label).toBe("Due in 13 days");
    expect(deadlineStatus("2026-11-23", today).label).toBe("Due Nov 23");
    expect(deadlineStatus("2027-01-04", today).label).toBe("Due Jan 4, 2027");
    expect(deadlineStatus("2026-11-08", today)).toEqual({
      days: -1,
      overdue: true,
      label: "1 day overdue",
    });
    expect(deadlineStatus("2026-11-07", local(2026, 11, 9, 0)).label).toBe(
      "2 days overdue",
    );
  });

  it("is unaffected by daylight saving changes and month or year ends", () => {
    // US clocks fell back on Nov 1 2026 and spring forward on Mar 14 2027.
    expect(deadlineStatus("2026-11-02", local(2026, 10, 31, 23)).days).toBe(2);
    expect(deadlineStatus("2027-03-15", local(2027, 3, 13, 0)).days).toBe(2);
    expect(deadlineStatus("2027-01-01", local(2026, 12, 31, 23)).days).toBe(1);
    expect(deadlineStatus("2026-02-28", local(2026, 3, 1)).days).toBe(-1);
  });
});

describe("deadlines", () => {
  it("validates names and real local dates", () => {
    expect(
      checkDeadline({ title: "  File taxes ", dueDate: "2026-04-15" }),
    ).toEqual({
      title: "File taxes",
      dueDate: "2026-04-15",
    });
    expect(() => checkDeadline({ title: " ", dueDate: "2026-04-15" })).toThrow(
      "Give the deadline a name",
    );
    for (const dueDate of ["2026-02-30", "2026-4-15", "", "tomorrow"])
      expect(() => checkDeadline({ title: "Taxes", dueDate })).toThrow(
        "Choose a due date.",
      );
    expect(validDueDate("2028-02-29")).toBe(true);
    expect(validDueDate("2027-02-29")).toBe(false);
  });

  it("adds, edits, completes, reopens, and removes deadlines", () => {
    let state = saveDeadline(createEmptyState(), {
      title: "Renew passport",
      dueDate: "2026-12-01",
    });
    const [deadline] = state.deadlines!;
    expect(deadline).toMatchObject({
      title: "Renew passport",
      dueDate: "2026-12-01",
      completedAt: null,
      createdAt: expect.any(String),
    });
    state = saveDeadline(
      state,
      { title: "Renew passport online", dueDate: "2026-11-30" },
      deadline.id,
    );
    expect(state.deadlines).toEqual([
      { ...deadline, title: "Renew passport online", dueDate: "2026-11-30" },
    ]);
    const at = Date.UTC(2026, 10, 20, 15);
    state = toggleDeadline(state, deadline.id, at);
    expect(state.deadlines![0].completedAt).toBe(new Date(at).toISOString());
    state = toggleDeadline(state, deadline.id);
    expect(state.deadlines![0].completedAt).toBeNull();
    expect(() =>
      saveDeadline(state, { title: "x", dueDate: "2026-11-30" }, "missing"),
    ).toThrow("This deadline was removed.");
    state = removeDeadline(state, deadline.id);
    expect(state.deadlines).toEqual([]);
  });

  it("lists your deadlines with open projects' due dates, soonest first", () => {
    let state: AppState = addProject(createEmptyState(), "Kitchen remodel");
    state = addProject(state, "Old idea");
    state = addProject(state, "Finished project");
    const [kitchen, idea, finished] = state.projects;
    state = updateProject(state, kitchen.id, { dueDate: "2026-11-20" });
    state = updateProject(state, idea.id, {
      dueDate: "2026-11-15",
      status: "inactive",
    });
    state = updateProject(state, finished.id, {
      dueDate: "2026-11-10",
      status: "completed",
    });
    state = saveDeadline(state, { title: "Taxes", dueDate: "2026-11-18" });
    state = saveDeadline(state, { title: "Done thing", dueDate: "2026-11-01" });
    state = toggleDeadline(state, state.deadlines!.at(-1)!.id);
    expect(
      deadlineEntries(state).map(({ source, title, dueDate, completed }) => [
        source,
        title,
        dueDate,
        completed,
      ]),
    ).toEqual([
      ["deadline", "Done thing", "2026-11-01", true],
      ["project", "Old idea", "2026-11-15", false],
      ["deadline", "Taxes", "2026-11-18", false],
      ["project", "Kitchen remodel", "2026-11-20", false],
    ]);
    const entry = deadlineEntries(state).find(
      (value) => value.source === "project",
    );
    expect(entry).toMatchObject({
      projectId: idea.id,
      id: `project:${idea.id}`,
    });
  });

  it("round-trips through backups and rejects invalid deadlines", () => {
    let state = saveDeadline(createEmptyState(), {
      title: "Renew passport",
      dueDate: "2026-12-01",
    });
    state = toggleDeadline(state, state.deadlines![0].id);
    expect(validateImport(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(validateImport(createEmptyState()).deadlines).toBeUndefined();
    const [deadline] = state.deadlines!;
    const invalid: [unknown, string][] = [
      [{ ...state, deadlines: {} }, "deadlines must be a list"],
      [
        { ...state, deadlines: [{ ...deadline, dueDate: "2026-02-30" }] },
        "Invalid backup: Choose a due date.",
      ],
      [
        { ...state, deadlines: [{ ...deadline, title: "" }] },
        "deadline title must be text",
      ],
      [
        { ...state, deadlines: [{ ...deadline, completedAt: "soon" }] },
        "deadline completedAt must be an ISO timestamp",
      ],
      [{ ...state, deadlines: [deadline, deadline] }, "duplicate deadline IDs"],
    ];
    for (const [data, message] of invalid)
      expect(() => validateImport(data)).toThrow(message);
  });
});
