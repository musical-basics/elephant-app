import type { Item } from "./model";

export type AnalyticsRange = 7 | 30 | 90;

export interface DailyActivity {
  key: string;
  date: Date;
  added: number;
  done: number;
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Calendar arithmetic keeps every local day, including 23- and 25-hour days. */
export function getDailyActivity(
  items: readonly Item[],
  range: AnalyticsRange,
  today = new Date(),
): DailyActivity[] {
  const days = Array.from({ length: range }, (_, index): DailyActivity => {
    const date = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() - range + index + 1,
      12,
    );
    return { key: localDateKey(date), date, added: 0, done: 0 };
  });
  const byDate = new Map(days.map((day) => [day.key, day]));

  for (const item of items) {
    // Empty-project prompts represent a decision, not added or completed work.
    if (item.isPlaceholder) continue;
    const addedDay = byDate.get(localDateKey(new Date(item.createdAt)));
    if (addedDay) addedDay.added += 1;
    if (item.completedAt) {
      const doneDay = byDate.get(localDateKey(new Date(item.completedAt)));
      if (doneDay) doneDay.done += 1;
    }
  }

  return days;
}
