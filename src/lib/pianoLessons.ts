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

export interface LessonCompletion {
  lesson: PianoLesson;
  alreadyCompleted: boolean;
  creditDeducted?: boolean;
  previousCredits?: number | null;
  newCredits?: number | null;
  nextLessonDate?: string | null;
}

export const PIANO_STUDIO_URL = "https://lessons.musicalbasics.com/admin";
