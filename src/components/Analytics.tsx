import { useEffect, useMemo, useState } from "react";
import { Check, Plus } from "lucide-react";
import { getDailyActivity, type AnalyticsRange } from "../lib/analytics";
import type { Item } from "../lib/model";
import "./Analytics.css";

const shortDate = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});
const fullDate = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});
const chartDate = new Intl.DateTimeFormat(undefined, {
  month: "numeric",
  day: "numeric",
});
const weekday = new Intl.DateTimeFormat(undefined, { weekday: "narrow" });

export default function Analytics({ items }: { items: Item[] }) {
  const [range, setRange] = useState<AnalyticsRange>(7);
  const [today, setToday] = useState(() => new Date());

  useEffect(() => {
    const refreshDay = () => setToday(new Date());
    const interval = window.setInterval(refreshDay, 60_000);
    window.addEventListener("focus", refreshDay);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshDay);
    };
  }, []);

  const days = useMemo(
    () => getDailyActivity(items, range, today),
    [items, range, today],
  );
  const totalAdded = days.reduce((total, day) => total + day.added, 0);
  const totalDone = days.reduce((total, day) => total + day.done, 0);
  const maximum = Math.max(1, ...days.flatMap((day) => [day.added, day.done]));

  return (
    <section className="analytics" aria-label="Task activity">
      <div className="analytics-period">
        <div className="analytics-ranges" role="group" aria-label="Date range">
          {([7, 30, 90] as const).map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={range === value}
              onClick={() => setRange(value)}
            >
              {value} days
            </button>
          ))}
        </div>
        <p>
          {shortDate.format(days[0].date)} –{" "}
          {shortDate.format(days.at(-1)!.date)}
          <span> · Including today</span>
        </p>
      </div>

      <div className="analytics-totals" aria-live="polite" aria-atomic="true">
        <div className="analytics-total">
          <span>
            <Check size={17} aria-hidden="true" /> Tasks done
          </span>
          <strong>{totalDone.toLocaleString()}</strong>
          <small>in the last {range} days</small>
        </div>
        <div className="analytics-total">
          <span>
            <Plus size={17} aria-hidden="true" /> Tasks added
          </span>
          <strong>{totalAdded.toLocaleString()}</strong>
          <small>in the last {range} days</small>
        </div>
      </div>

      <div className="analytics-chart-card">
        <h2>Day by day</h2>
        <div className="analytics-legend" aria-hidden="true">
          <span>
            <i className="analytics-done" /> Done
          </span>
          <span>
            <i className="analytics-added" /> Added
          </span>
        </div>
        <p className="analytics-chart-note">
          {totalAdded === 0 && totalDone === 0
            ? "No task activity in this period yet."
            : "Compare what you finished with what you added."}
        </p>
        {range > 7 && (
          <p className="analytics-scroll-hint">
            Swipe or scroll to see every day →
          </p>
        )}
        <div
          className="analytics-chart-scroll"
          tabIndex={range > 7 ? 0 : undefined}
          role="region"
          aria-label="Daily activity chart. Exact values are available in View daily totals below."
        >
          <div
            className="analytics-chart"
            role="img"
            aria-label={`Tasks done versus tasks added per day over the last ${range} days. ${totalDone} done and ${totalAdded} added.`}
            style={{
              gridTemplateColumns: `repeat(${range}, minmax(0, 1fr))`,
              minWidth: range > 7 ? `${range * 42}px` : undefined,
            }}
          >
            {days.map((day, index) => (
              <div className="analytics-day" key={day.key} aria-hidden="true">
                <div className="analytics-bars">
                  <div
                    className="analytics-bar analytics-done"
                    style={{
                      height: day.done
                        ? `${(day.done / maximum) * 100}%`
                        : "2px",
                    }}
                    title={`${fullDate.format(day.date)}: ${day.done} done`}
                  >
                    <span>{day.done || ""}</span>
                  </div>
                  <div
                    className="analytics-bar analytics-added"
                    style={{
                      height: day.added
                        ? `${(day.added / maximum) * 100}%`
                        : "2px",
                    }}
                    title={`${fullDate.format(day.date)}: ${day.added} added`}
                  >
                    <span>{day.added || ""}</span>
                  </div>
                </div>
                <div className="analytics-day-label">
                  <span>{weekday.format(day.date)}</span>
                  <time dateTime={day.key}>{chartDate.format(day.date)}</time>
                  {index === days.length - 1 && <small>Today</small>}
                </div>
              </div>
            ))}
          </div>
        </div>
        <details className="analytics-daily-details">
          <summary>View daily totals</summary>
          <table>
            <caption>Tasks done and added each day, most recent first</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Done</th>
                <th scope="col">Added</th>
              </tr>
            </thead>
            <tbody>
              {[...days].reverse().map((day) => (
                <tr key={day.key}>
                  <th scope="row">
                    <time dateTime={day.key}>{fullDate.format(day.date)}</time>
                  </th>
                  <td>{day.done.toLocaleString()}</td>
                  <td>{day.added.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
      <p className="analytics-data-note">
        Based on items currently in your workspace. Dates use your local time.
      </p>
    </section>
  );
}
