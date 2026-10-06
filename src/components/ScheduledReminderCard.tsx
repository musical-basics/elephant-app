import { Bell, CalendarDays, Check } from "lucide-react";
import type { ScheduledItem, ReminderOffset } from "../lib/schedule";

export default function ScheduledReminderCard({
  item,
  offsetMinutes,
  now,
  onAcknowledge,
  onCalendar,
}: {
  item: ScheduledItem;
  offsetMinutes: ReminderOffset;
  now: number;
  onAcknowledge: () => void;
  onCalendar: () => void;
}) {
  const minutes = Math.max(
    1,
    Math.ceil((Date.parse(item.scheduledAt) - now) / 60_000),
  );
  const remaining =
    minutes >= 60
      ? `${Math.floor(minutes / 60)} ${minutes >= 120 ? "hours" : "hour"}${minutes % 60 ? ` ${minutes % 60} min` : ""}`
      : `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  return (
    <section
      className="scheduled-reminder"
      aria-label="Scheduled item reminder"
    >
      <div className="focus-center">
        <div className="focus-symbol">
          <Bell size={27} />
        </div>
        <p className="eyebrow">
          {offsetMinutes === 180 ? "3-HOUR REMINDER" : "30-MINUTE REMINDER"}
        </p>
        <div className="focus-frame">
          <h1>{item.title}</h1>
        </div>
        <p className="reminder-countdown">Coming up in {remaining}</p>
        <time className="reminder-date" dateTime={item.scheduledAt}>
          {new Date(item.scheduledAt).toLocaleString(undefined, {
            weekday: "long",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </time>
        <p className="focus-reassurance">
          Just a heads-up. Your next little step is waiting.
        </p>
      </div>
      <div className="focus-bottom">
        <div className="focus-actions">
          <button className="bite-button" onClick={onCalendar}>
            <CalendarDays size={21} />
            <span>
              View calendar<small>Your scheduled timeline</small>
            </span>
          </button>
          <button className="complete-button" onClick={onAcknowledge}>
            <Check size={23} />
            <span>
              Got it<small>Continue to the next item</small>
            </span>
          </button>
        </div>
        <p>
          This acknowledges the reminder. Your scheduled item stays on the
          calendar.
        </p>
      </div>
    </section>
  );
}
