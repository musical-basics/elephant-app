import { describe, expect, it } from "vitest";
import {
  createCountdown,
  elapsedSeconds,
  pauseCountdown,
  remainingMilliseconds,
  resumeCountdown,
  validateCountdown,
} from "./countdown";

describe("optional countdown timing", () => {
  it("uses wall-clock deadlines across long background gaps and continues into overtime", () => {
    const running = createCountdown("step-1", "local", 300, true, 1000);
    expect(remainingMilliseconds(running, 121_000)).toBe(180_000);
    expect(remainingMilliseconds(running, 301_000)).toBe(0);
    expect(remainingMilliseconds(running, 302_000)).toBe(-1000);
    expect(remainingMilliseconds(running, 500_000)).toBe(-199_000);
    expect(elapsedSeconds(running, 500_000)).toBe(499);
    expect(running.status).toBe("running");
  });

  it("preserves fractional seconds through pauses and resumes, excluding paused time", () => {
    const running = createCountdown("step-1", "local", 5, true, 1000);
    const paused = pauseCountdown(running, 2250);
    expect(paused.remainingMs).toBe(3750);
    expect(remainingMilliseconds(paused, 50_000)).toBe(3750);
    expect(elapsedSeconds(paused, 50_000)).toBe(1);
    const resumed = resumeCountdown(paused, 50_000);
    expect(resumed.deadline).toBe(53_750);
    expect(remainingMilliseconds(resumed, 53_749)).toBe(1);
    expect(remainingMilliseconds(resumed, 53_750)).toBe(0);
    expect(elapsedSeconds(resumed, 54_750)).toBe(6);
  });

  it("pauses and resumes overtime without losing its negative value", () => {
    const running = createCountdown("step-1", "local", 1, true, 1000);
    const paused = pauseCountdown(running, 3250);
    expect(paused.status).toBe("paused");
    expect(paused.remainingMs).toBe(-1250);
    expect(elapsedSeconds(paused, 50_000)).toBe(2);
    const resumed = resumeCountdown(paused, 50_000);
    expect(resumed.deadline).toBe(48_750);
    expect(remainingMilliseconds(resumed, 50_750)).toBe(-2000);
    expect(elapsedSeconds(resumed, 50_750)).toBe(3);
  });

  it("captures a fresh elapsed time even before a display tick and freezes the snapshot", () => {
    const running = createCountdown("step-1", "local", 300, true, 1000);
    const paused = pauseCountdown(running, 331_123);
    expect(elapsedSeconds(paused, 331_123)).toBe(330);
    expect(elapsedSeconds(paused, 999_000)).toBe(330);
    const resumed = resumeCountdown(paused, 999_000);
    expect(elapsedSeconds(resumed, 1_000_000)).toBe(331);
  });

  it("ready timers do not elapse before Start", () => {
    const ready = createCountdown("step-1", "local", 300, false, 1000);
    expect(remainingMilliseconds(ready, 1_000_000)).toBe(300_000);
    expect(elapsedSeconds(ready, 1_000_000)).toBe(0);
    expect(pauseCountdown(ready, 1_000_000)).toBe(ready);
  });

  it("reloads fractional, zero, and negative remaining times", () => {
    const running = createCountdown("step-1", "cloud:test", 3, true, 1000);
    for (const at of [2123, 4000, 31_750, 100_000_000]) {
      const paused = pauseCountdown(running, at);
      expect(validateCountdown(JSON.parse(JSON.stringify(paused)))).toEqual(
        paused,
      );
      const resumed = resumeCountdown(paused, 200_000_000);
      expect(validateCountdown(JSON.parse(JSON.stringify(resumed)))).toEqual(
        resumed,
      );
    }
  });

  it("migrates an old finished timer to paused at zero without inventing overtime", () => {
    const running = createCountdown("step-1", "local", 300, true, 1000);
    const restored = validateCountdown({
      ...running,
      status: "finished",
      remainingMs: 0,
      deadline: null,
    });
    expect(restored).toEqual({
      ...running,
      status: "paused",
      remainingMs: 0,
      deadline: null,
    });
    expect(elapsedSeconds(restored!, 1_000_000)).toBe(300);
    expect(
      remainingMilliseconds(resumeCountdown(restored!, 1_000_000), 1_001_000),
    ).toBe(-1000);
  });

  it("rejects inconsistent persisted records", () => {
    const paused = pauseCountdown(
      createCountdown("step-1", "cloud:test", 3, true, 1000),
      2123,
    );
    for (const invalid of [
      null,
      [],
      {},
      { ...paused, version: 2 },
      { ...paused, itemId: "" },
      { ...paused, durationSeconds: 86_401 },
      { ...paused, remainingMs: NaN },
      { ...paused, remainingMs: 3001 },
      { ...paused, remainingMs: -Infinity },
      { ...paused, remainingMs: -Number.MAX_SAFE_INTEGER - 1 },
      { ...paused, status: "running", deadline: null },
      { ...paused, status: "running", deadline: Infinity },
      { ...paused, status: "finished" },
      { ...paused, status: "ready" },
      { ...paused, deadline: 12345 },
      { ...paused, status: "unknown" },
    ])
      expect(validateCountdown(invalid)).toBeNull();
  });

  it("enforces a duration from one second through 24 hours", () => {
    for (const duration of [0, -1, 1.5, 86_401, NaN, Infinity]) {
      expect(() =>
        createCountdown("step-1", "local", duration, false, 1000),
      ).toThrow();
    }
    expect(createCountdown("step-1", "local", 1, false, 1000).remainingMs).toBe(
      1000,
    );
    expect(
      createCountdown("step-1", "local", 86_400, false, 1000).remainingMs,
    ).toBe(86_400_000);
  });
});
