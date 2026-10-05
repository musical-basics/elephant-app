export type CountdownStatus = "ready" | "running" | "paused";

export interface CountdownState {
  version: 1;
  itemId: string;
  scope: string;
  durationSeconds: number;
  status: CountdownStatus;
  remainingMs: number;
  deadline: number | null;
}

function validDuration(seconds: number): boolean {
  return Number.isInteger(seconds) && seconds >= 1 && seconds <= 86_400;
}

export function createCountdown(
  itemId: string,
  scope: string,
  seconds: number,
  running: boolean,
  now: number,
): CountdownState {
  if (!validDuration(seconds))
    throw new Error("Choose a timer from 1 second to 24 hours.");
  return {
    version: 1,
    itemId,
    scope,
    durationSeconds: seconds,
    status: running ? "running" : "ready",
    remainingMs: seconds * 1000,
    deadline: running ? now + seconds * 1000 : null,
  };
}

export function remainingMilliseconds(
  timer: CountdownState,
  now: number,
): number {
  return timer.status === "running"
    ? Math.min(timer.remainingMs, timer.deadline! - now)
    : timer.remainingMs;
}

export function elapsedSeconds(timer: CountdownState, now: number): number {
  return Math.floor(
    (timer.durationSeconds * 1000 - remainingMilliseconds(timer, now)) / 1000,
  );
}

export function pauseCountdown(
  timer: CountdownState,
  now: number,
): CountdownState {
  if (timer.status !== "running") return timer;
  const remainingMs = remainingMilliseconds(timer, now);
  return { ...timer, status: "paused", remainingMs, deadline: null };
}

export function resumeCountdown(
  timer: CountdownState,
  now: number,
): CountdownState {
  return timer.status === "paused"
    ? { ...timer, status: "running", deadline: now + timer.remainingMs }
    : timer;
}

/** Accept only internally consistent timer records; workspace data is never used. */
export function validateCountdown(value: unknown): CountdownState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (
    data.version !== 1 ||
    typeof data.itemId !== "string" ||
    !data.itemId.trim() ||
    typeof data.scope !== "string" ||
    !data.scope ||
    typeof data.durationSeconds !== "number" ||
    !validDuration(data.durationSeconds) ||
    typeof data.remainingMs !== "number" ||
    !Number.isFinite(data.remainingMs) ||
    data.remainingMs < -Number.MAX_SAFE_INTEGER ||
    data.remainingMs > data.durationSeconds * 1000
  )
    return null;
  if (data.status === "running") {
    if (
      typeof data.deadline !== "number" ||
      !Number.isFinite(data.deadline) ||
      data.deadline <= 0 ||
      data.deadline > Number.MAX_SAFE_INTEGER
    )
      return null;
  } else {
    if (data.deadline !== null) return null;
    if (data.status === "ready") {
      if (data.remainingMs !== data.durationSeconds * 1000) return null;
    } else if (data.status === "finished") {
      // Older versions stopped at zero; their post-deadline time is unknown.
      if (data.remainingMs !== 0) return null;
    } else if (data.status !== "paused") return null;
  }
  return {
    version: 1,
    itemId: data.itemId,
    scope: data.scope,
    durationSeconds: data.durationSeconds,
    status: data.status === "finished" ? "paused" : data.status,
    remainingMs: data.remainingMs,
    deadline: data.deadline as number | null,
  };
}
