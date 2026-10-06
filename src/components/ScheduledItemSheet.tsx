import { useState } from "react";
import { Bell, CalendarDays } from "lucide-react";
import Sheet from "./Sheet";
import {
  localDateKey,
  localTimeValue,
  scheduledTimestamp,
} from "../lib/schedule";
import type { ScheduledItem } from "../lib/schedule";

export default function ScheduledItemSheet({
  item,
  date,
  onClose,
  onSave,
}: {
  item?: ScheduledItem;
  date?: string;
  onClose: () => void;
  onSave: (title: string, scheduledAt: string) => void;
}) {
  const [error, setError] = useState("");
  const defaultTime = item
    ? new Date(item.scheduledAt)
    : new Date(Math.ceil((Date.now() + 60_000) / (30 * 60_000)) * 30 * 60_000);
  return (
    <Sheet
      title={item ? "Edit scheduled item" : "Make a little time."}
      description="Choose a date and time. This item lives on your calendar."
      onClose={onClose}
    >
      <form
        className="sheet-form"
        onSubmit={(event) => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          try {
            onSave(
              String(fields.get("title")),
              scheduledTimestamp(
                String(fields.get("date")),
                String(fields.get("time")),
              ),
            );
          } catch (failure) {
            setError(
              failure instanceof Error
                ? failure.message
                : "Please check the fields.",
            );
          }
        }}
      >
        <label>
          Scheduled item name
          <input
            autoFocus
            required
            name="title"
            maxLength={500}
            defaultValue={item?.title ?? ""}
            placeholder="An appointment, a call, a little time for you…"
          />
        </label>
        <div className="schedule-date-fields">
          <label>
            Date
            <input
              required
              type="date"
              name="date"
              defaultValue={
                item
                  ? localDateKey(defaultTime)
                  : (date ?? localDateKey(defaultTime))
              }
            />
          </label>
          <label>
            Time
            <input
              required
              type="time"
              name="time"
              defaultValue={localTimeValue(defaultTime)}
            />
          </label>
        </div>
        <div className="calendar-reminder-note">
          <Bell size={18} />
          <p>
            Reminders appear in Do now after you complete a task: 3 hours
            before, then 30 minutes before. Acknowledging a reminder leaves this
            item on your calendar.
          </p>
        </div>
        <p className="calendar-timezone">
          Your local time ·{" "}
          {Intl.DateTimeFormat()
            .resolvedOptions()
            .timeZone.replaceAll("_", " ")}
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="sheet-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" type="submit">
            <CalendarDays size={17} />
            {item ? "Save changes" : "Schedule item"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
