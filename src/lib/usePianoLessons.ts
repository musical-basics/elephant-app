import { useCallback, useEffect, useState } from "react";
import type { PianoLessonFeed } from "./pianoLessons";

interface FeedState {
  key: string;
  feed: PianoLessonFeed | null;
  error: string | null;
  loading: boolean;
}

export function usePianoLessons(
  token: string | null,
  from: string,
  to: string,
) {
  const key = JSON.stringify([token, from, to]);
  const [state, setState] = useState<FeedState>({
    key: "",
    feed: null,
    error: null,
    loading: false,
  });
  const [refreshId, setRefreshId] = useState(0);
  const refresh = useCallback(() => setRefreshId((id) => id + 1), []);

  useEffect(() => {
    if (!token) return;
    let active = true;
    let pending = false;
    let controller: AbortController | null = null;
    async function load() {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 15_000);
      setState((previous) => ({
        key,
        feed: previous.key === key ? previous.feed : null,
        error: null,
        loading: true,
      }));
      try {
        const response = await fetch(
          `/api/piano-lessons?${new URLSearchParams({ from, to })}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
            signal: controller.signal,
          },
        );
        if (!response.ok)
          throw new Error(
            response.status === 401
              ? "Sign in again to refresh piano lessons."
              : "Piano lessons could not refresh. Please try again.",
          );
        const feed = (await response.json()) as PianoLessonFeed;
        if (typeof feed.connected !== "boolean" || !Array.isArray(feed.lessons))
          throw new Error("Piano lessons could not refresh. Please try again.");
        if (active) setState({ key, feed, error: null, loading: false });
      } catch (error) {
        if (active)
          setState((previous) => ({
            key,
            feed: previous.key === key ? previous.feed : null,
            error:
              error instanceof Error && error.name !== "AbortError"
                ? error.message
                : "Piano lessons timed out. Please try again.",
            loading: false,
          }));
      } finally {
        window.clearTimeout(timeout);
        pending = false;
      }
    }
    void load();
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    const interval = window.setInterval(() => void load(), 60_000);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [token, from, to, key, refreshId]);

  // Synchronously hide the old account/range, even before effect cleanup runs.
  const current = token && state.key === key ? state : null;
  return {
    feed: current?.feed ?? null,
    error: current?.error ?? null,
    loading: !!token && (current?.loading ?? true),
    refresh,
  };
}
