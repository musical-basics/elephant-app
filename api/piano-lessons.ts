import { createClient } from "@supabase/supabase-js";
import { calendarLesson, validDate } from "../server/pianoLessons.ts";
import type { StudioLessonRow } from "../server/pianoLessons.ts";

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", Vary: "Authorization" },
  });
}

/** Read-only bridge. Studio credentials and account authorization stay server-side. */
export async function GET(request: Request): Promise<Response> {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return json({ error: "Sign in to view piano lessons." }, 401);

  const url = new URL(request.url);
  const from = url.searchParams.get("from") || "";
  const to = url.searchParams.get("to") || "";
  const span = Date.parse(to) - Date.parse(from);
  if (!validDate(from) || !validDate(to) || span < 0 || span > 63 * 86_400_000)
    return json({ error: "Choose a calendar range of up to 63 days." }, 400);

  const authUrl = process.env.VITE_SUPABASE_URL;
  const authKey =
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;
  const ownerId = process.env.PIANO_STUDIO_OWNER_ID;
  const studioUrl = process.env.PIANO_STUDIO_SUPABASE_URL;
  const studioKey = process.env.PIANO_STUDIO_SERVICE_KEY;
  if (!authUrl || !authKey || !ownerId || !studioUrl || !studioKey)
    return json(
      { error: "The piano studio connection is not configured." },
      503,
    );

  try {
    const options = {
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
    const auth = createClient(authUrl, authKey, options);
    // Validate with the issuing auth server; never trust a decoded JWT/user ID.
    const {
      data: { user },
      error: authError,
    } = await auth.auth.getUser(token);
    if (authError || !user)
      return json({ error: "Sign in again to view piano lessons." }, 401);
    if (user.id !== ownerId || !user.email_confirmed_at)
      return json({
        connected: false,
        lessons: [],
        fetchedAt: new Date().toISOString(),
      });

    const studio = createClient(studioUrl, studioKey, options);
    const lessons: StudioLessonRow[] = [];
    // Page explicitly so a busy historical month cannot silently truncate.
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await studio
        .from("lessons")
        .select(
          "id,date,time,duration,status,student:profiles!lessons_student_id_fkey(name)",
        )
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
