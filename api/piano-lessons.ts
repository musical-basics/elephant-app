import { createClient } from "@supabase/supabase-js";
import {
  calendarLesson,
  studioTimestamp,
  validDate,
} from "../server/pianoLessons.js";
import type { StudioLessonRow } from "../server/pianoLessons.js";
import { hasLocalPianoAccess } from "../server/localPianoAccess.js";

const LESSON_FIELDS =
  "id,date,time,duration,status,student:profiles!lessons_student_id_fkey(name)";
const DEFAULT_STUDIO_APP_URL = "https://lessons.musicalbasics.com";
const MAX_NOTES_LENGTH = 10_000;

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      Vary: "Authorization, X-Piano-Key",
    },
  });
}

const clientOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  global: {
    fetch: (input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }),
  },
};

type Credentials = { token?: string; localAccess: boolean };

/** Checked before any other work, so unauthenticated requests do nothing. */
function credentials(request: Request): Credentials | Response {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer (\S+)$/i)?.[1];
  const localAccess = hasLocalPianoAccess(request);
  return token || localAccess
    ? { token, localAccess }
    : json(
        { error: "Open your private calendar link to connect piano lessons." },
        401,
      );
}

/**
 * The private link key or the verified owner account may use the studio.
 * Returns "owner", "other" for a valid non-owner account, or an error response.
 */
async function authorize({
  token,
  localAccess,
}: Credentials): Promise<"owner" | "other" | Response> {
  const authUrl = process.env.VITE_SUPABASE_URL;
  const authKey =
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;
  const ownerId = process.env.PIANO_STUDIO_OWNER_ID;
  if (
    !process.env.PIANO_STUDIO_SUPABASE_URL ||
    !process.env.PIANO_STUDIO_SERVICE_KEY ||
    (!localAccess && (!authUrl || !authKey || !ownerId))
  )
    return json(
      { error: "The piano studio connection is not configured." },
      503,
    );
  if (localAccess) return "owner";
  const auth = createClient(authUrl!, authKey!, clientOptions);
  // Validate with the issuing auth server; never trust a decoded JWT/user ID.
  const {
    data: { user },
    error,
  } = await auth.auth.getUser(token);
  if (error || !user)
    return json({ error: "Sign in again to view piano lessons." }, 401);
  return user.id === ownerId && user.email_confirmed_at ? "owner" : "other";
}

function studio() {
  return createClient(
    process.env.PIANO_STUDIO_SUPABASE_URL!,
    process.env.PIANO_STUDIO_SERVICE_KEY!,
    clientOptions,
  );
}

/** Read-only bridge. Studio credentials and account authorization stay server-side. */
export async function GET(request: Request): Promise<Response> {
  const supplied = credentials(request);
  if (supplied instanceof Response) return supplied;
  const url = new URL(request.url);
  const from = url.searchParams.get("from") || "";
  const to = url.searchParams.get("to") || "";
  const span = Date.parse(to) - Date.parse(from);
  if (!validDate(from) || !validDate(to) || span < 0 || span > 63 * 86_400_000)
    return json({ error: "Choose a calendar range of up to 63 days." }, 400);
  try {
    const access = await authorize(supplied);
    if (access instanceof Response) return access;
    if (access === "other")
      return json({
        connected: false,
        lessons: [],
        fetchedAt: new Date().toISOString(),
      });

    const client = studio();
    const lessons: StudioLessonRow[] = [];
    // Page explicitly so a busy historical month cannot silently truncate.
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await client
        .from("lessons")
        .select(LESSON_FIELDS)
        .in("status", ["scheduled", "completed"])
        .gte("date", from)
        .lte("date", to)
        .order("date")
        .order("time")
        .order("id")
        .range(offset, offset + 499);
      if (error) throw new Error("Studio query failed");
      const rows = data as unknown as StudioLessonRow[];
      lessons.push(...rows);
      if (rows.length < 500) break;
    }
    return json({
      connected: true,
      lessons: lessons.map(calendarLesson),
      fetchedAt: new Date().toISOString(),
    });
  } catch {
    return json(
      { error: "Piano lessons could not refresh. Please try again." },
      502,
    );
  }
}

/**
 * Completes a lesson through Piano Studio's own logging flow, which deducts a
 * credit, books next week's lesson if needed, and emails the student. Elephant
 * never writes lesson status directly, so credits stay consistent.
 */
export async function POST(request: Request): Promise<Response> {
  const supplied = credentials(request);
  if (supplied instanceof Response) return supplied;
  let body: { lessonId?: unknown; notes?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Send a lesson to complete." }, 400);
  }
  const lessonId =
    typeof body?.lessonId === "string"
      ? body.lessonId.replace(/^piano-studio:/, "")
      : "";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(lessonId))
    return json({ error: "Choose a lesson to complete." }, 400);
  if (
    body.notes !== undefined &&
    (typeof body.notes !== "string" || body.notes.length > MAX_NOTES_LENGTH)
  )
    return json(
      { error: `Keep lesson notes under ${MAX_NOTES_LENGTH} characters.` },
      400,
    );

  try {
    const access = await authorize(supplied);
    if (access instanceof Response) return access;
    if (access === "other")
      return json(
        { error: "Only the studio owner can complete lessons." },
        403,
      );
    const secret = process.env.PIANO_STUDIO_AGENT_SECRET;
    if (!secret)
      return json(
        {
          error:
            "Completing lessons from Elephant isn’t connected yet. Add PIANO_STUDIO_AGENT_SECRET to Elephant’s server settings, or log this lesson in Piano Studio.",
        },
        503,
      );

    const { data, error } = await studio()
      .from("lessons")
      .select(`${LESSON_FIELDS},notes`)
      .eq("id", lessonId)
      .limit(1);
    if (error) throw new Error("Studio query failed");
    const row = (
      data as unknown as (StudioLessonRow & {
        notes: string | null;
      })[]
    )[0];
    if (!row)
      return json(
        { error: "This lesson no longer exists in Piano Studio." },
        404,
      );
    if (row.status === "completed")
      return json({ lesson: calendarLesson(row), alreadyCompleted: true });
    if (row.status !== "scheduled")
      return json({ error: "This lesson was cancelled in Piano Studio." }, 409);
    if (Date.parse(studioTimestamp(row.date, row.time)) > Date.now())
      return json(
        {
          error: "This lesson hasn’t started yet. Complete it once it begins.",
        },
        409,
      );

    // Piano Studio replaces notes when logging; keep its existing notes unless
    // new ones were written here.
    const notes =
      typeof body.notes === "string" && body.notes.trim()
        ? body.notes.trim()
        : (row.notes ?? "");
    const appUrl = (
      process.env.PIANO_STUDIO_APP_URL || DEFAULT_STUDIO_APP_URL
    ).replace(/\/+$/, "");
    let response: Response;
    try {
      response = await fetch(
        `${appUrl}/api/agent/lessons/${encodeURIComponent(lessonId)}/log`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${secret}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ notes }),
          signal: AbortSignal.timeout(25_000),
        },
      );
    } catch {
      return json(
        {
          error:
            "Piano Studio didn’t confirm in time. Refresh to check whether the lesson was logged before trying again.",
        },
        504,
      );
    }
    if (!response.ok)
      return json(
        {
          error:
            response.status === 401
              ? "Piano Studio rejected Elephant’s connection. Check PIANO_STUDIO_AGENT_SECRET."
              : "Piano Studio couldn’t log this lesson. Refresh, then try again or log it in Piano Studio.",
        },
        502,
      );
    const result = (await response.json().catch(() => ({}))) as {
      credit_deducted?: boolean;
      previous_credits?: number | null;
      new_credits?: number | null;
      next_lesson?: { date?: string } | null;
    };
    return json({
      lesson: calendarLesson({ ...row, status: "completed" }),
      alreadyCompleted: false,
      creditDeducted: result.credit_deducted === true,
      previousCredits: result.previous_credits ?? null,
      newCredits: result.new_credits ?? null,
      nextLessonDate:
        typeof result.next_lesson?.date === "string" &&
        validDate(result.next_lesson.date)
          ? result.next_lesson.date
          : null,
    });
  } catch {
    return json(
      {
        error:
          "Piano Studio couldn’t be reached. Refresh, then try again or log it in Piano Studio.",
      },
      502,
    );
  }
}
