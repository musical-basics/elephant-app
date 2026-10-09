import { useEffect, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  List,
  NotebookPen,
  Pencil,
  Plus,
  Search,
} from "lucide-react";
import Sheet from "./Sheet";
import { localDateTime, parseLocalDateTime } from "../lib/activityLog";
import {
  groupDiaryByDay,
  MAX_DIARY_LENGTH,
  searchDiary,
  sortDiary,
} from "../lib/diary";
import type { DiaryDraft, DiaryEntry, DiarySort } from "../lib/diary";
import { localDateKey } from "../lib/schedule";
import "./Calendar.css";
import "./Diary.css";

export type DiaryView = "calendar" | "list";
const PAGE_SIZE = 25;
const DRAFT_KEY = "elephant.diary.draft.v1";
const time = (value: string) =>
  new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
const longDay = (key: string) =>
  new Date(`${key}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
const monthOf = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), 1);

/** A past or future day gets the current time of day, so it sorts naturally. */
function timeOnDay(key: string): string {
  const now = new Date();
  if (key === localDateKey(now)) return now.toISOString();
  const [year, month, day] = key.split("-").map(Number);
  return new Date(
    year,
    month - 1,
    day,
    now.getHours(),
    now.getMinutes(),
  ).toISOString();
}

function saveOnShortcut(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (
    event.key !== "Enter" ||
    !(event.metaKey || event.ctrlKey) ||
    event.nativeEvent.isComposing
  )
    return;
  event.preventDefault();
  if (!event.repeat) event.currentTarget.form?.requestSubmit();
}

function readDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}

type Props = {
  entries: DiaryEntry[];
  view: DiaryView;
  onView: (view: DiaryView) => void;
  sort: DiarySort;
  onSort: (sort: DiarySort) => void;
  onSave: (draft: DiaryDraft, id?: string) => void;
  onDelete: (id: string) => void;
};

export default function Diary({
  entries,
  view,
  onView,
  sort,
  onSort,
  onSave,
  onDelete,
}: Props) {
  const [draft, setDraft] = useState(readDraft);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<{
    entry?: DiaryEntry;
    writtenAt: string;
  } | null>(null);
  const [selectedDate, setSelectedDate] = useState(() =>
    localDateKey(new Date()),
  );
  const [month, setMonth] = useState(() => monthOf(new Date()));
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const today = localDateKey(new Date());
  const sorted = sortDiary(entries, sort);

  useEffect(() => {
    // An unsent entry survives leaving the page; it is never synced.
    try {
      if (draft) localStorage.setItem(DRAFT_KEY, draft);
      else localStorage.removeItem(DRAFT_KEY);
    } catch {
      // Browser storage is optional for drafts.
    }
  }, [draft]);

  function showDay(key: string) {
    setSelectedDate(key);
    setMonth(monthOf(new Date(`${key}T12:00:00`)));
  }
  function write(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const writtenAt = new Date().toISOString();
    try {
      onSave({ text: draft, writtenAt });
      setDraft("");
      setError("");
      setNotice(`Entry saved at ${time(writtenAt)}.`);
      showDay(localDateKey(new Date(writtenAt)));
      // Show the page the new entry lands on; the last page clamps below.
      setPage(sort === "newest" ? 1 : Number.MAX_SAFE_INTEGER);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not save this entry.",
      );
    }
  }

  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = localDateKey(new Date(entry.writtenAt));
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
  const dayEntries = sorted.filter(
    (entry) => localDateKey(new Date(entry.writtenAt)) === selectedDate,
  );

  const matching = searchDiary(sorted, query);
  const pageCount = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const visible = matching.slice(pageStart, pageStart + PAGE_SIZE);
  function changePage(next: number) {
    setPage(next);
    window.scrollTo(0, 0);
  }

  const note = (entry: DiaryEntry) => (
    <DiaryNote
      key={entry.id}
      entry={entry}
      onEdit={() => setEditor({ entry, writtenAt: entry.writtenAt })}
    />
  );

  return (
    <div className="diary-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">A FEW WORDS FOR TODAY</p>
          <h1>Diary</h1>
        </div>
      </header>
      <form className="diary-composer" onSubmit={write}>
        <label htmlFor="diary-draft">
          <NotebookPen size={16} />
          {new Date().toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </label>
        <textarea
          id="diary-draft"
          aria-label="New diary entry"
          value={draft}
          maxLength={MAX_DIARY_LENGTH}
          rows={4}
          placeholder="What’s on your mind?"
          onChange={(event) => {
            setDraft(event.target.value);
            setError("");
          }}
          onKeyDown={saveOnShortcut}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="diary-composer-footer">
          <p role="status">
            {notice || "Saved with the current date and time."}
          </p>
          <button
            type="submit"
            className="primary-button compact"
            disabled={!draft.trim()}
          >
            <Check size={16} />
            Save entry
          </button>
        </div>
      </form>

      <div className="list-toolbar diary-toolbar">
        <div className="tabs" role="tablist" aria-label="Diary view">
          <button
            role="tab"
            aria-selected={view === "calendar"}
            onClick={() => onView("calendar")}
          >
            <CalendarDays size={15} />
            Calendar
          </button>
          <button
            role="tab"
            aria-selected={view === "list"}
            onClick={() => onView("list")}
          >
            <List size={15} />
            List<span>{entries.length}</span>
          </button>
        </div>
        <div className="diary-toolbar-controls">
          <label className="sort-control">
            Sort
            <select
              aria-label="Sort diary entries"
              value={sort}
              onChange={(event) => {
                onSort(event.target.value as DiarySort);
                setPage(1);
              }}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
            <ChevronDown size={14} />
          </label>
          {view === "list" && (
            <label className="search-box">
              <Search size={17} />
              <input
                aria-label="Search diary entries"
                placeholder="Search your diary"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
              />
            </label>
          )}
        </div>
      </div>

      {view === "calendar" ? (
        <div className="calendar-layout">
          <section className="calendar-month" aria-label="Diary calendar">
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
                    aria-label={`${longDay(key)}${count ? `, ${count} diary ${count === 1 ? "entry" : "entries"}` : ""}`}
                    aria-pressed={key === selectedDate}
                    aria-current={key === today ? "date" : undefined}
                    className={`${day.getMonth() !== month.getMonth() ? "outside-month" : ""}${key === today ? " is-today" : ""}`}
                    onClick={() => showDay(key)}
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
                Diary entry
              </span>
              <button className="text-button" onClick={() => showDay(today)}>
                Today
              </button>
            </div>
          </section>
          <section className="calendar-agenda" aria-label="Diary entries">
            <div className="calendar-agenda-heading">
              <p className="eyebrow">
                {selectedDate === today ? "TODAY’S ENTRIES" : "YOUR ENTRIES"}
              </p>
              <h2>{longDay(selectedDate)}</h2>
            </div>
            {dayEntries.length ? (
              <>
                <div className="diary-notes">{dayEntries.map(note)}</div>
                <button
                  className="text-button diary-add-day"
                  onClick={() =>
                    setEditor({ writtenAt: timeOnDay(selectedDate) })
                  }
                >
                  <Plus size={16} />
                  Add an entry for this day
                </button>
              </>
            ) : (
              <div className="calendar-empty">
                <NotebookPen size={30} />
                <h3>A blank page.</h3>
                <p>No diary entries for this day.</p>
                <button
                  className="text-button"
                  onClick={() =>
                    setEditor({ writtenAt: timeOnDay(selectedDate) })
                  }
                >
                  <Plus size={16} />
                  Write an entry for this day
                </button>
              </div>
            )}
          </section>
        </div>
      ) : (
        <>
          {visible.length ? (
            groupDiaryByDay(visible).map((group) => (
              <section
                className="diary-day"
                key={group.day}
                aria-label={longDay(group.day)}
              >
                <h2>
                  <button
                    className="diary-day-link"
                    title="Open this day in the calendar"
                    onClick={() => {
                      showDay(group.day);
                      onView("calendar");
                    }}
                  >
                    {longDay(group.day)}
                  </button>
                </h2>
                <div className="diary-notes">{group.entries.map(note)}</div>
              </section>
            ))
          ) : (
            <div className="calendar-empty diary-list-empty">
              <NotebookPen size={30} />
              <h3>{query ? "No matching entries." : "A blank page."}</h3>
              <p>
                {query
                  ? "Try a different word."
                  : "Write your first entry above. It will be timestamped automatically."}
              </p>
            </div>
          )}
          {pageCount > 1 && (
            <nav className="completed-pagination" aria-label="Diary pagination">
              <p className="completed-page-range">
                {pageStart + 1}–{pageStart + visible.length} of{" "}
                {matching.length} entries
              </p>
              <div className="completed-page-controls">
                <button
                  type="button"
                  className="secondary-button"
                  aria-label="Previous page"
                  disabled={currentPage === 1}
                  onClick={() => changePage(currentPage - 1)}
                >
                  <ArrowLeft size={16} /> Previous
                </button>
                <span aria-live="polite" aria-atomic="true">
                  Page {currentPage} of {pageCount}
                </span>
                <button
                  type="button"
                  className="secondary-button"
                  aria-label="Next page"
                  disabled={currentPage === pageCount}
                  onClick={() => changePage(currentPage + 1)}
                >
                  Next <ArrowRight size={16} />
                </button>
              </div>
            </nav>
          )}
        </>
      )}
      <p className="calendar-timezone">
        Times are shown in{" "}
        {Intl.DateTimeFormat().resolvedOptions().timeZone.replaceAll("_", " ")}.
      </p>
      {editor && (
        <DiaryEditor
          key={editor.entry?.id ?? editor.writtenAt}
          entry={editor.entry}
          writtenAt={editor.writtenAt}
          onClose={() => setEditor(null)}
          onSave={(value, id) => {
            onSave(value, id);
            setEditor(null);
            setNotice(id ? "Entry updated." : "Entry saved.");
            showDay(localDateKey(new Date(value.writtenAt)));
          }}
          onDelete={(id) => {
            onDelete(id);
            setEditor(null);
            setNotice("Entry deleted.");
          }}
        />
      )}
    </div>
  );
}

function DiaryNote({
  entry,
  onEdit,
}: {
  entry: DiaryEntry;
  onEdit: () => void;
}) {
  return (
    <article className="diary-note">
      <header>
        <time
          dateTime={entry.writtenAt}
          title={new Date(entry.writtenAt).toLocaleString()}
        >
          {time(entry.writtenAt)}
        </time>
        {entry.updatedAt && (
          <small title={`Edited ${new Date(entry.updatedAt).toLocaleString()}`}>
            Edited
          </small>
        )}
        <button
          className="icon-button"
          aria-label={`Edit diary entry from ${new Date(entry.writtenAt).toLocaleString()}`}
          onClick={onEdit}
        >
          <Pencil size={15} />
        </button>
      </header>
      <p className="diary-text">{entry.text}</p>
    </article>
  );
}

function DiaryEditor({
  entry,
  writtenAt,
  onClose,
  onSave,
  onDelete,
}: {
  entry?: DiaryEntry;
  writtenAt: string;
  onClose: () => void;
  onSave: Props["onSave"];
  onDelete: Props["onDelete"];
}) {
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState(false);
  return (
    <Sheet
      title={entry ? "Edit diary entry" : "New diary entry"}
      description="Your words, kept with the date and time below."
      onClose={onClose}
      resizeKey="elephant.diary.editor-size.v1"
    >
      <form
        className="sheet-form diary-editor-form"
        onSubmit={(event) => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          const when = String(fields.get("writtenAt"));
          try {
            onSave(
              {
                text: String(fields.get("text")),
                // Keep seconds when the time was left as is.
                writtenAt:
                  when === localDateTime(writtenAt)
                    ? writtenAt
                    : parseLocalDateTime(when),
              },
              entry?.id,
            );
          } catch (failure) {
            setError(
              failure instanceof Error
                ? failure.message
                : "Could not save this entry.",
            );
          }
        }}
      >
        <label className="diary-editor-text">
          Entry
          <textarea
            name="text"
            required
            autoFocus
            rows={8}
            maxLength={MAX_DIARY_LENGTH}
            defaultValue={entry?.text}
            placeholder="What’s on your mind?"
            onKeyDown={saveOnShortcut}
          />
        </label>
        <label>
          Date and time
          <input
            name="writtenAt"
            type="datetime-local"
            required
            defaultValue={localDateTime(writtenAt)}
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
            {entry ? "Save changes" : "Save entry"}
          </button>
        </div>
        {entry &&
          (removing ? (
            <div className="diary-delete-confirm">
              <p>Delete this diary entry? This can’t be undone.</p>
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
                Delete entry
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="danger-text"
              onClick={() => setRemoving(true)}
            >
              Delete diary entry
            </button>
          ))}
      </form>
    </Sheet>
  );
}
