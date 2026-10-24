import { useState } from "react";
import {
  Bell,
  LoaderCircle,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  Music2,
  Pencil,
  Plus,
  Repeat,
  RotateCcw,
  RefreshCw,
  Trash2,
} from "lucide-react";
import Sheet from "./Sheet";
import { localDateKey } from "../lib/schedule";
import type { ScheduledItem } from "../lib/schedule";
import { PIANO_STUDIO_URL } from "../lib/pianoLessons";
import type { LessonCompletion, PianoLesson } from "../lib/pianoLessons";
import { usePianoLessons } from "../lib/usePianoLessons";
import type { LocalPianoConnection } from "../lib/localPianoConnection";
import { weeklyOccurrences } from "../lib/routine";
import type { WeeklyItem, WeeklyOccurrence } from "../lib/routine";
import "./Calendar.css";

type CalendarEntry = ScheduledItem | PianoLesson | WeeklyOccurrence;
function isLesson(item: CalendarEntry): item is PianoLesson {
  return "source" in item && item.source === "piano-studio";
}
function isWeekly(item: CalendarEntry): item is WeeklyOccurrence {
  return "source" in item && item.source === "weekly";
}
function isCompleted(item: CalendarEntry): boolean {
  if (isWeekly(item)) return false;
  return isLesson(item) ? item.status === "completed" : !!item.completedAt;
}

export default function Calendar({
  items,
  weeklyItems,
  onOpenRoutine,
  accessToken,
  localPiano,
  now,
  onAdd,
  onEdit,
  onDelete,
  onToggle,
  onNotice,
}: {
  items: ScheduledItem[];
  /** Repeating items from Routine, shown every week but never stored per date. */
  weeklyItems: WeeklyItem[];
  onOpenRoutine: () => void;
  accessToken: string | null;
  localPiano: LocalPianoConnection;
  now: number;
  onAdd: (date: string) => void;
  onEdit: (item: ScheduledItem) => void;
  onDelete: (item: ScheduledItem) => void;
  onToggle: (item: ScheduledItem) => void;
  onNotice: (message: string) => void;
}) {
  const [completing, setCompleting] = useState<PianoLesson | null>(null);
  const [selectedDate, setSelectedDate] = useState(() =>
    localDateKey(new Date(now)),
  );
  const [month, setMonth] = useState(
    () => new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1),
  );
  const today = localDateKey(new Date(now));
  // Pad the visible grid by a day for Pacific-to-viewer date changes.
  const first = new Date(
    month.getFullYear(),
    month.getMonth(),
    -month.getDay(),
  );
  const last = new Date(
    month.getFullYear(),
    month.getMonth(),
    43 - month.getDay(),
  );
  const piano = usePianoLessons(
    accessToken,
    localDateKey(first),
    localDateKey(last),
    localPiano.key,
  );
  const hasPianoConnection = Boolean(accessToken || localPiano.key);
  const ordered: CalendarEntry[] = [
    ...items,
    ...(piano.feed?.lessons ?? []),
    ...weeklyOccurrences(
      weeklyItems,
      first,
      Math.round((last.getTime() - first.getTime()) / 86_400_000) + 1,
    ),
  ].sort(
    (a, b) =>
      Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt) ||
      a.id.localeCompare(b.id),
  );
  const selectedItems = ordered.filter(
    (item) => localDateKey(new Date(item.scheduledAt)) === selectedDate,
  );
  const upcoming = ordered
    .filter(
      (item) =>
        // Weekly items are predictable; keep this list for one-off plans.
        !isWeekly(item) &&
        !isCompleted(item) &&
        Date.parse(item.scheduledAt) >= now &&
        localDateKey(new Date(item.scheduledAt)) !== selectedDate,
    )
    .slice(0, 5);
  const counts = new Map<string, number>();
  for (const item of ordered) {
    const key = localDateKey(new Date(item.scheduledAt));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const days = Array.from(
    { length: 42 },
    (_, index) =>
      new Date(
        month.getFullYear(),
        month.getMonth(),
        1 - month.getDay() + index,
      ),
  );
  const selectedLabel = new Date(`${selectedDate}T12:00:00`).toLocaleDateString(
    undefined,
    { weekday: "long", month: "long", day: "numeric", year: "numeric" },
  );

  return (
    <div className="calendar-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">A LITTLE ROOM FOR LATER</p>
          <h1>Calendar</h1>
        </div>
        <button
          className="primary-button compact"
          onClick={() => onAdd(selectedDate)}
        >
          <Plus size={17} />
          Schedule item
        </button>
      </header>
      <p className="calendar-intro">
        A time and a place for what’s coming up. Your scheduled items have their
        own timeline.
      </p>
      {(!hasPianoConnection || piano.feed?.connected !== false) && (
        <section
          className="calendar-studio"
          aria-label="Piano studio connection"
        >
          <Music2 size={19} aria-hidden="true" />
          <div>
            <strong>Piano studio</strong>
            <p role="status">
              {!hasPianoConnection
                ? "Open your private calendar link to connect piano lessons to this browser. No Elephant sign-in needed."
                : piano.error
                  ? `${piano.error}${piano.feed ? " Showing the last loaded schedule." : ""}`
                  : piano.loading
                    ? "Refreshing piano lessons…"
                    : `Booked lessons sync automatically · Updated ${new Date(piano.feed!.fetchedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`}
            </p>
            {localPiano.storageError && (
              <p role="alert">
                This browser could not save the lesson connection. Keep your
                private calendar link to reconnect next time.
              </p>
            )}
            {hasPianoConnection && piano.feed?.connected && (
              <a
                href={PIANO_STUDIO_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Manage lessons in Piano Studio <ExternalLink size={12} />
              </a>
            )}
          </div>
          {hasPianoConnection && (
            <button
              className="icon-button"
              aria-label="Refresh piano lessons"
              disabled={piano.loading}
              onClick={piano.refresh}
            >
              <RefreshCw size={17} />
            </button>
          )}
        </section>
      )}
      <div className="calendar-layout">
        <section className="calendar-month" aria-label="Monthly calendar">
          <div className="calendar-month-heading">
            <h2 aria-live="polite">
              {month.toLocaleDateString(undefined, {
                month: "long",
                year: "numeric",
              })}
            </h2>
            <div>
              <button
                className="icon-button"
                aria-label="Previous month"
                onClick={() =>
                  setMonth(
                    new Date(month.getFullYear(), month.getMonth() - 1, 1),
                  )
                }
              >
                <ChevronLeft size={19} />
              </button>
              <button
                className="icon-button"
                aria-label="Next month"
                onClick={() =>
                  setMonth(
                    new Date(month.getFullYear(), month.getMonth() + 1, 1),
                  )
                }
              >
                <ChevronRight size={19} />
              </button>
            </div>
          </div>
          <div className="calendar-weekdays" aria-hidden="true">
            {["S", "M", "T", "W", "T", "F", "S"].map((day, i) => (
              <span key={i}>{day}</span>
            ))}
          </div>
          <div className="calendar-days">
            {days.map((day) => {
              const key = localDateKey(day);
              const count = counts.get(key) ?? 0;
              return (
                <button
                  key={key}
                  aria-label={`${day.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}${count ? `, ${count} scheduled ${count === 1 ? "item" : "items"}` : ""}`}
                  aria-pressed={key === selectedDate}
                  aria-current={key === today ? "date" : undefined}
                  className={`${day.getMonth() !== month.getMonth() ? "outside-month" : ""}${key === today ? " is-today" : ""}`}
                  onClick={() => {
                    setSelectedDate(key);
                    if (day.getMonth() !== month.getMonth())
                      setMonth(new Date(day.getFullYear(), day.getMonth(), 1));
                  }}
                >
                  <span>{day.getDate()}</span>
                  <span
                    className={`calendar-day-dot${count ? " has-items" : ""}`}
                  />
                </button>
              );
            })}
          </div>
          <div className="calendar-month-footer">
            <span>
              <span className="calendar-legend-dot" />
              Scheduled item
            </span>
            <button
              className="text-button"
              onClick={() => {
                setSelectedDate(today);
                setMonth(
                  new Date(
                    new Date(now).getFullYear(),
                    new Date(now).getMonth(),
                    1,
                  ),
                );
              }}
            >
              Today
            </button>
          </div>
          <div className="calendar-reminder-note">
            <Bell size={18} />
            <p>
              For items you schedule here: a gentle reminder after a completed
              task, 3 hours and 30 minutes before each item.
            </p>
          </div>
        </section>
        <section className="calendar-agenda" aria-label="Scheduled timeline">
          <div className="calendar-agenda-heading">
            <p className="eyebrow">
              {selectedDate === today ? "TODAY’S TIMELINE" : "YOUR TIMELINE"}
            </p>
            <h2>{selectedLabel}</h2>
          </div>
          {selectedItems.length ? (
            <ol className="schedule-list">
              {selectedItems.map((item) => (
                <li
                  className={`schedule-row${isCompleted(item) ? " is-completed" : ""}${isLesson(item) ? " is-lesson" : ""}${isWeekly(item) ? " is-weekly" : ""}`}
                  key={item.id}
                >
                  <time dateTime={item.scheduledAt}>
                    {new Date(item.scheduledAt).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </time>
                  <div className="schedule-item-body">
                    {isWeekly(item) ? (
                      <>
                        <button
                          className="schedule-title"
                          onClick={onOpenRoutine}
                        >
                          {item.title}
                        </button>
                        <p className="schedule-weekly-source">
                          <Repeat size={12} /> Weekly · every{" "}
                          {new Date(item.scheduledAt).toLocaleDateString(
                            undefined,
                            { weekday: "long" },
                          )}
                        </p>
                      </>
                    ) : isLesson(item) ? (
                      <>
                        <a
                          className="schedule-title"
                          href={PIANO_STUDIO_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {item.title}
                        </a>
                        <p>
                          {item.durationMinutes} min · Ends{" "}
                          {new Date(item.endsAt).toLocaleTimeString(undefined, {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </p>
                        <p className="schedule-lesson-source">
                          <Music2 size={12} /> Piano Studio ·{" "}
                          {item.status === "completed" ? "Completed" : "Booked"}
                        </p>
                        {item.status === "scheduled" &&
                          Date.parse(item.scheduledAt) <= now && (
                            <div className="schedule-actions">
                              <button
                                className="text-button"
                                aria-label={`Complete ${item.title}`}
                                onClick={() => setCompleting(item)}
                              >
                                <Check size={14} />
                                Complete
                              </button>
                            </div>
                          )}
                      </>
                    ) : (
                      <>
                        <button
                          className="schedule-title"
                          onClick={() => onEdit(item)}
                        >
                          {item.title}
                        </button>
                        <p>
                          {item.completedAt
                            ? "Completed"
                            : Date.parse(item.scheduledAt) <= now
                              ? "Scheduled time passed"
                              : "Scheduled"}
                        </p>
                        <div className="schedule-actions">
                          <button
                            className="text-button"
                            aria-label={`${item.completedAt ? "Reopen" : "Complete"} scheduled item ${item.title}`}
                            onClick={() => onToggle(item)}
                          >
                            {item.completedAt ? (
                              <RotateCcw size={14} />
                            ) : (
                              <Check size={14} />
                            )}
                            {item.completedAt ? "Reopen" : "Complete"}
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`Edit scheduled item ${item.title}`}
                            onClick={() => onEdit(item)}
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`Delete scheduled item ${item.title}`}
                            onClick={() => onDelete(item)}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="calendar-empty">
              <CalendarDays size={30} />
              <h3>A little open space.</h3>
              <p>Nothing scheduled for this day.</p>
              <button
                className="text-button"
                onClick={() => onAdd(selectedDate)}
              >
                <Plus size={16} />
                Add something for this day
              </button>
            </div>
          )}
          {upcoming.length > 0 && (
            <section className="calendar-upcoming">
              <h3>Coming up on other days</h3>
              {upcoming.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    const day = new Date(item.scheduledAt);
                    setSelectedDate(localDateKey(day));
                    setMonth(new Date(day.getFullYear(), day.getMonth(), 1));
                  }}
                >
                  <Clock3 size={16} />
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      {new Date(item.scheduledAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </small>
                  </span>
                  <ChevronRight size={16} />
                </button>
              ))}
            </section>
          )}
        </section>
      </div>
      <p className="calendar-timezone">
        Times are shown in{" "}
        {Intl.DateTimeFormat().resolvedOptions().timeZone.replaceAll("_", " ")}.
      </p>
      {completing && (
        <CompleteLessonSheet
          lesson={completing}
          onClose={() => setCompleting(null)}
          onComplete={async (notes) => {
            const result = await piano.complete(completing.id, notes);
            setCompleting(null);
            onNotice(completionMessage(result));
          }}
        />
      )}
    </div>
  );
}

function completionMessage(result: LessonCompletion): string {
  if (result.alreadyCompleted) return "This lesson was already completed.";
  const credits =
    result.creditDeducted &&
    result.previousCredits != null &&
    result.newCredits != null
      ? ` Credits ${result.previousCredits} → ${result.newCredits}.`
      : "";
  const next = result.nextLessonDate
    ? ` Next lesson booked for ${new Date(`${result.nextLessonDate}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}.`
    : "";
  return `Lesson logged in Piano Studio.${credits}${next}`;
}

function CompleteLessonSheet({
  lesson,
  onClose,
  onComplete,
}: {
  lesson: PianoLesson;
  onClose: () => void;
  onComplete: (notes: string) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const student = lesson.title.replace(/^Piano lesson · /, "");
  return (
    <Sheet
      title="Complete this lesson?"
      description={`Piano Studio will log ${student}’s lesson: it deducts 1 credit, books next week’s lesson if there isn’t one, and emails ${student} the lesson notes.`}
      onClose={() => {
        // Closing mid-request would hide whether the lesson was logged.
        if (!pending) onClose();
      }}
    >
      <form
        className="sheet-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending) return;
          setPending(true);
          setError("");
          try {
            await onComplete(
              String(new FormData(event.currentTarget).get("notes")),
            );
          } catch (failure) {
            setError(
              failure instanceof Error
                ? failure.message
                : "Piano Studio couldn’t log this lesson. Please try again.",
            );
            setPending(false);
          }
        }}
      >
        <p className="lesson-complete-when">
          {new Date(lesson.scheduledAt).toLocaleString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}{" "}
          · {lesson.durationMinutes} min
        </p>
        <label>
          Lesson notes for {student} (optional)
          <textarea
            name="notes"
            rows={5}
            maxLength={10_000}
            disabled={pending}
            placeholder="What you covered and what to practice"
          />
        </label>
        <p className="small muted lesson-complete-hint">
          Leave blank to keep any notes already saved in Piano Studio.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="sheet-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={pending}>
            {pending ? (
              <>
                <LoaderCircle className="spin" size={16} />
                Logging…
              </>
            ) : (
              <>
                <Check size={16} />
                Complete lesson
              </>
            )}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
