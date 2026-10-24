import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  CalendarDays,
  Check,
  CircleCheck,
  CircleDot,
  Dumbbell,
  Moon,
  Pencil,
  Plus,
  Repeat,
  Sparkles,
  Undo2,
  Utensils,
} from "lucide-react";
import Sheet from "./Sheet";
import { addDays, weekStart } from "../lib/activityLog";
import type { LogCategory, LogEntry } from "../lib/activityLog";
import {
  MAX_ROUTINE_MINUTES,
  MAX_ROUTINE_TITLE_LENGTH,
  MAX_WEEKLY_GOAL,
  nextOccurrence,
  sortWeeklyItems,
} from "../lib/routine";
import type {
  RoutineDraft,
  RoutineItem,
  WeeklyDraft,
  WeeklyItem,
} from "../lib/routine";
import { localDateKey } from "../lib/schedule";
import "./ActivityLog.css";
import "./Routine.css";

const TYPES: { id: LogCategory; label: string; icon: ReactNode }[] = [
  { id: "other", label: "Other", icon: <CircleDot size={16} /> },
  { id: "sleep", label: "Sleep", icon: <Moon size={16} /> },
  { id: "meal", label: "Meal", icon: <Utensils size={16} /> },
  { id: "exercise", label: "Exercise", icon: <Dumbbell size={16} /> },
  { id: "task", label: "Task", icon: <CircleCheck size={16} /> },
];
// 4 January 2026 is a Sunday, so index 0 is Sunday like Date#getDay.
const WEEKDAYS = Array.from({ length: 7 }, (_, day) =>
  new Date(2026, 0, 4 + day).toLocaleDateString(undefined, {
    weekday: "long",
  }),
);
const clock = (value: string | number | Date) =>
  new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
const wallClock = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return clock(new Date(2026, 0, 4, hours, minutes));
};
function duration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours} hr${rest ? ` ${rest} min` : ""}` : `${minutes} min`;
}
function lastLogged(entry: LogEntry, now: number): string {
  const ended = new Date(entry.endedAt);
  const key = localDateKey(ended);
  if (key === localDateKey(new Date(now))) return `Today ${clock(ended)}`;
  if (key === localDateKey(addDays(new Date(now), -1)))
    return `Yesterday ${clock(ended)}`;
  return ended.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
const failure = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

type Props = {
  routines: RoutineItem[];
  weeklyItems: WeeklyItem[];
  progress: Map<string, { count: number; last: LogEntry | null }>;
  now: number;
  onLog: (routineId: string) => string;
  onUndo: (entryId: string) => void;
  onSaveRoutine: (draft: RoutineDraft, id?: string) => void;
  onDeleteRoutine: (id: string) => void;
  onAddStarter: () => void;
  onSaveWeekly: (draft: WeeklyDraft, id?: string) => void;
  onDeleteWeekly: (id: string) => void;
  onOpenCalendar: () => void;
};
type Editor =
  | { kind: "routine"; routine?: RoutineItem }
  | { kind: "weekly"; item?: WeeklyItem };

export default function Routine({
  routines,
  weeklyItems,
  progress,
  now,
  onLog,
  onUndo,
  onSaveRoutine,
  onDeleteRoutine,
  onAddStarter,
  onSaveWeekly,
  onDeleteWeekly,
  onOpenCalendar,
}: Props) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [logged, setLogged] = useState<{
    routineId: string;
    entryId: string;
    message: string;
  } | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const week = weekStart(new Date(now));
  const weekLabel = `${week.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} – ${addDays(week, 6).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`;

  function log(routine: RoutineItem) {
    try {
      const entryId = onLog(routine.id);
      const end = Date.now();
      const message = `${routine.title} logged, ${clock(end - routine.durationMinutes * 60_000)}–${clock(end)}.`;
      setLogged({ routineId: routine.id, entryId, message });
      setNotice(message);
      setError("");
    } catch (reason) {
      setError(failure(reason, "Could not log this routine item."));
    }
  }

  return (
    <div className="routine-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">THE EVERYDAY THINGS</p>
          <h1>Routine</h1>
        </div>
      </header>
      <p className="routine-intro">
        Log the things you do every week with one tap. Weekly items keep their
        place on your calendar.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p className="sr-only" role="status">
        {notice}
      </p>

      <section className="routine-section" aria-labelledby="routine-log-title">
        <div className="routine-section-heading">
          <div>
            <h2 id="routine-log-title">Quick log</h2>
            <p>This week · {weekLabel}</p>
          </div>
          <button
            className="secondary-button compact"
            onClick={() => setEditor({ kind: "routine" })}
          >
            <Plus size={17} />
            Add routine item
          </button>
        </div>
        {routines.length ? (
          <div className="routine-grid">
            {routines.map((routine) => {
              const type =
                TYPES.find((value) => value.id === routine.category) ??
                TYPES[0];
              const { count, last } = progress.get(routine.id) ?? {
                count: 0,
                last: null,
              };
              const goal = routine.weeklyGoal;
              return (
                <article
                  className={`routine-card log-${routine.category}${goal && count >= goal ? " goal-met" : ""}`}
                  key={routine.id}
                >
                  <div className="routine-card-top">
                    <span className="routine-type" title={type.label}>
                      {type.icon}
                    </span>
                    <h3>{routine.title}</h3>
                    <button
                      className="icon-button"
                      aria-label={`Edit ${routine.title}`}
                      onClick={() => setEditor({ kind: "routine", routine })}
                    >
                      <Pencil size={15} />
                    </button>
                  </div>
                  <p className="routine-meta">
                    {type.label} · {duration(routine.durationMinutes)}
                  </p>
                  <p className="routine-progress">
                    <strong>
                      {goal ? `${count} of ${goal}` : count} this week
                    </strong>
                    {goal && count >= goal && (
                      <span className="routine-goal">
                        <Check size={13} /> Goal met
                      </span>
                    )}
                  </p>
                  {goal !== undefined && (
                    <div className="routine-track" aria-hidden="true">
                      <span
                        style={{
                          width: `${Math.min(100, (count / goal) * 100)}%`,
                        }}
                      />
                    </div>
                  )}
                  <p className="routine-last">
                    {last ? `Last: ${lastLogged(last, now)}` : "Not logged yet"}
                  </p>
                  <button
                    className="primary-button routine-log"
                    aria-label={`Log ${routine.title} now`}
                    onClick={() => log(routine)}
                  >
                    <Check size={16} /> Log now
                  </button>
                  {logged?.routineId === routine.id && (
                    <div className="routine-logged">
                      <span>{logged.message}</span>
                      <button
                        className="text-button"
                        onClick={() => {
                          try {
                            onUndo(logged.entryId);
                            setLogged(null);
                            setNotice(
                              `${routine.title} removed from your log.`,
                            );
                          } catch (reason) {
                            setError(failure(reason, "Could not undo."));
                          }
                        }}
                      >
                        <Undo2 size={14} /> Undo
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="routine-empty">
            <Sparkles size={28} />
            <h3>Nothing in your routine yet.</h3>
            <p>
              Start with the usual weekly things: walking the dog, laundry,
              sleep, meals, groceries, the dog’s water, and workouts twice a
              week. You can change any of them.
            </p>
            <div>
              <button className="primary-button" onClick={onAddStarter}>
                <Plus size={17} /> Add the usual routine
              </button>
              <button
                className="text-button"
                onClick={() => setEditor({ kind: "routine" })}
              >
                Add your own
              </button>
            </div>
          </div>
        )}
        <p className="routine-footnote">
          Each tap logs the activity in Log, ending now and lasting its usual
          time. Adjust the times there if you need to.
        </p>
      </section>

      <section
        className="routine-section"
        aria-labelledby="routine-weekly-title"
      >
        <div className="routine-section-heading">
          <div>
            <h2 id="routine-weekly-title">Weekly schedule</h2>
            <p>Repeats on your calendar every week.</p>
          </div>
          <button
            className="secondary-button compact"
            onClick={() => setEditor({ kind: "weekly" })}
          >
            <Plus size={17} />
            Add weekly item
          </button>
        </div>
        {weeklyItems.length ? (
          <ol className="weekly-list">
            {sortWeeklyItems(weeklyItems).map((item) => (
              <li key={item.id}>
                <span className="weekly-when">
                  <strong>{WEEKDAYS[item.weekday]}</strong>
                  {wallClock(item.time)}
                </span>
                <span className="weekly-title">
                  <strong>{item.title}</strong>
                  <small>
                    Next:{" "}
                    {nextOccurrence(item, now).toLocaleDateString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}
                  </small>
                </span>
                <button
                  className="icon-button"
                  aria-label={`Edit ${item.title}`}
                  onClick={() => setEditor({ kind: "weekly", item })}
                >
                  <Pencil size={15} />
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <div className="routine-empty weekly-empty">
            <Repeat size={26} />
            <p>
              Add things that happen at the same time every week, like church on
              Sunday or Bible study on Monday at 9 PM.
            </p>
          </div>
        )}
        <div className="routine-footnote weekly-footnote">
          <p>
            Weekly items appear on the calendar from the day you add them. They
            don’t send reminders.
          </p>
          <button className="text-button" onClick={onOpenCalendar}>
            <CalendarDays size={15} /> See them on the calendar
          </button>
        </div>
      </section>

      {editor?.kind === "routine" && (
        <RoutineEditor
          routine={editor.routine}
          onClose={() => setEditor(null)}
          onSave={(draft) => {
            onSaveRoutine(draft, editor.routine?.id);
            setEditor(null);
            setNotice(
              editor.routine ? "Routine item saved." : "Routine item added.",
            );
          }}
          onDelete={() => {
            onDeleteRoutine(editor.routine!.id);
            if (logged?.routineId === editor.routine!.id) setLogged(null);
            setEditor(null);
            setNotice("Routine item removed. Its past log entries stay.");
          }}
        />
      )}
      {editor?.kind === "weekly" && (
        <WeeklyEditor
          item={editor.item}
          onClose={() => setEditor(null)}
          onSave={(draft) => {
            onSaveWeekly(draft, editor.item?.id);
            setEditor(null);
            setNotice(
              editor.item ? "Weekly item saved." : "Weekly item added.",
            );
          }}
          onDelete={() => {
            onDeleteWeekly(editor.item!.id);
            setEditor(null);
            setNotice("Weekly item removed from the calendar.");
          }}
        />
      )}
    </div>
  );
}

function DeleteConfirm({
  label,
  question,
  onDelete,
}: {
  label: string;
  question: string;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return confirming ? (
    <div className="routine-delete-confirm">
      <p>{question}</p>
      <button
        type="button"
        className="text-button"
        onClick={() => setConfirming(false)}
      >
        Keep it
      </button>
      <button type="button" className="danger-button" onClick={onDelete}>
        {label}
      </button>
    </div>
  ) : (
    <button
      type="button"
      className="danger-text"
      onClick={() => setConfirming(true)}
    >
      {label}
    </button>
  );
}

function RoutineEditor({
  routine,
  onClose,
  onSave,
  onDelete,
}: {
  routine?: RoutineItem;
  onClose: () => void;
  onSave: (draft: RoutineDraft) => void;
  onDelete: () => void;
}) {
  const [error, setError] = useState("");
  const minutes = routine?.durationMinutes ?? 30;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const hours = String(fields.get("hours")).trim();
    const mins = String(fields.get("minutes")).trim();
    const goal = String(fields.get("goal")).trim();
    try {
      if (!/^\d+$/.test(hours || "0") || !/^\d+$/.test(mins || "0"))
        throw new Error("Use whole hours and minutes.");
      onSave({
        title: String(fields.get("title")),
        category: String(fields.get("category")) as LogCategory,
        durationMinutes: Number(hours || 0) * 60 + Number(mins || 0),
        weeklyGoal: goal ? Number(goal) : undefined,
      });
    } catch (reason) {
      setError(failure(reason, "Could not save this routine item."));
    }
  }
  return (
    <Sheet
      title={routine ? "Edit routine item" : "Add routine item"}
      description="Something you do every week without a set time. One tap logs it."
      onClose={onClose}
    >
      <form className="sheet-form" onSubmit={submit} noValidate>
        <label>
          Name
          <input
            name="title"
            required
            autoFocus
            maxLength={MAX_ROUTINE_TITLE_LENGTH}
            defaultValue={routine?.title}
            placeholder="Walk the dog"
          />
        </label>
        <label>
          Type
          <select name="category" defaultValue={routine?.category ?? "other"}>
            {TYPES.map((type) => (
              <option key={type.id} value={type.id}>
                {type.label}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="routine-duration">
          <legend>Usual duration</legend>
          <label>
            Hours
            <input
              name="hours"
              type="number"
              inputMode="numeric"
              min="0"
              max={MAX_ROUTINE_MINUTES / 60}
              defaultValue={Math.floor(minutes / 60)}
            />
          </label>
          <label>
            Minutes
            <input
              name="minutes"
              type="number"
              inputMode="numeric"
              min="0"
              max="59"
              defaultValue={minutes % 60}
            />
          </label>
        </fieldset>
        <label>
          Goal per week (optional)
          <input
            name="goal"
            type="number"
            inputMode="numeric"
            min="1"
            max={MAX_WEEKLY_GOAL}
            defaultValue={routine?.weeklyGoal ?? ""}
            placeholder="For example, 2 workouts"
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="sheet-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-button">
            <Check size={16} />
            {routine ? "Save changes" : "Add to routine"}
          </button>
        </div>
        {routine && (
          <DeleteConfirm
            label="Remove from routine"
            question="Remove this routine item? Entries already in your log stay."
            onDelete={onDelete}
          />
        )}
      </form>
    </Sheet>
  );
}

function WeeklyEditor({
  item,
  onClose,
  onSave,
  onDelete,
}: {
  item?: WeeklyItem;
  onClose: () => void;
  onSave: (draft: WeeklyDraft) => void;
  onDelete: () => void;
}) {
  const [error, setError] = useState("");
  return (
    <Sheet
      title={item ? "Edit weekly item" : "Add weekly item"}
      description="It appears on your calendar at this day and time every week."
      onClose={onClose}
    >
      <form
        className="sheet-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          try {
            onSave({
              title: String(fields.get("title")),
              weekday: Number(fields.get("weekday")),
              time: String(fields.get("time")),
            });
          } catch (reason) {
            setError(failure(reason, "Could not save this weekly item."));
          }
        }}
      >
        <label>
          Name
          <input
            name="title"
            required
            autoFocus
            maxLength={MAX_ROUTINE_TITLE_LENGTH}
            defaultValue={item?.title}
            placeholder="Bible study"
          />
        </label>
        <div className="schedule-date-fields">
          <label>
            Day
            <select name="weekday" defaultValue={item?.weekday ?? 0}>
              {WEEKDAYS.map((day, index) => (
                <option key={day} value={index}>
                  {day}
                </option>
              ))}
            </select>
          </label>
          <label>
            Time
            <input
              name="time"
              type="time"
              required
              defaultValue={item?.time ?? "09:00"}
            />
          </label>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="sheet-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-button">
            <Check size={16} />
            {item ? "Save changes" : "Add weekly item"}
          </button>
        </div>
        {item && (
          <DeleteConfirm
            label="Remove weekly item"
            question="Remove this weekly item from every week on the calendar?"
            onDelete={onDelete}
          />
        )}
      </form>
    </Sheet>
  );
}
