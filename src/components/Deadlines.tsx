import {
  AlertCircle,
  Check,
  ChevronRight,
  Circle,
  Flag,
  Folder,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { deadlineStatus } from "../lib/deadlines";
import type { Deadline, DeadlineEntry } from "../lib/deadlines";
import "./Deadlines.css";

export interface DeadlineActions {
  onEdit: (deadline: Deadline) => void;
  onDelete: (deadline: Deadline) => void;
  onToggle: (deadline: Deadline) => void;
  onOpenProject: (projectId: string) => void;
}

function shortDate(dueDate: string) {
  return new Date(`${dueDate}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** The selected day's deadlines, shown above its timeline. */
export function DayDeadlines({
  entries,
  today,
  onEdit,
  onDelete,
  onToggle,
  onOpenProject,
}: DeadlineActions & { entries: DeadlineEntry[]; today: Date }) {
  if (!entries.length) return null;
  return (
    <section className="calendar-due" aria-label="Due this day">
      <h3>
        <Flag size={13} />
        Due
      </h3>
      <ul>
        {entries.map((entry) => {
          const status = deadlineStatus(entry.dueDate, today);
          return (
            <li
              key={entry.id}
              className={`due-row${entry.completed ? " is-completed" : status.overdue ? " is-overdue" : ""}${entry.source === "project" ? " is-project" : ""}`}
            >
              {entry.source === "deadline" ? (
                <>
                  <button
                    className="schedule-title"
                    onClick={() => onEdit(entry.deadline)}
                  >
                    {entry.title}
                  </button>
                  <p>
                    <Flag size={12} /> Deadline ·{" "}
                    {entry.completed ? "Completed" : status.label}
                  </p>
                  <div className="schedule-actions">
                    <button
                      className="text-button"
                      aria-label={`${entry.completed ? "Reopen" : "Complete"} deadline ${entry.title}`}
                      onClick={() => onToggle(entry.deadline)}
                    >
                      {entry.completed ? (
                        <RotateCcw size={14} />
                      ) : (
                        <Check size={14} />
                      )}
                      {entry.completed ? "Reopen" : "Complete"}
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Edit deadline ${entry.title}`}
                      onClick={() => onEdit(entry.deadline)}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Delete deadline ${entry.title}`}
                      onClick={() => onDelete(entry.deadline)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <button
                    className="schedule-title"
                    onClick={() => onOpenProject(entry.projectId)}
                  >
                    {entry.title}
                  </button>
                  <p>
                    <Folder size={12} /> Project due date · {status.label}
                  </p>
                  <div className="schedule-actions">
                    <button
                      className="text-button"
                      aria-label={`Open project ${entry.title}`}
                      onClick={() => onOpenProject(entry.projectId)}
                    >
                      <Folder size={14} />
                      Open project
                    </button>
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Every open deadline, soonest first, with completed ones tucked below. */
export function DeadlinesPanel({
  entries,
  today,
  onAdd,
  onSelect,
  onToggle,
}: {
  entries: DeadlineEntry[];
  today: Date;
  onAdd: () => void;
  onSelect: (dueDate: string) => void;
  onToggle: (deadline: Deadline) => void;
}) {
  const open = entries.filter((entry) => !entry.completed);
  const completed = entries
    .filter(
      (entry): entry is Extract<DeadlineEntry, { source: "deadline" }> =>
        entry.completed && entry.source === "deadline",
    )
    .sort((a, b) =>
      (b.deadline.completedAt ?? "").localeCompare(
        a.deadline.completedAt ?? "",
      ),
    );
  return (
    <section className="calendar-deadlines" aria-label="Deadlines">
      <div className="calendar-deadlines-heading">
        <h2>Deadlines</h2>
        <button className="secondary-button" onClick={onAdd}>
          <Plus size={16} />
          Add deadline
        </button>
      </div>
      {open.length ? (
        <ul className="deadline-list">
          {open.map((entry) => {
            const status = deadlineStatus(entry.dueDate, today);
            return (
              <li
                key={entry.id}
                className={`deadline-row${status.overdue ? " is-overdue" : ""}`}
              >
                {entry.source === "deadline" ? (
                  <button
                    className="deadline-check"
                    aria-label={`Complete deadline ${entry.title}`}
                    onClick={() => onToggle(entry.deadline)}
                  >
                    <Circle size={20} />
                  </button>
                ) : (
                  <span className="deadline-check" aria-hidden="true">
                    <Folder size={18} />
                  </span>
                )}
                <button
                  className="deadline-open"
                  onClick={() => onSelect(entry.dueDate)}
                >
                  <strong>{entry.title}</strong>
                  <small>
                    {status.overdue && <AlertCircle size={12} />}
                    {status.label}
                    {status.days < 14 ? ` · ${shortDate(entry.dueDate)}` : ""}
                    {entry.source === "project" ? " · Project" : ""}
                  </small>
                </button>
                <ChevronRight size={16} aria-hidden="true" />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="deadline-empty">
          No open deadlines. Add one, or give a project a due date.
        </p>
      )}
      {completed.length > 0 && (
        <details className="deadline-completed">
          <summary>
            {completed.length} completed{" "}
            {completed.length === 1 ? "deadline" : "deadlines"}
          </summary>
          <ul>
            {completed.map((entry) => (
              <li key={entry.id}>
                <span>
                  <strong>{entry.title}</strong>
                  <small>Was due {shortDate(entry.dueDate)}</small>
                </span>
                <button
                  className="text-button"
                  aria-label={`Reopen deadline ${entry.title}`}
                  onClick={() => onToggle(entry.deadline)}
                >
                  <RotateCcw size={14} />
                  Reopen
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
