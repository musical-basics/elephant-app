import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Pause, Play, RotateCcw, Timer, X } from "lucide-react";
import {
  formatCountdown,
  inferDurationSeconds,
  MAX_TIMER_SECONDS,
} from "../lib/duration";
import type { useCountdown } from "../lib/useCountdown";
import "./FocusTimer.css";

type Props = {
  title: string;
  countdown: ReturnType<typeof useCountdown>;
};

export default function FocusTimer({ title, countdown }: Props) {
  const { timer, remainingSeconds, open, start, pause, resume, reset, remove } =
    countdown;
  const suggested = inferDurationSeconds(title);
  const duration = timer?.durationSeconds ?? suggested ?? 300;
  const [minutes, setMinutes] = useState(String(Math.floor(duration / 60)));
  const [seconds, setSeconds] = useState(String(duration % 60));
  const [error, setError] = useState("");

  useEffect(() => {
    setMinutes(String(Math.floor(duration / 60)));
    setSeconds(String(duration % 60));
    setError("");
  }, [duration, timer?.status]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const mins = Number(minutes);
    const secs = Number(seconds);
    const total = mins * 60 + secs;
    if (
      !minutes.trim() ||
      !seconds.trim() ||
      !Number.isInteger(mins) ||
      !Number.isInteger(secs) ||
      mins < 0 ||
      secs < 0 ||
      secs > 59 ||
      total < 1 ||
      total > MAX_TIMER_SECONDS
    ) {
      setError(
        "Choose a time from 1 second to 24 hours. Use whole minutes and 0–59 seconds.",
      );
      return;
    }
    setError("");
    start(total);
  }

  if (!timer) {
    return (
      <div className="focus-timer-invite">
        <button
          type="button"
          className="secondary-button"
          onClick={() => open(suggested ?? 300)}
        >
          <Timer size={17} />
          Add timer
        </button>
      </div>
    );
  }

  const overtime = timer.status !== "ready" && remainingSeconds <= 0;
  return (
    <section
      className={`focus-timer${overtime ? " timer-overtime" : ""}`}
      aria-label="Task countdown"
    >
      <div className="timer-heading">
        <h2>
          <Timer size={17} /> Optional timer
        </h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Remove timer"
          title="Remove timer"
          onClick={remove}
        >
          <X size={17} />
        </button>
      </div>
      {timer.status === "ready" ? (
        <form className="timer-form" onSubmit={submit} noValidate>
          <div className="timer-duration-fields">
            <label>
              Minutes
              <input
                aria-label="Timer minutes"
                type="number"
                inputMode="numeric"
                min="0"
                max="1440"
                step="1"
                required
                value={minutes}
                onChange={(event) => setMinutes(event.target.value)}
              />
            </label>
            <span aria-hidden="true">:</span>
            <label>
              Seconds
              <input
                aria-label="Timer seconds"
                type="number"
                inputMode="numeric"
                min="0"
                max="59"
                step="1"
                required
                value={seconds}
                onChange={(event) => setSeconds(event.target.value)}
              />
            </label>
          </div>
          <p className="timer-hint">
            {suggested === duration
              ? "Time from your task. Adjust it if you like."
              : "Choose a little time to focus."}
          </p>
          {error && (
            <p className="timer-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="primary-button">
            <Play size={16} /> Start timer
          </button>
        </form>
      ) : (
        <>
          <div className="timer-readout">
            <span
              role="timer"
              aria-label={overtime ? "Time over" : "Time remaining"}
              aria-live="off"
            >
              {formatCountdown(remainingSeconds)}
            </span>
            <span className="timer-state">
              {timer.status === "paused"
                ? overtime
                  ? "Overtime · Paused"
                  : "Paused"
                : overtime
                  ? "Overtime"
                  : "Counting down"}
            </span>
          </div>
          <div className="timer-track" aria-hidden="true">
            <span
              style={{
                width: `${Math.min(100, Math.max(0, (remainingSeconds / duration) * 100))}%`,
              }}
            />
          </div>
          <div className="timer-controls">
            {timer.status === "running" ? (
              <button
                type="button"
                className="primary-button"
                aria-label="Pause timer"
                onClick={pause}
              >
                <Pause size={16} /> Pause
              </button>
            ) : (
              <button
                type="button"
                className="primary-button"
                aria-label="Resume timer"
                onClick={resume}
              >
                <Play size={16} /> Resume
              </button>
            )}
            <button
              type="button"
              className="secondary-button"
              aria-label="Reset timer"
              onClick={reset}
            >
              <RotateCcw size={16} /> Reset
            </button>
          </div>
        </>
      )}
      <p className="timer-completion" role="status">
        {overtime ? "Time’s up. The timer keeps track of your extra time." : ""}
      </p>
    </section>
  );
}
