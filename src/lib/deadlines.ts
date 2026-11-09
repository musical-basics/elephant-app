import type { AppState } from "./model";
import { localDateKey } from "./schedule.js";

export const MAX_DEADLINE_TITLE_LENGTH = 500;

/** Something due by the end of a local day, with no particular time. */
export interface Deadline {
  id: string;
  title: string;
  /** Local date as YYYY-MM-DD. */
  dueDate: string;
  createdAt: string;
  completedAt: string | null;
}
export type DeadlineDraft = Pick<Deadline, "title" | "dueDate">;

/** A deadline as the calendar shows it: one of yours, or an open project's due date. */
export type DeadlineEntry =
  | {
      source: "deadline";
      id: string;
      title: string;
      dueDate: string;
      completed: boolean;
      deadline: Deadline;
    }
  | {
      source: "project";
      id: string;
      title: string;
      dueDate: string;
      completed: false;
      projectId: string;
    };

export interface DeadlineStatus {
  /** Whole local days from today until the due date; negative when overdue. */
  days: number;
  overdue: boolean;
  label: string;
}

function dateParts(key: string): [number, number, number] {
  const [year, month, day] = key.split("-").map(Number);
  return [year, month, day];
}

export function validDueDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const [year, month, day] = dateParts(value);
  return localDateKey(new Date(year, month - 1, day)) === value;
}

/** Shared by the editor and backup validation; throws a readable message. */
export function checkDeadline(draft: DeadlineDraft): DeadlineDraft {
  const title = String(draft.title ?? "").trim();
  if (!title || title.length > MAX_DEADLINE_TITLE_LENGTH)
    throw new Error("Give the deadline a name of 1–500 characters.");
  if (!validDueDate(draft.dueDate)) throw new Error("Choose a due date.");
  return { title, dueDate: draft.dueDate };
}

export function saveDeadline(
  state: AppState,
  draft: DeadlineDraft,
  deadlineId?: string,
): AppState {
  const fields = checkDeadline(draft);
  const deadlines = state.deadlines ?? [];
  const existing = deadlines.find((deadline) => deadline.id === deadlineId);
  if (deadlineId && !existing)
    throw new Error(
      "This deadline was removed. Reopen the calendar to continue.",
    );
  return {
    ...state,
    deadlines: existing
      ? deadlines.map((deadline) =>
          deadline.id === deadlineId ? { ...deadline, ...fields } : deadline,
        )
      : [
          ...deadlines,
          {
            id: crypto.randomUUID(),
            ...fields,
            createdAt: new Date().toISOString(),
            completedAt: null,
          },
        ],
  };
}

/** Completes an open deadline, or reopens a completed one. */
export function toggleDeadline(
  state: AppState,
  deadlineId: string,
  at: number = Date.now(),
): AppState {
  return {
    ...state,
    deadlines: (state.deadlines ?? []).map((deadline) =>
      deadline.id === deadlineId
        ? {
            ...deadline,
            completedAt: deadline.completedAt
              ? null
              : new Date(at).toISOString(),
          }
        : deadline,
    ),
  };
}

export function removeDeadline(state: AppState, deadlineId: string): AppState {
  return {
    ...state,
    deadlines: (state.deadlines ?? []).filter(
      (deadline) => deadline.id !== deadlineId,
    ),
  };
}

/** Your deadlines plus active and upcoming projects' due dates, soonest first. */
export function deadlineEntries(state: AppState): DeadlineEntry[] {
  return [
    ...(state.deadlines ?? []).map((deadline): DeadlineEntry => ({
      source: "deadline",
      id: deadline.id,
      title: deadline.title,
      dueDate: deadline.dueDate,
      completed: Boolean(deadline.completedAt),
      deadline,
    })),
    ...state.projects.flatMap((project): DeadlineEntry[] =>
      project.dueDate && project.status !== "completed"
        ? [
            {
              source: "project",
              id: `project:${project.id}`,
              title: project.name,
              dueDate: project.dueDate,
              completed: false,
              projectId: project.id,
            },
          ]
        : [],
    ),
  ].sort(
    (a, b) =>
      a.dueDate.localeCompare(b.dueDate) ||
      a.title.localeCompare(b.title) ||
      a.id.localeCompare(b.id),
  );
}

/** Counts calendar days, so daylight saving changes never shift the result. */
export function deadlineStatus(
  dueDate: string,
  today: Date = new Date(),
): DeadlineStatus {
  const [year, month, day] = dateParts(dueDate);
  const days = Math.round(
    (Date.UTC(year, month - 1, day) -
      Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) /
      86_400_000,
  );
  const label =
    days < 0
      ? `${-days} ${days === -1 ? "day" : "days"} overdue`
      : days === 0
        ? "Due today"
        : days === 1
          ? "Due tomorrow"
          : days < 14
            ? `Due in ${days} days`
            : `Due ${new Date(year, month - 1, day).toLocaleDateString(
                undefined,
                {
                  month: "short",
                  day: "numeric",
                  ...(year === today.getFullYear() ? {} : { year: "numeric" }),
                },
              )}`;
  return { days, overdue: days < 0, label };
}
