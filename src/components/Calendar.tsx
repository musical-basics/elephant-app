import { useState } from "react";
import {
  Bell,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  Music2,
  Pencil,
  Plus,
  RotateCcw,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { localDateKey } from "../lib/schedule";
import type { ScheduledItem } from "../lib/schedule";
import { PIANO_STUDIO_URL } from "../lib/pianoLessons";
import type { PianoLesson } from "../lib/pianoLessons";
import { usePianoLessons } from "../lib/usePianoLessons";
import "./Calendar.css";

type CalendarEntry = ScheduledItem | PianoLesson;
function isLesson(item: CalendarEntry): item is PianoLesson {
  return "source" in item && item.source === "piano-studio";
}
function isCompleted(item: CalendarEntry): boolean {
  return isLesson(item) ? item.status === "completed" : !!item.completedAt;
}

export default function Calendar({
  items,
  accessToken,
  now,
  onAdd,
  onEdit,
  onDelete,
  onToggle,
}: {
  items: ScheduledItem[];
  accessToken: string | null;
  now: number;
  onAdd: (date: string) => void;
  onEdit: (item: ScheduledItem) => void;
  onDelete: (item: ScheduledItem) => void;
  onToggle: (item: ScheduledItem) => void;
}) {
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
  );
  const ordered: CalendarEntry[] = [
    ...items,
    ...(piano.feed?.lessons ?? []),
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
      {(!accessToken || piano.feed?.connected !== false) && (
        <section
          className="calendar-studio"
          aria-label="Piano studio connection"
        >
          <Music2 size={19} aria-hidden="true" />
          <div>
            <strong>Piano studio</strong>
            <p role="status">
              {!accessToken
                ? "Sign in to your connected Elephant account to see your piano lessons."
                : piano.error
                  ? `${piano.error}${piano.feed ? " Showing the last loaded schedule." : ""}`
                  : piano.loading
                    ? "Refreshing piano lessons…"
                    : `Booked lessons sync automatically · Updated ${new Date(piano.feed!.fetchedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`}
            </p>
            {accessToken && piano.feed?.connected && (
              <a
                href={PIANO_STUDIO_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Manage lessons in Piano Studio <ExternalLink size={12} />
              </a>
            )}
          </div>
          {accessToken && (
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
                  className={`schedule-row${isCompleted(item) ? " is-completed" : ""}${isLesson(item) ? " is-lesson" : ""}`}
                  key={item.id}
                >
                  <time dateTime={item.scheduledAt}>
                    {new Date(item.scheduledAt).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </time>
                  <div className="schedule-item-body">
                    {isLesson(item) ? (
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
    </div>
  );
}
