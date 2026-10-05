import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createCountdown, pauseCountdown, remainingMilliseconds, resumeCountdown,
  settleCountdown, validateCountdown,
} from './countdown';
import type { CountdownState, CountdownStatus } from './countdown';

export const COUNTDOWN_STORAGE_KEY = 'elephant.countdown.v1';

function readStoredTimer(): CountdownState | null {
  try {
    const raw = sessionStorage.getItem(COUNTDOWN_STORAGE_KEY);
    return raw === null ? null : validateCountdown(JSON.parse(raw));
  } catch {
    return null;
  }
}

function persistTimer(timer: CountdownState | null): void {
  try {
    if (timer) sessionStorage.setItem(COUNTDOWN_STORAGE_KEY, JSON.stringify(timer));
    else sessionStorage.removeItem(COUNTDOWN_STORAGE_KEY);
  } catch {
    // The timer continues in memory when this tab cannot use session storage.
  }
}

export function useCountdown({ itemId, scope, ready }: { itemId: string | null; scope: string; ready: boolean }): {
  timer: null | { durationSeconds: number; status: CountdownStatus };
  remainingSeconds: number;
  open: (seconds: number) => void;
  start: (seconds: number) => void;
  pause: () => void;
  resume: () => void;
  reset: () => void;
  remove: () => void;
} {
  const [stored, setStored] = useState<CountdownState | null>(readStoredTimer);
  const [now, setNow] = useState(Date.now);
  const current = useRef(stored);

  const commit = useCallback((next: CountdownState | null, at = Date.now()) => {
    current.current = next;
    setStored(next);
    setNow(at);
    persistTimer(next);
  }, []);

  // Wait for workspace/account loading to finish before comparing identities.
  // The render guard below hides an unmatched record without deleting it early.
  useEffect(() => {
    if (!ready) return;
    const saved = current.current;
    if (!itemId || !saved || saved.itemId !== itemId || saved.scope !== scope) {
      commit(null);
      return;
    }
    const at = Date.now();
    const next = settleCountdown(saved, at);
    if (next !== saved) commit(next, at);
    else setNow(at);
  }, [ready, itemId, scope, commit]);

  useEffect(() => {
    if (!ready || !itemId || stored?.status !== 'running'
      || stored.itemId !== itemId || stored.scope !== scope) return;
    const refresh = () => {
      const saved = current.current;
      if (!saved || saved.itemId !== itemId || saved.scope !== scope) return;
      const at = Date.now();
      const next = settleCountdown(saved, at);
      if (next !== saved) commit(next, at);
      else setNow(at);
    };
    refresh();
    const interval = window.setInterval(refresh, 250);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [ready, itemId, scope, stored?.status, commit]);

  const matchingTimer = useCallback(() => {
    const saved = current.current;
    return ready && itemId && saved?.itemId === itemId && saved.scope === scope ? saved : null;
  }, [ready, itemId, scope]);

  const open = useCallback((seconds: number) => {
    if (!ready || !itemId) return;
    const at = Date.now();
    commit(createCountdown(itemId, scope, seconds, false, at), at);
  }, [ready, itemId, scope, commit]);

  const start = useCallback((seconds: number) => {
    if (!ready || !itemId) return;
    const at = Date.now();
    commit(createCountdown(itemId, scope, seconds, true, at), at);
  }, [ready, itemId, scope, commit]);

  const pause = useCallback(() => {
    const saved = matchingTimer();
    if (!saved) return;
    const at = Date.now();
    commit(pauseCountdown(saved, at), at);
  }, [matchingTimer, commit]);

  const resume = useCallback(() => {
    const saved = matchingTimer();
    if (!saved) return;
    const at = Date.now();
    commit(resumeCountdown(saved, at), at);
  }, [matchingTimer, commit]);

  const reset = useCallback(() => {
    const saved = matchingTimer();
    if (!saved) return;
    const at = Date.now();
    commit(createCountdown(saved.itemId, saved.scope, saved.durationSeconds, false, at), at);
  }, [matchingTimer, commit]);

  const remove = useCallback(() => {
    if (matchingTimer()) commit(null);
  }, [matchingTimer, commit]);

  const visible = ready && itemId && stored?.itemId === itemId && stored.scope === scope
    ? settleCountdown(stored, now) : null;
  return {
    timer: visible ? { durationSeconds: visible.durationSeconds, status: visible.status } : null,
    remainingSeconds: visible ? Math.ceil(remainingMilliseconds(visible, now) / 1000) : 0,
    open, start, pause, resume, reset, remove,
  };
}
