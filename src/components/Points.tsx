import { useState } from "react";
import { Check, Star } from "lucide-react";
import {
  checkItemPoints,
  describePoints,
  earnedPoints,
  formatPoints,
  MAX_POINTS_QUANTITY,
  MAX_POINTS_VALUE,
  MAX_WEEKLY_TARGET,
  MIN_WEEKLY_TARGET,
  WEEKDAY_NAMES,
} from "../lib/points";
import type { ItemPoints, PointsKind, PointsSummary } from "../lib/points";
import "./Points.css";

const pointsLabel = (value: number) =>
  `${formatPoints(value)} ${value === 1 ? "point" : "points"}`;

const KINDS: { kind: PointsKind | "none"; label: string; hint: string }[] = [
  { kind: "none", label: "No points", hint: "Not scored" },
  { kind: "fixed", label: "General", hint: "Whole item" },
  { kind: "perMinute", label: "Time-based", hint: "Per minute" },
  { kind: "perUnit", label: "Quantity", hint: "Per unit" },
];

/** Reads the fields below from a submitted form; throws a readable message. */
export function readPointsFields(fields: FormData): ItemPoints | null {
  const kind = String(fields.get("pointsKind") || "none");
  if (kind === "none") return null;
  const raw = String(fields.get("pointsValue") ?? "").trim();
  return checkItemPoints({
    kind: kind as PointsKind,
    value: raw === "" ? NaN : Number(raw),
  });
}

/** Points settings for the add and edit item sheets. */
export function PointsFields({ points }: { points?: ItemPoints }) {
  const [kind, setKind] = useState<PointsKind | "none">(points?.kind ?? "none");
  return (
    <fieldset className="points-fields">
      <legend>Points</legend>
      <div className="points-kinds">
        {KINDS.map((option) => (
          <label
            key={option.kind}
            className={kind === option.kind ? "is-selected" : ""}
          >
            <input
              type="radio"
              name="pointsKind"
              value={option.kind}
              checked={kind === option.kind}
              onChange={() => setKind(option.kind)}
            />
            <strong>{option.label}</strong>
            <span>{option.hint}</span>
          </label>
        ))}
      </div>
      {kind !== "none" && (
        <label className="points-value">
          {kind === "fixed"
            ? "Points for the whole item"
            : kind === "perMinute"
              ? "Points per minute"
              : "Points per unit"}
          <input
            name="pointsValue"
            type="number"
            inputMode="decimal"
            step="any"
            min="0.01"
            max={MAX_POINTS_VALUE}
            defaultValue={points?.value ?? ""}
            placeholder={kind === "perMinute" ? "1" : "5"}
            required
          />
          <small>
            {kind === "fixed"
              ? "Earned when you complete it. Decimals are fine."
              : kind === "perMinute"
                ? "You’ll enter the minutes when you complete it. A running timer fills them in."
                : "You’ll enter how many when you complete it, like 5 emails."}
          </small>
        </label>
      )}
    </fieldset>
  );
}

function Meter({
  label,
  value,
  target,
  marker,
}: {
  label: string;
  value: number;
  target: number | null;
  marker?: number;
}) {
  return (
    <div className="points-meter">
      <span className="points-meter-label">{label}</span>
      <strong>
        {formatPoints(value)}
        {target !== null && <small> / {formatPoints(target)}</small>}
      </strong>
      {target !== null && (
        <span className="points-track" aria-hidden="true">
          <span
            style={{ width: `${Math.min(100, (value / target) * 100)}%` }}
          />
          {marker !== undefined && marker > 0 && marker < 1 && (
            <i style={{ left: `${marker * 100}%` }} />
          )}
        </span>
      )}
    </div>
  );
}

/** Today's and this week's points against the goal, and whether you're on schedule. */
export function PointsBoard({
  summary,
  compact = false,
  onSetGoal,
}: {
  summary: PointsSummary;
  compact?: boolean;
  onSetGoal: () => void;
}) {
  const { pace, neededToday, weeklyTarget, dailyTarget, dayOfWeek } = summary;
  const status =
    pace === null
      ? null
      : pace > 0
        ? `${formatPoints(pace)} ahead${compact ? "" : " of schedule"}`
        : pace < 0
          ? `${formatPoints(-pace)} behind${compact ? "" : " schedule"}`
          : "On schedule";
  return (
    <section
      className={`points-board${compact ? " is-compact" : ""}`}
      aria-label="Points"
    >
      <div className="points-board-heading">
        <span className="points-icon" aria-hidden="true">
          <Star size={compact ? 15 : 18} />
        </span>
        <p className="eyebrow">POINTS</p>
      </div>
      {status && (
        <span
          className="points-status"
          data-pace={pace! > 0 ? "ahead" : pace! < 0 ? "behind" : "even"}
        >
          {status}
        </span>
      )}
      <div className="points-meters">
        <Meter label="Today" value={summary.today} target={dailyTarget} />
        <Meter
          label="This week"
          value={summary.week}
          target={weeklyTarget}
          marker={dayOfWeek / 7}
        />
      </div>
      {weeklyTarget === null ? (
        <p className="points-note">
          Set a weekly goal to see your daily share.{" "}
          <button type="button" className="text-button" onClick={onSetGoal}>
            Set a weekly goal
          </button>
        </p>
      ) : (
        !compact && (
          <p className="points-note">
            {neededToday! > 0
              ? `${formatPoints(neededToday!)} more today keeps you on schedule.`
              : "Today’s share is done. Anything more is extra."}
            {summary.lastWeek &&
              ` Last week: ${formatPoints(summary.lastWeek.earned)} of ${formatPoints(summary.lastWeek.target)}.`}
          </p>
        )
      )}
    </section>
  );
}

/** What completing an item earns; rate-based items ask for the minutes or units. */
export function PointsAmountField({
  points,
  value,
  autoFocus,
  onChange,
  onSubmit,
}: {
  points: ItemPoints;
  value: string;
  autoFocus: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  if (points.kind === "fixed")
    return (
      <p className="points-amount-preview">Earns {pointsLabel(points.value)}</p>
    );
  let preview: number | null = null;
  try {
    if (value.trim()) preview = earnedPoints(points, Number(value));
  } catch {
    preview = null;
  }
  return (
    <form
      className="sheet-form points-amount"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label>
        {points.kind === "perMinute"
          ? "Minutes worked"
          : "How many did you complete?"}
        <input
          name="pointsQuantity"
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          max={MAX_POINTS_QUANTITY}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoFocus={autoFocus}
          required
        />
        <small>{describePoints(points)}</small>
      </label>
      <p className="points-amount-preview" aria-live="polite">
        {preview === null
          ? "Enter an amount to see your points."
          : `Earns ${pointsLabel(preview)}`}
      </p>
    </form>
  );
}

/** Settings → Points: the weekly goal and the day each points week begins. */
export function PointsSettings({
  summary,
  weekStartsOn,
  onSaveGoal,
  onWeekStart,
}: {
  summary: PointsSummary;
  weekStartsOn: number;
  onSaveGoal: (target: number) => void;
  onWeekStart: (weekday: number) => void;
}) {
  const [error, setError] = useState("");
  const attempt = (action: () => void) => {
    try {
      action();
      setError("");
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Please check the goal.",
      );
    }
  };
  return (
    <section className="settings-section points-settings">
      <h2>
        <Star size={19} />
        Points
      </h2>
      <form
        className="points-goal-form"
        onSubmit={(event) => {
          event.preventDefault();
          const raw = String(
            new FormData(event.currentTarget).get("weeklyTarget"),
          ).trim();
          attempt(() => onSaveGoal(raw ? Number(raw) : NaN));
        }}
      >
        <label>
          Weekly goal
          <input
            name="weeklyTarget"
            type="number"
            inputMode="decimal"
            step="any"
            min={MIN_WEEKLY_TARGET}
            max={MAX_WEEKLY_TARGET}
            defaultValue={summary.weeklyTarget ?? ""}
            key={summary.weeklyTarget}
            placeholder="700"
            required
          />
        </label>
        <button className="secondary-button" type="submit">
          <Check size={16} />
          Save goal
        </button>
      </form>
      <p className="small muted points-settings-note">
        {summary.dailyTarget !== null &&
          `That’s ${pointsLabel(summary.dailyTarget)} a day. `}
        Each week, beat your goal and the next one rises by half the extra; fall
        short and it eases by twice the gap.
      </p>
      <label className="points-week-start">
        Week starts on
        <select
          value={weekStartsOn}
          onChange={(event) =>
            attempt(() => onWeekStart(Number(event.target.value)))
          }
        >
          {WEEKDAY_NAMES.map((name, day) => (
            <option key={name} value={day}>
              {name}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
