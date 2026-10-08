import { useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock3,
  Dumbbell,
  GripHorizontal,
  Moon,
  Plus,
  Utensils,
} from "lucide-react";
import Sheet from "./Sheet";
import type { AppState } from "../lib/model";
import {
  addDays,
  daySegments,
  latestLogEndpoint,
  localDateTime,
  logDuration,
  minutesOnDay,
  MIN_LOG_MINUTES,
  parseLocalDateTime,
  timeAtMinute,
  weekStart,
} from "../lib/activityLog";
import type {
  LogCategory,
  LogDraft,
  LogEntry,
  LogSegment,
} from "../lib/activityLog";
import { localDateKey } from "../lib/schedule";
import "./ActivityLog.css";

const HOUR_HEIGHT = 64;
const CATEGORIES: { id: LogCategory; label: string }[] = [
  { id: "task", label: "Task" },
  { id: "sleep", label: "Sleep" },
  { id: "meal", label: "Meal" },
  { id: "exercise", label: "Exercise" },
  { id: "other", label: "Other" },
];
const time = (value: string) =>
  new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
const hourLabel = (hour: number) =>
  hour === 0 || hour === 24
    ? "12 AM"
    : hour === 12
      ? "12 PM"
      : `${hour % 12} ${hour < 12 ? "AM" : "PM"}`;

type Props = {
  state: AppState;
  onSave: (draft: LogDraft, id?: string) => void;
  onDelete: (id: string) => void;
};
type Drag = {
  entry: LogEntry;
  edge: "start" | "end";
  day: Date;
  y: number;
  scroll: number;
  minute: number;
  draft: LogEntry;
};

export default function ActivityLog({ state, onSave, onDelete }: Props) {
  const [week, setWeek] = useState(() => weekStart(new Date()));
  const [editor, setEditor] = useState<{
    entry?: LogEntry;
    category: LogCategory;
  } | null>(null);
  const [preview, setPreview] = useState<LogEntry | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const entries = state.activityLog ?? [];
  const displayEntries = entries.map((entry) =>
    preview?.id === entry.id ? preview : entry,
  );
  const days = Array.from({ length: 7 }, (_, index) => addDays(week, index));
  const until = addDays(week, 7);
  const pending = entries.filter(
    (entry) =>
      entry.startedAt === null &&
      Date.parse(entry.endedAt) >= +week &&
      Date.parse(entry.endedAt) < +until,
  );
  const weekEntries = entries.filter(
    (entry) =>
      entry.startedAt !== null &&
      Date.parse(entry.startedAt) < +until &&
      Date.parse(entry.endedAt) >= +week,
  );
  const today = localDateKey(new Date());
  const weekLabel = `${week.toLocaleDateString([], { month: "short", day: "numeric" })} – ${addDays(week, 6).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`;

  function saveResize(entry: LogEntry) {
    try {
      onSave(entry, entry.id);
      setNotice(
        `${entry.title}: ${time(entry.startedAt!)} to ${time(entry.endedAt)}. Saved.`,
      );
      setError("");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not change this time.",
      );
    }
  }
  function startDrag(
    event: PointerEvent<HTMLButtonElement>,
    entry: LogEntry,
    edge: "start" | "end",
    day: Date,
  ) {
    event.preventDefault();
    event.stopPropagation();
    if (event.button !== 0 || entry.startedAt === null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const original = Date.parse(
      edge === "start" ? entry.startedAt : entry.endedAt,
    );
    drag.current = {
      entry,
      edge,
      day,
      y: event.clientY,
      scroll: scroller.current?.scrollTop ?? 0,
      minute: original === +addDays(day, 1) ? 1440 : minutesOnDay(original),
      draft: entry,
    };
    setError("");
  }
  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current) return;
    const viewport = scroller.current;
    if (viewport) {
      const bounds = viewport.getBoundingClientRect();
      if (event.clientY > bounds.bottom - 32) viewport.scrollTop += 12;
      else if (event.clientY < bounds.top + 80) viewport.scrollTop -= 12;
    }
    const delta =
      event.clientY - current.y + (viewport?.scrollTop ?? 0) - current.scroll;
    const minute = Math.max(
      current.edge === "end" ? 5 : 0,
      Math.min(
        current.edge === "start" ? 1435 : 1440,
        Math.round((current.minute + (delta * 60) / HOUR_HEIGHT) / 5) * 5,
      ),
    );
    try {
      const value = timeAtMinute(current.day, minute);
      const draft = {
        ...current.entry,
        [current.edge === "start" ? "startedAt" : "endedAt"]: value,
      };
      if (Date.parse(draft.endedAt) <= Date.parse(draft.startedAt!)) return;
      current.draft = draft;
      setPreview(draft);
    } catch {
      /* Keep the last valid position while crossing a skipped DST time. */
    }
  }
  function endDrag(event: PointerEvent<HTMLButtonElement>, cancel = false) {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    setPreview(null);
    if (!cancel && current.draft !== current.entry) saveResize(current.draft);
  }
  function resizeWithKeyboard(
    event: KeyboardEvent<HTMLButtonElement>,
    entry: LogEntry,
    edge: "start" | "end",
  ) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    event.stopPropagation();
    const field = edge === "start" ? "startedAt" : "endedAt";
    const value = entry[field];
    if (!value) return;
    const delta =
      (event.key === "ArrowUp" ? -1 : 1) * (event.shiftKey ? 15 : 5) * 60_000;
    saveResize({
      ...entry,
      [field]: new Date(Date.parse(value) + delta).toISOString(),
    });
  }
  function handle(segment: LogSegment, edge: "start" | "end", day: Date) {
    return (
      <button
        type="button"
        className={`log-resize log-resize-${edge}`}
        aria-label={`Adjust ${edge} of ${segment.entry.title}`}
        title={`Drag to change ${edge}. Arrow keys adjust 5 minutes; Shift adjusts 15.`}
        onPointerDown={(event) => startDrag(event, segment.entry, edge, day)}
        onPointerMove={moveDrag}
        onPointerUp={(event) => endDrag(event)}
        onPointerCancel={(event) => endDrag(event, true)}
        onKeyDown={(event) => resizeWithKeyboard(event, segment.entry, edge)}
        onClick={(event) => event.stopPropagation()}
      >
        <GripHorizontal size={16} />
      </button>
    );
  }

  return (
    <div className="activity-log">
      <div className="page-heading">
        <div>
          <p className="eyebrow">THE SHAPE OF YOUR DAYS</p>
          <h1>Log</h1>
          <p className="log-intro">
            Your work, rest, and everything in between.
          </p>
        </div>
        <button
          className="primary-button"
          onClick={() => setEditor({ category: "other" })}
        >
          <Plus size={17} /> Add logged item
        </button>
      </div>
      <div className="log-staples" aria-label="Log an everyday activity">
        <span>Just finished?</span>
        <button
          className="log-staple log-sleep"
          onClick={() => setEditor({ category: "sleep" })}
        >
          <Moon size={17} /> Sleep
        </button>
        <button
          className="log-staple log-meal"
          onClick={() => setEditor({ category: "meal" })}
        >
          <Utensils size={17} /> Meal
        </button>
        <button
          className="log-staple log-exercise"
          onClick={() => setEditor({ category: "exercise" })}
        >
          <Dumbbell size={17} /> Exercise
        </button>
      </div>
      <div className="log-week-toolbar">
        <div>
          <h2>{weekLabel}</h2>
          <p>Monday to Sunday · 12 AM to 12 AM</p>
        </div>
        <div className="log-week-buttons">
          <button
            className="icon-button"
            aria-label="Previous week"
            onClick={() => setWeek(addDays(week, -7))}
          >
            <ArrowLeft size={18} />
          </button>
          <button
            className="secondary-button"
            onClick={() => setWeek(weekStart(new Date()))}
          >
            This week
          </button>
          <button
            className="icon-button"
            aria-label="Next week"
            onClick={() => setWeek(addDays(week, 7))}
          >
            <ArrowRight size={18} />
          </button>
        </div>
      </div>
      <div className="log-legend" aria-label="Activity colors">
        {CATEGORIES.map((category) => (
          <span key={category.id} className={`log-${category.id}`}>
            <i />
            {category.label}
          </span>
        ))}
      </div>
      <p className="log-help">
        Drag a block’s top or bottom handle to adjust its time. Select a block
        for exact dates and times.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p className="sr-only" role="status">
        {notice}
      </p>
      {pending.length > 0 && (
        <section
          className="log-pending"
          aria-label="Activities needing a start time"
        >
          <Clock3 size={18} />
          <div>
            <strong>When did you start?</strong>
            <p>
              These first completions have no earlier activity to measure from.
            </p>
            {pending.map((entry) => (
              <button
                key={entry.id}
                className="text-button"
                onClick={() => setEditor({ entry, category: entry.category })}
              >
                {entry.title} · {time(entry.endedAt)} · Set start time
              </button>
            ))}
          </div>
        </section>
      )}
      <div
        className="log-scroll"
        ref={scroller}
        tabIndex={0}
        role="region"
        aria-label="Weekly activity timeline, all 24 hours"
      >
        <div
          className="log-grid"
          style={{ "--log-hour-height": `${HOUR_HEIGHT}px` } as CSSProperties}
        >
          <div className="log-corner">TIME</div>
          {days.map((day) => (
            <div
              className={`log-day-heading ${localDateKey(day) === today ? "is-today" : ""}`}
              key={+day}
            >
              <span>{day.toLocaleDateString([], { weekday: "short" })}</span>
              <strong>{day.getDate()}</strong>
            </div>
          ))}
          <div className="log-hours" aria-hidden="true">
            {Array.from({ length: 25 }, (_, hour) => (
              <span key={hour} style={{ top: `${hour * HOUR_HEIGHT}px` }}>
                {hourLabel(hour)}
              </span>
            ))}
          </div>
          {days.map((day) => (
            <div
              className={`log-day ${localDateKey(day) === today ? "is-today" : ""}`}
              key={+day}
              aria-label={day.toLocaleDateString([], {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            >
              {daySegments(displayEntries, day).map((segment) => {
                const height = Math.max(
                  (MIN_LOG_MINUTES * HOUR_HEIGHT) / 60,
                  ((segment.end - segment.start) * HOUR_HEIGHT) / 60,
                );
                const top = Math.min(
                  (segment.start * HOUR_HEIGHT) / 60,
                  24 * HOUR_HEIGHT - height,
                );
                return (
                  <div
                    key={segment.entry.id}
                    data-entry-id={segment.entry.id}
                    className={`log-block log-${segment.entry.category}${height < 64 ? " is-short" : ""}`}
                    style={{
                      top,
                      height,
                      left: `calc(${(segment.lane * 100) / segment.lanes}% + 2px)`,
                      width: `calc(${100 / segment.lanes}% - 4px)`,
                    }}
                  >
                    {segment.first && handle(segment, "start", day)}
                    <button
                      className="log-block-content"
                      aria-label={`Edit logged item ${segment.entry.title}, ${time(segment.entry.startedAt!)} to ${time(segment.entry.endedAt)}`}
                      title={`${segment.entry.title}\n${new Date(segment.entry.startedAt!).toLocaleString()} – ${new Date(segment.entry.endedAt).toLocaleString()}\n${logDuration(segment.entry)}`}
                      onClick={() =>
                        setEditor({
                          entry: segment.entry,
                          category: segment.entry.category,
                        })
                      }
                    >
                      <strong>
                        {!segment.first && "↳ "}
                        {segment.entry.title}
                      </strong>
                      <span>
                        {time(segment.entry.startedAt!)}–
                        {time(segment.entry.endedAt)}
                      </span>
                      <small>{logDuration(segment.entry)}</small>
                    </button>
                    {segment.last && handle(segment, "end", day)}
                  </div>
                );
              })}
              {localDateKey(day) === today && (
                <div
                  className="log-now"
                  style={{
                    top: `${(minutesOnDay(Date.now()) * HOUR_HEIGHT) / 60}px`,
                  }}
                  aria-label="Current time"
                />
              )}
            </div>
          ))}
        </div>
      </div>
      {!weekEntries.length && !pending.length && (
        <p className="log-empty">
          A fresh week of possibilities. Log an activity or complete a task to
          begin.
        </p>
      )}
      <p className="log-help log-footnote">
        New task completions run from the previous completion or logged end
        time. Times are shown in{" "}
        {Intl.DateTimeFormat().resolvedOptions().timeZone.replaceAll("_", " ")}.
      </p>
      {editor && (
        <LogEditor
          key={editor.entry?.id ?? editor.category}
          entry={editor.entry}
          category={editor.category}
          state={state}
          onClose={() => setEditor(null)}
          onSave={(draft, id) => {
            onSave(draft, id);
            setEditor(null);
            setNotice("Activity saved.");
          }}
          onDelete={(id) => {
            onDelete(id);
            setEditor(null);
            setNotice("Logged item removed.");
          }}
        />
      )}
    </div>
  );
}

function LogEditor({
  entry,
  category,
  state,
  onClose,
  onSave,
  onDelete,
}: {
  entry?: LogEntry;
  category: LogCategory;
  state: AppState;
  onClose: () => void;
  onSave: Props["onSave"];
  onDelete: Props["onDelete"];
}) {
  const [end] = useState(() => entry?.endedAt ?? new Date().toISOString());
  const [start] = useState(
    () =>
      entry?.startedAt ??
      (entry
        ? null
        : new Date(
            latestLogEndpoint(state) ?? Date.now() - 30 * 60000,
          ).toISOString()),
  );
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState(false);
  return (
    <Sheet
      title={entry ? "Edit logged item" : "Add logged item"}
      description="Record what you finished. Start and end can be on different dates."
      onClose={onClose}
    >
      <form
        className="sheet-form"
        onSubmit={(event) => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          try {
            onSave(
              {
                title: String(fields.get("title")),
                category: String(fields.get("category")) as LogCategory,
                startedAt:
                  start && String(fields.get("start")) === localDateTime(start)
                    ? start
                    : parseLocalDateTime(String(fields.get("start"))),
                endedAt:
                  String(fields.get("end")) === localDateTime(end)
                    ? end
                    : parseLocalDateTime(String(fields.get("end"))),
              },
              entry?.id,
            );
          } catch (failure) {
            setError(
              failure instanceof Error
                ? failure.message
                : "Could not save this activity.",
            );
          }
        }}
      >
        <label>
          Activity name
          <input
            name="title"
            maxLength={500}
            required
            autoFocus
            defaultValue={
              entry?.title ??
              (category === "other"
                ? ""
                : CATEGORIES.find((value) => value.id === category)?.label)
            }
            placeholder="A walk, reading, a conversation…"
          />
        </label>
        <label>
          Activity type
          <select name="category" defaultValue={category}>
            {CATEGORIES.map((value) => (
              <option value={value.id} key={value.id}>
                {value.label}
              </option>
            ))}
          </select>
        </label>
        <div className="log-form-times">
          <label>
            Start
            <input
              name="start"
              type="datetime-local"
              required
              defaultValue={start ? localDateTime(start) : ""}
            />
          </label>
          <label>
            End
            <input
              name="end"
              type="datetime-local"
              required
              defaultValue={localDateTime(end)}
            />
          </label>
        </div>
        {entry?.inferred && (
          <p className="small muted">
            This task’s times were inferred from its completion. Adjust them to
            reflect what happened.
          </p>
        )}
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
            {entry ? "Save changes" : "Save logged item"}
          </button>
        </div>
        {entry &&
          (removing ? (
            <div className="log-delete-confirm">
              <p>Remove this entry from your log?</p>
              <button
                type="button"
                className="text-button"
                onClick={() => setRemoving(false)}
              >
                Keep entry
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={() => onDelete(entry.id)}
              >
                Remove logged item
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="danger-text"
              onClick={() => setRemoving(true)}
            >
              Delete logged item
            </button>
          ))}
      </form>
    </Sheet>
  );
}
