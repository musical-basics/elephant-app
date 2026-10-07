export interface PianoLesson {
  source: "piano-studio";
  id: string;
  title: string;
  scheduledAt: string;
  endsAt: string;
  durationMinutes: number;
  status: "scheduled" | "completed";
}

export interface PianoLessonFeed {
  connected: boolean;
  lessons: PianoLesson[];
  fetchedAt: string;
}

export const PIANO_STUDIO_URL = "https://lessons.musicalbasics.com/admin";
