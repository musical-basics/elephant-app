import { describe, expect, it } from 'vitest';
import { formatCountdown, inferDurationSeconds, MAX_TIMER_SECONDS } from './duration';

describe('duration inference', () => {
  it.each([
    ['5 minutes cleaning', 300],
    ['5-minute clean', 300],
    ['5 min', 300],
    ['5min', 300],
    ['Walk for 10m', 600],
    ['30 seconds of stretching', 30],
    ['Hold for 30sec', 30],
    ['Do a 1-hr tidy', 3600],
    ['Practice (15 MINS)', 900],
    ['Rest for .5 hours', 1800],
    ['A 0.1-minute pause', 6],
    ['Cleaning: 5 minutes', 300],
    ['Cleaning — 5 minutes', 300],
  ])('parses an explicit duration in %s', (title, seconds) => {
    expect(inferDurationSeconds(title)).toBe(seconds);
  });

  it.each([
    ['1 hour 30 minutes', 5400],
    ['1h 30m', 5400],
    ['1h30m', 5400],
    ['1 hr, 30 min and 15 sec', 5415],
    ['1 hour, and 30 minutes', 5400],
    ['2m 5s', 125],
    ['1h 0m 0s', 3600],
    ['0.01min 0.4sec', 1],
  ])('sums the contiguous compound duration in %s', (title, seconds) => {
    expect(inferDurationSeconds(title)).toBe(seconds);
  });

  it('uses the first phrase rather than adding durations from unrelated tasks', () => {
    expect(inferDurationSeconds('5 minutes cleaning then 10 minutes reading')).toBe(300);
    expect(inferDurationSeconds('Walk 10m and stretch 30s')).toBe(600);
    expect(inferDurationSeconds('1h 30m writing, then 5m break')).toBe(5400);
    expect(inferDurationSeconds('5 min, 10 min')).toBe(300);
  });

  it('distinguishes task-label punctuation from numeric separators and signs', () => {
    expect(inferDurationSeconds('Practice: 1h 30m')).toBe(5400);
    expect(inferDurationSeconds('Cleaning:5 minutes')).toBe(300);
    expect(inferDurationSeconds('Cleaning — -5 minutes')).toBeNull();
    for (const title of ['12:30 minutes', '12: 30 minutes', '12 : 30 minutes', '1/5 minutes', '1 / 5 minutes', '5 — 10 minutes', '— 5 minutes']) {
      expect(inferDurationSeconds(title)).toBeNull();
    }
  });

  it.each([
    '', 'Clean 5 things', 'Buy 30 items', 'Meet on 2026-10-05', 'Invoice 12/30',
    '-5 minutes', '- 5min', '−5min', '− 1h 30m', '5-10 minutes', '5–10 minutes',
    '2026-10-05m', '1/2 hour', '10:30m', '1,000 minutes', '2..5min',
    '1e3 minutes', '0 minutes', '0h0m0s', '0.1 second', '0.001 minute',
    '0.3333333333333333 min', '24h 1s', '25 hours', '86401 seconds',
    'abc5min', 'item_5min', '5minimum', '5 minuteslater', '5min123', '5minute_name',
  ])('does not infer from invalid or non-duration text: %s', (title) => {
    expect(inferDurationSeconds(title)).toBeNull();
  });

  it('accepts only whole seconds within the inclusive one-day limit', () => {
    expect(MAX_TIMER_SECONDS).toBe(86_400);
    expect(inferDurationSeconds('1 second')).toBe(1);
    expect(inferDurationSeconds('24 hours')).toBe(MAX_TIMER_SECONDS);
    expect(inferDurationSeconds('1440 min')).toBe(MAX_TIMER_SECONDS);
    expect(inferDurationSeconds('23h59m59s')).toBe(MAX_TIMER_SECONDS - 1);
    expect(inferDurationSeconds('1.5 seconds')).toBeNull();
  });

  it('skips invalid phrases before a later valid explicit duration', () => {
    expect(inferDurationSeconds('0 minutes skipped; clean for 5 minutes')).toBe(300);
    expect(inferDurationSeconds('25 hours cancelled; stretch 30 seconds')).toBe(30);
    expect(inferDurationSeconds('-1h 30m invalid; try 10m')).toBe(600);
  });
});

describe('countdown formatting', () => {
  it.each([
    [0, '00:00'], [1, '00:01'], [59, '00:59'], [60, '01:00'], [300, '05:00'],
    [3599, '59:59'], [3600, '1:00:00'], [3661, '1:01:01'], [86399, '23:59:59'],
    [86400, '24:00:00'],
  ])('formats %s seconds as %s', (seconds, expected) => {
    expect(formatCountdown(seconds)).toBe(expected);
  });

  it('rounds partial seconds up before formatting', () => {
    expect(formatCountdown(0.001)).toBe('00:01');
    expect(formatCountdown(59.01)).toBe('01:00');
    expect(formatCountdown(3599.9)).toBe('1:00:00');
  });

  it('clamps negative, excessive, and nonfinite values safely', () => {
    expect(formatCountdown(-1)).toBe('00:00');
    expect(formatCountdown(-0.5)).toBe('00:00');
    expect(formatCountdown(-Infinity)).toBe('00:00');
    expect(formatCountdown(NaN)).toBe('00:00');
    expect(formatCountdown(86400.5)).toBe('24:00:00');
    expect(formatCountdown(Infinity)).toBe('24:00:00');
  });
});
