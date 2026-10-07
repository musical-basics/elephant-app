import type { PianoLesson } from "../src/lib/pianoLessons.js";

export const STUDIO_TIMEZONE = "America/Los_Angeles";

export interface StudioLessonRow {
  id: string;
  date: string;
  time: string;
  duration: number;
  status: "scheduled" | "completed";
  student: { name: string | null } | null;
}

export function validDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

/** Studio dates/times are Pacific wall-clock values, independent of server TZ. */
export function studioTimestamp(date: string, time: string): string {
  if (!validDate(date) || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time))
    throw new Error("Invalid studio lesson time");
  const wall = Date.parse(`${date}T${time.slice(0, 5)}:00Z`);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: STUDIO_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const wallAt = (instant: number) => {
    const parts = formatter.formatToParts(instant);
    const n = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((p) => p.type === type)?.value);
    return Date.UTC(
      n("year"),
      n("month") - 1,
      n("day"),
      n("hour"),
      n("minute"),
      n("second"),
    );
  };
  let instant = wall;
  for (let pass = 0; pass < 3; pass++) instant += wall - wallAt(instant);
  // Fail visibly instead of silently moving a nonexistent spring-forward time.
  if (wallAt(instant) !== wall)
    throw new Error("Invalid studio daylight saving time");
  return new Date(instant).toISOString();
}

export function calendarLesson(row: StudioLessonRow): PianoLesson {
  const scheduledAt = studioTimestamp(row.date, row.time);
  const durationMinutes = row.duration > 0 ? row.duration : 30;
  return {
    source: "piano-studio",
    id: `piano-studio:${row.id}`,
    title: `Piano lesson · ${row.student?.name?.trim() || "Student"}`,
    scheduledAt,
    endsAt: new Date(
      Date.parse(scheduledAt) + durationMinutes * 60_000,
    ).toISOString(),
    durationMinutes,
    status: row.status,
  };
}
