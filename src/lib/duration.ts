export const MAX_TIMER_SECONDS = 86_400;

type DurationPart = {
  amount: string;
  factor: number;
  start: number;
  end: number;
};

function wholeSeconds(parts: DurationPart[]): number | null {
  // Use decimal integers so values such as 0.1 minutes are exact, and a
  // fractional second cannot round into an apparently valid whole second.
  let total = 0n;
  let places = 0;
  for (const part of parts) {
    const [whole, fraction = ""] = part.amount.split(".");
    if (fraction.length > places) {
      total *= 10n ** BigInt(fraction.length - places);
      places = fraction.length;
    }
    total +=
      BigInt((whole || "0") + fraction) *
      BigInt(part.factor) *
      10n ** BigInt(places - fraction.length);
  }
  const denominator = 10n ** BigInt(places);
  if (
    total <= 0n ||
    total > BigInt(MAX_TIMER_SECONDS) * denominator ||
    total % denominator !== 0n
  )
    return null;
  return Number(total / denominator);
}

/** Return the first valid explicit duration phrase, never an unlabelled number. */
export function inferDurationSeconds(title: string): number | null {
  const token =
    /(\d+(?:\.\d+)?|\.\d+)\s*(?:-\s*)?(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)(?![\p{L}_])/giu;
  const parts: DurationPart[] = [...title.matchAll(token)].map((match) => ({
    amount: match[1],
    factor:
      match[2][0].toLowerCase() === "h"
        ? 3600
        : match[2][0].toLowerCase() === "m"
          ? 60
          : 1,
    start: match.index!,
    end: match.index! + match[0].length,
  }));

  for (let index = 0; index < parts.length; index++) {
    const first = parts[index];
    const phrase = [first];
    const units = new Set([first.factor]);
    let last = first;
    // Adjacent unlike units form one duration (including 1h30m). Repeated
    // units or intervening task text start another duration phrase.
    while (index + 1 < parts.length) {
      const next = parts[index + 1];
      const gap = title.slice(last.end, next.start);
      if (units.has(next.factor) || !/^\s*(?:,\s*)?(?:and\s+)?$/iu.test(gap))
        break;
      phrase.push(next);
      units.add(next.factor);
      last = next;
      index++;
    }
    const prefix = title.slice(0, first.start);
    const labelDash = /[\p{L}]\s+[\u2013\u2014]\s+$/u.test(prefix);
    const signedNumber =
      /[-+\u2212\u2013\u2014]\s*$/u.test(prefix) && !labelDash;
    // Exclude signed numbers, numeric ranges/dates, fractions, clock times,
    // malformed decimals, and numeric fragments embedded in identifiers.
    // A colon after a text label is ordinary punctuation, not a clock prefix.
    if (
      /[\p{L}\p{N}_.]$/u.test(prefix) ||
      signedNumber ||
      /(?:[/\\]|\d[.,]|\d\s*:)\s*$/u.test(prefix) ||
      /^[\p{L}\p{N}_]/u.test(title.slice(last.end))
    )
      continue;
    const seconds = wholeSeconds(phrase);
    if (seconds !== null) return seconds;
  }
  return null;
}

/** Display the countdown, followed by negative overtime after the deadline. */
export function formatCountdown(seconds: number): string {
  if (Number.isFinite(seconds) && seconds <= -1)
    return `-${formatElapsedTime(Math.abs(Math.ceil(seconds)))}`;
  const remaining = Math.min(
    MAX_TIMER_SECONDS,
    Math.max(0, Math.ceil(Number.isNaN(seconds) ? 0 : seconds)),
  );
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const rest = remaining % 60;
  const clock = `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  return hours ? `${hours}:${clock}` : clock;
}

/** Format whole active seconds for completion records without a one-day cap. */
export function formatElapsedTime(seconds: number): string {
  const elapsed = Number.isFinite(seconds)
    ? Math.max(0, Math.floor(seconds))
    : 0;
  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const rest = String(elapsed % 60).padStart(2, "0");
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}`
    : `${minutes}:${rest}`;
}
