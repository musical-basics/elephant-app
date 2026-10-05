import { describe, expect, it } from 'vitest';
import {
  createCountdown, pauseCountdown, remainingMilliseconds, resumeCountdown,
  settleCountdown, validateCountdown,
} from './countdown';

describe('optional countdown timing', () => {
  it('uses wall-clock deadlines across long background gaps', () => {
    const running = createCountdown('step-1', 'local', 300, true, 1000);
    expect(remainingMilliseconds(running, 121_000)).toBe(180_000);
    const finished = settleCountdown(running, 500_000);
    expect(finished.status).toBe('finished');
    expect(finished.remainingMs).toBe(0);
    expect(finished.deadline).toBeNull();
    expect(running.status).toBe('running');
  });

  it('preserves fractional seconds through pauses and resumes', () => {
    const running = createCountdown('step-1', 'local', 5, true, 1000);
    const paused = pauseCountdown(running, 2250);
    expect(paused.remainingMs).toBe(3750);
    expect(remainingMilliseconds(paused, 50_000)).toBe(3750);
    const resumed = resumeCountdown(paused, 50_000);
    expect(resumed.deadline).toBe(53_750);
    expect(remainingMilliseconds(resumed, 53_749)).toBe(1);
    expect(settleCountdown(resumed, 53_750).status).toBe('finished');
  });

  it('finishes when pause arrives after the deadline and cannot resume a finished timer', () => {
    const running = createCountdown('step-1', 'local', 1, true, 1000);
    const finished = pauseCountdown(running, 3000);
    expect(finished.status).toBe('finished');
    expect(resumeCountdown(finished, 5000)).toBe(finished);
  });

  it('ready timers do not elapse before Start', () => {
    const ready = createCountdown('step-1', 'local', 300, false, 1000);
    expect(remainingMilliseconds(ready, 1_000_000)).toBe(300_000);
    expect(settleCountdown(ready, 1_000_000)).toBe(ready);
  });

  it('accepts saved fractional remaining time and rejects inconsistent persisted records', () => {
    const paused = pauseCountdown(createCountdown('step-1', 'cloud:test', 3, true, 1000), 2123);
    expect(validateCountdown(JSON.parse(JSON.stringify(paused)))).toEqual(paused);
    for (const invalid of [
      null, [], {}, { ...paused, version: 2 }, { ...paused, itemId: '' },
      { ...paused, durationSeconds: 86_401 }, { ...paused, remainingMs: NaN },
      { ...paused, remainingMs: 3001 }, { ...paused, remainingMs: -1 },
      { ...paused, status: 'running', deadline: null },
      { ...paused, status: 'running', deadline: Infinity },
      { ...paused, status: 'finished' }, { ...paused, status: 'ready' },
      { ...paused, deadline: 12345 }, { ...paused, status: 'unknown' },
    ]) expect(validateCountdown(invalid)).toBeNull();
  });

  it('enforces a duration from one second through 24 hours', () => {
    for (const duration of [0, -1, 1.5, 86_401, NaN, Infinity]) {
      expect(() => createCountdown('step-1', 'local', duration, false, 1000)).toThrow();
    }
    expect(createCountdown('step-1', 'local', 1, false, 1000).remainingMs).toBe(1000);
    expect(createCountdown('step-1', 'local', 86_400, false, 1000).remainingMs).toBe(86_400_000);
  });
});
