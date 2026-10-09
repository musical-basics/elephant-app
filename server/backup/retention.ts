import { randomBytes } from "node:crypto";

const DAY_MS = 86_400_000;
const pad = (value: number, width = 2) => String(value).padStart(width, "0");

export type Archive = { name: string; at: Date; partial: boolean };

/** Milliseconds and a random run ID keep simultaneous runs in separate folders. */
export function archiveName(
  at: Date,
  partial = false,
  runId = randomBytes(4).toString("hex"),
): string {
  const year = at.getUTCFullYear();
  if (!Number.isFinite(at.getTime()) || year < 0 || year > 9999) {
    throw new RangeError(
      "Backup timestamp must have a valid four-digit UTC year",
    );
  }
  if (!/^[a-f0-9]{8}$/i.test(runId)) {
    throw new Error(
      "Backup run ID must contain exactly eight hexadecimal characters",
    );
  }
  const stamp = `${pad(year, 4)}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}-${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}${pad(at.getUTCMilliseconds(), 3)}`;
  return `elephant-${stamp}-${runId.toLowerCase()}${partial ? "-PARTIAL" : ""}`;
}

/** Unknown names and impossible dates must never become deletion candidates. */
export function parseArchiveName(name: string): Archive | null {
  const match = name.match(
    /^elephant-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})(\d{3})-([a-f0-9]{8})(-PARTIAL)?$/,
  );
  if (!match) return null;
  const [, year, month, day, hour, minute, second, ms, runId, suffix] = match;
  // setUTCFullYear avoids Date.UTC's special handling of years 00 through 99.
  const at = new Date(0);
  at.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  at.setUTCHours(Number(hour), Number(minute), Number(second), Number(ms));
  const partial = Boolean(suffix);
  if (
    !Number.isFinite(at.getTime()) ||
    at.getUTCFullYear() < 0 ||
    at.getUTCFullYear() > 9999
  )
    return null;
  if (archiveName(at, partial, runId) !== name) return null;
  return { name, at, partial };
}

/** ISO weeks start Monday; the Thursday determines the ISO week-year. */
function weekKey(at: Date): string {
  const thursday = new Date(at);
  thursday.setUTCHours(0, 0, 0, 0);
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const yearStart = new Date(thursday);
  yearStart.setUTCMonth(0, 1);
  const week = Math.ceil(
    ((thursday.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7,
  );
  return `${thursday.getUTCFullYear()}-W${pad(week)}`;
}

function bucketOf(at: Date, now: Date): string {
  const ageDays = (now.getTime() - at.getTime()) / DAY_MS;
  const month = `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}`;
  if (ageDays < 7) return `day:${month}-${pad(at.getUTCDate())}`;
  if (ageDays < 35) return `week:${weekKey(at)}`;
  if (ageDays < 400) return `month:${month}`;
  return `year:${at.getUTCFullYear()}`;
}

function preferred(candidate: Archive, current: Archive): boolean {
  if (candidate.partial !== current.partial) return !candidate.partial;
  if (candidate.at.getTime() !== current.at.getTime()) {
    return candidate.at.getTime() > current.at.getTime();
  }
  // Stable tie-breaking when two runs started during the same millisecond.
  return candidate.name > current.name;
}

/**
 * GFS retention: daily <7 days, weekly <35, monthly <400, yearly forever.
 * The caller must supply only archives with a successfully written manifest:
 * an unfinished upload must never displace a usable backup. A complete backup
 * beats a partial one in its bucket, then the newest timestamp wins.
 * Foreign and future-dated folders are returned separately and left untouched.
 */
export function planRetention(
  names: string[],
  now: Date,
): { keep: string[]; remove: string[]; foreign: string[] } {
  if (!Number.isFinite(now.getTime()))
    throw new RangeError("Invalid retention timestamp");
  const archives: Archive[] = [];
  const foreign: string[] = [];
  const winners = new Map<string, Archive>();
  for (const name of new Set(names)) {
    const parsed = parseArchiveName(name);
    if (!parsed || parsed.at.getTime() > now.getTime()) {
      foreign.push(name);
      continue;
    }
    archives.push(parsed);
    const bucket = bucketOf(parsed.at, now);
    const current = winners.get(bucket);
    if (!current || preferred(parsed, current)) winners.set(bucket, parsed);
  }
  const selected = new Set(
    [...winners.values()].map((archive) => archive.name),
  );
  return {
    keep: archives
      .filter((archive) => selected.has(archive.name))
      .map((archive) => archive.name),
    remove: archives
      .filter((archive) => !selected.has(archive.name))
      .map((archive) => archive.name),
    foreign,
  };
}
