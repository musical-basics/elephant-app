import type { AppState } from "./model";
import { localDateKey } from "./schedule.js";

export const MAX_DIARY_LENGTH = 20_000;
export interface DiaryEntry {
  id: string;
  text: string;
  /** When the note was written; adjustable for notes recorded after the fact. */
  writtenAt: string;
  createdAt: string;
  updatedAt?: string;
}
export type DiaryDraft = Pick<DiaryEntry, "text" | "writtenAt">;

export function saveDiaryEntry(
  state: AppState,
  draft: DiaryDraft,
  entryId?: string,
): AppState {
  const text = draft.text.trim();
  const time = Date.parse(draft.writtenAt);
  const year = new Date(time).getUTCFullYear();
  if (!text) throw new Error("Write a few words before saving.");
  if (text.length > MAX_DIARY_LENGTH)
    throw new Error(
      `Keep each entry under ${MAX_DIARY_LENGTH.toLocaleString()} characters.`,
    );
  if (!Number.isFinite(time) || year < 1 || year > 9999)
    throw new Error("Choose a valid date and time.");
  const entries = state.diary ?? [];
  const existing = entries.find((entry) => entry.id === entryId);
  if (entryId && !existing)
    throw new Error("This entry was removed. Reopen the diary to continue.");
  const writtenAt = new Date(time).toISOString();
  if (existing?.text === text && existing.writtenAt === writtenAt) return state;
  const now = new Date().toISOString();
  const entry: DiaryEntry = existing
    ? { ...existing, text, writtenAt, updatedAt: now }
    : { id: crypto.randomUUID(), text, writtenAt, createdAt: now };
  return {
    ...state,
    diary: existing
      ? entries.map((value) => (value.id === entryId ? entry : value))
      : [...entries, entry],
  };
}

export function removeDiaryEntry(state: AppState, id: string): AppState {
  return {
    ...state,
    diary: (state.diary ?? []).filter((entry) => entry.id !== id),
  };
}

/** Newest first; ties keep a stable order. */
export function sortDiary(entries: DiaryEntry[]): DiaryEntry[] {
  return [...entries].sort(
    (a, b) =>
      Date.parse(b.writtenAt) - Date.parse(a.writtenAt) ||
      b.id.localeCompare(a.id),
  );
}

/** Group by the viewer's local date, preserving the given order. */
export function groupDiaryByDay(
  entries: DiaryEntry[],
): { day: string; entries: DiaryEntry[] }[] {
  const groups = new Map<string, DiaryEntry[]>();
  for (const entry of entries) {
    const day = localDateKey(new Date(entry.writtenAt));
    groups.set(day, [...(groups.get(day) ?? []), entry]);
  }
  return [...groups].map(([day, entries]) => ({ day, entries }));
}

export function searchDiary(
  entries: DiaryEntry[],
  query: string,
): DiaryEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return words.length
    ? entries.filter((entry) => {
        const text = entry.text.toLowerCase();
        return words.every((word) => text.includes(word));
      })
    : entries;
}
