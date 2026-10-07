import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { createDemoState, createEmptyState, ensureProjectPlaceholders, validateImport } from './model';
import type { AppState } from './model';
import { designs } from './designs';

const LOCAL_KEY = 'elephant.workspace.local.v1';
const SAVE_DELAY = 650;
const REQUEST_TIMEOUT = 12_000;

type Cache = {
  storageVersion: 1;
  state: AppState;
  revision: number | null;
  dirty: boolean;
};

type Scope = Cache & {
  userId: string | null;
  key: string;
  raw: string | null;
  loaded: boolean;
  corrupt: boolean;
  conflict: boolean;
  cacheConflict: boolean;
  storageError: string | null;
  saving: boolean;
  loading: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  requests: Set<AbortController>;
};

type NextState = AppState | ((state: AppState) => AppState);
type Actions = {
  update: (next: NextState) => void;
  restoreBackup: (data: AppState) => Promise<void>;
  retrySync: () => void;
  signIn: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
};

function message(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return String(error);
}

function configureClient(): { client: SupabaseClient | null; error: string | null } {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY)?.trim();
  if (!url && !key) return { client: null, error: null };
  if (!url || !key) return { client: null, error: 'Cloud configuration is incomplete. The app is using browser storage.' };
  if (key.startsWith('sb_secret_')) {
    return { client: null, error: 'Cloud setup requires a publishable browser key. Remove the secret key from the deployment environment.' };
  }
  try {
    // An anon JWT is the supported legacy alternative to a publishable key.
    if (key.split('.').length === 3) {
      const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { role?: string };
      if (payload.role === 'service_role') throw new Error('Use a publishable or anon key, never a service-role key.');
    }
    return { client: createClient(url, key), error: null };
  } catch (error) {
    return { client: null, error: `Cloud configuration could not be loaded: ${message(error)}` };
  }
}

const configuration = configureClient();

function readScope(userId: string | null): Scope {
  const key = userId ? `elephant.workspace.account.${userId}.v1` : LOCAL_KEY;
  const scope: Scope = {
    storageVersion: 1,
    state: userId ? createEmptyState() : createDemoState(),
    revision: null,
    dirty: false,
    userId,
    key,
    raw: null,
    loaded: !userId,
    corrupt: false,
    conflict: false,
    cacheConflict: false,
    storageError: null,
    saving: false,
    loading: false,
    timer: null,
    requests: new Set(),
  };
  try {
    scope.raw = localStorage.getItem(key);
  } catch {
    scope.storageError = 'Browser storage is unavailable. Keep this tab open and export your work; edits may not survive a reload.';
    return scope;
  }
  if (scope.raw === null) return scope;
  try {
    const cache = JSON.parse(scope.raw) as Cache;
    if (cache.storageVersion !== 1 || typeof cache.dirty !== 'boolean'
      || (cache.revision !== null && (!Number.isSafeInteger(cache.revision) || cache.revision < 1))) {
      throw new Error('Unrecognized saved-data format.');
    }
    scope.state = validateImport(cache.state);
    // Account caches must first reconcile with the unmodified cloud snapshot.
    if (!userId) scope.state = ensureProjectPlaceholders(scope.state);
    scope.revision = cache.revision;
    scope.dirty = userId ? cache.dirty : false;
  } catch {
    scope.state = createEmptyState();
    scope.corrupt = true;
    scope.storageError = 'Saved browser data could not be read and has been left untouched. Editing is paused to protect it. You can restore a previously downloaded JSON backup in Settings.';
  }
  return scope;
}

export function useWorkspace(localOnly = false): {
  state: AppState;
  update: (next: NextState) => void;
  restoreBackup: (data: AppState) => Promise<void>;
  recoveryNeeded: boolean;
  ready: boolean;
  mode: 'local' | 'cloud';
  syncStatus: string;
  error: string | null;
  userEmail: string | null;
  accessToken: string | null;
  configured: boolean;
  signIn: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  retrySync: () => void;
} {
  const [state, setState] = useState<AppState>(createDemoState);
  const [ready, setReady] = useState(false);
  const [recoveryNeeded, setRecoveryNeeded] = useState(false);
  const [mode, setMode] = useState<'local' | 'cloud'>('local');
  const [syncStatus, setSyncStatus] = useState('Loading workspace…');
  const [error, setError] = useState<string | null>(configuration.error);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const actions = useRef<Actions | null>(null);

  useEffect(() => {
    const client = localOnly ? null : configuration.client;
    let active = true;
    let current: Scope | null = null;
    let authVersion = 0;
    const authTimers = new Set<ReturnType<typeof setTimeout>>();
    const isCurrent = (scope: Scope) => active && current === scope;

    function stop(scope: Scope | null) {
      if (!scope) return;
      if (scope.timer) clearTimeout(scope.timer);
      scope.requests.forEach(controller => controller.abort());
    }

    function request(scope: Scope) {
      const controller = new AbortController();
      scope.requests.add(controller);
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
      return {
        signal: controller.signal,
        finish: () => {
          clearTimeout(timeout);
          scope.requests.delete(controller);
        },
      };
    }

    function persist(scope: Scope): boolean {
      if (scope.corrupt || scope.cacheConflict) return false;
      try {
        // Avoid replacing another tab's pending work in the shared browser cache.
        if (localStorage.getItem(scope.key) !== scope.raw) {
          scope.cacheConflict = true;
          scope.storageError = 'This workspace changed in another tab. Saving is paused. Export this tab’s work before reloading, then reconcile the two copies.';
          setError(scope.storageError);
          setSyncStatus('Saving paused · another tab changed');
          return false;
        }
        const cache: Cache = {
          storageVersion: 1,
          state: scope.state,
          revision: scope.revision,
          dirty: scope.dirty,
        };
        const raw = JSON.stringify(cache);
        localStorage.setItem(scope.key, raw);
        scope.raw = raw;
        scope.storageError = null;
        return true;
      } catch {
        scope.storageError = 'Could not save to browser storage. Keep this tab open and export your work. Check browser storage permissions or free up space.';
        setError(scope.storageError);
        return false;
      }
    }

    function showConflict(scope: Scope) {
      scope.conflict = true;
      setSyncStatus('Sync paused · conflicting changes');
      const location = scope.storageError ? 'Your current edits are only available in this tab.' : 'Your edits are preserved on this device.';
      setError(`Another device changed this workspace. ${location} Export your work before reloading, then reconcile the saved copies. Retry will never overwrite either copy.`);
    }

    function showSettled(scope: Scope) {
      if (scope.cacheConflict) return;
      setError(scope.storageError || configuration.error);
      setSyncStatus(scope.userId
        ? (scope.storageError ? 'Cloud saved · browser backup unavailable' : 'Saved to cloud')
        : (scope.storageError ? 'Not saved · export your work' : 'Saved on this device'));
    }

    async function saveCloud(scope: Scope) {
      if (!client || !scope.userId || !isCurrent(scope) || !scope.loaded || scope.loading
        || scope.saving || scope.corrupt || scope.conflict || scope.cacheConflict || !scope.dirty) return;
      scope.saving = true;
      try {
        while (isCurrent(scope) && scope.dirty && !scope.conflict && !scope.cacheConflict) {
          const snapshot = scope.state;
          const serialized = JSON.stringify(snapshot);
          const expectedRevision = scope.revision;
          setSyncStatus('Saving to cloud…');
          const pending = request(scope);
          try {
            const table = client.from('elephant_workspaces');
            const query = expectedRevision === null
              ? table.insert({ user_id: scope.userId, data: snapshot, revision: 1 })
              : table.update({ data: snapshot, revision: expectedRevision + 1 })
                .eq('user_id', scope.userId).eq('revision', expectedRevision);
            const result = await query.select('revision').abortSignal(pending.signal).maybeSingle();
            if (!isCurrent(scope)) return;
            if (result.error?.code === '23505' || (!result.error && !result.data)) {
              showConflict(scope);
              return;
            }
            if (result.error) throw result.error;
            scope.revision = result.data!.revision as number;
            // An edit made while this request ran becomes the next serialized save.
            scope.dirty = JSON.stringify(scope.state) !== serialized;
            persist(scope);
            if (!scope.dirty) showSettled(scope);
          } finally {
            pending.finish();
          }
        }
      } catch (failure) {
        if (!isCurrent(scope)) return;
        setSyncStatus(scope.storageError ? 'Not saved · export your work' : 'Saved on device · cloud pending');
        setError(`Cloud save failed. ${scope.storageError || 'Your changes are kept on this device.'} Check your connection and retry. ${message(failure)}`);
      } finally {
        scope.saving = false;
      }
    }

    async function loadCloud(scope: Scope) {
      if (!client || !scope.userId || !isCurrent(scope) || scope.loading || scope.saving || scope.corrupt || scope.cacheConflict) return;
      scope.loading = true;
      const pending = request(scope);
      setSyncStatus('Checking cloud workspace…');
      try {
        const result = await client.from('elephant_workspaces').select('data, revision')
          .eq('user_id', scope.userId).abortSignal(pending.signal).maybeSingle();
        if (!isCurrent(scope)) return;
        if (result.error) throw result.error;
        const remote = result.data ? validateImport(result.data.data) : createEmptyState();
        const revision = result.data ? result.data.revision as number : null;
        if (revision !== null && (!Number.isSafeInteger(revision) || revision < 1)) throw new Error('Invalid cloud revision.');
        if (scope.dirty) {
          if (JSON.stringify(scope.state) === JSON.stringify(remote)) {
            // Covers a completed save whose response was lost during a disconnect.
            scope.revision = revision;
            scope.dirty = false;
          } else if (scope.revision !== revision) {
            showConflict(scope);
            return;
          }
        } else {
          scope.state = remote;
          scope.revision = revision;
        }
        // Add new placeholder IDs only after lost-save and revision checks, so
        // migration cannot make equal cached and remote work appear different.
        const normalized = ensureProjectPlaceholders(scope.state);
        if (normalized !== scope.state) {
          scope.state = normalized;
          scope.dirty = true;
        }
        setState(scope.state);
        scope.loaded = true;
        scope.conflict = false;
        persist(scope);
        if (!scope.dirty) showSettled(scope);
      } catch (failure) {
        if (!isCurrent(scope)) return;
        setSyncStatus(scope.storageError ? 'Cloud unavailable · no browser backup' : 'Using device copy · cloud unavailable');
        setError(`Could not load the cloud workspace. ${scope.storageError || 'Edits will be kept on this device until a safe sync is possible.'} Check the connection and Supabase setup, then retry. ${message(failure)}`);
      } finally {
        pending.finish();
        scope.loading = false;
        if (isCurrent(scope)) {
          setReady(true);
          if (scope.loaded && !scope.conflict) void saveCloud(scope);
        }
      }
    }

    function activate(session: Session | null) {
      if (!active) return;
      const userId = session?.user.id || null;
      setUserEmail(session?.user.email || null);
      setAccessToken(session?.access_token || null);
      if (current && current.userId === userId) return;
      stop(current);
      current = readScope(userId);
      const scope = current;
      setMode(userId ? 'cloud' : 'local');
      setState(scope.state);
      setRecoveryNeeded(scope.corrupt);
      setReady(!userId || scope.corrupt);
      setError(scope.storageError || configuration.error);
      if (scope.corrupt) setSyncStatus('Recovery needed · editing paused');
      else if (userId) void loadCloud(scope);
      else {
        persist(scope);
        showSettled(scope);
      }
    }

    actions.current = {
      update(next) {
        const scope = current;
        if (!scope) throw new Error('Your workspace is still loading. Please try again in a moment.');
        if (scope.corrupt) throw new Error(scope.storageError || 'Editing is paused to protect your saved data.');
        scope.state = typeof next === 'function' ? next(scope.state) : next;
        scope.dirty = Boolean(scope.userId);
        setState(scope.state);
        persist(scope);
        if (!scope.userId) {
          showSettled(scope);
          return;
        }
        if (scope.conflict || scope.cacheConflict) return;
        setSyncStatus(scope.storageError ? 'Saving · browser backup unavailable' : 'Saved on device · cloud pending');
        if (scope.timer) clearTimeout(scope.timer);
        scope.timer = setTimeout(() => { void saveCloud(scope); }, SAVE_DELAY);
      },
      async restoreBackup(data) {
        const restored = ensureProjectPlaceholders(validateImport(data));
        const scope = current;
        if (!scope) throw new Error('Your workspace is still loading. Please try again in a moment.');
        if (!scope.corrupt) {
          actions.current!.update(restored);
          return;
        }
        if (scope.loading) throw new Error('A backup restore is already in progress. Please wait.');
        scope.loading = true;
        setSyncStatus('Restoring backup…');
        try {
          let revision: number | null = null;
          if (scope.userId) {
            if (!client) throw new Error('Could not connect to your account. Your saved data has not been changed.');
            const pending = request(scope);
            try {
              const result = await client.from('elephant_workspaces').select('revision')
                .eq('user_id', scope.userId).abortSignal(pending.signal).maybeSingle();
              if (!isCurrent(scope)) throw new Error('Your account changed before the restore finished. Please restore the backup again in the intended account.');
              if (result.error) throw new Error('Could not check the cloud workspace. Your saved data has not been changed. Check your connection and try restoring again.');
              revision = result.data ? result.data.revision as number : null;
              if (revision !== null && (!Number.isSafeInteger(revision) || revision < 1)) {
                throw new Error('The cloud workspace could not be verified. Your saved data has not been changed.');
              }
            } finally {
              pending.finish();
            }
          }
          if (!isCurrent(scope)) throw new Error('Your account changed before the restore finished. Please restore the backup again in the intended account.');
          let raw: string;
          try {
            const damaged = localStorage.getItem(scope.key);
            if (damaged !== scope.raw) {
              throw new Error('Saved data changed in another tab. Close the other tab and reload before restoring a backup.');
            }
            if (damaged !== null) {
              const recoveryKey = `${scope.key}.recovery.${crypto.randomUUID()}`;
              localStorage.setItem(recoveryKey, damaged);
              if (localStorage.getItem(recoveryKey) !== damaged) throw new Error('The original saved data could not be preserved.');
            }
            const cache: Cache = { storageVersion: 1, state: restored, revision, dirty: Boolean(scope.userId) };
            raw = JSON.stringify(cache);
            if (localStorage.getItem(scope.key) !== damaged) throw new Error('Saved data changed in another tab.');
            localStorage.setItem(scope.key, raw);
          } catch (failure) {
            throw new Error(`Could not safely restore the backup. Your original data has been kept. Check browser storage permissions or free up space, then try again. ${message(failure)}`);
          }
          scope.state = restored;
          scope.revision = revision;
          scope.raw = raw;
          scope.dirty = Boolean(scope.userId);
          scope.loaded = true;
          scope.corrupt = false;
          scope.conflict = false;
          scope.cacheConflict = false;
          scope.storageError = null;
          setState(restored);
          setRecoveryNeeded(false);
          setError(configuration.error);
        } catch (failure) {
          if (isCurrent(scope)) {
            setError(message(failure));
            setSyncStatus('Recovery needed · editing paused');
          }
          throw failure;
        } finally {
          scope.loading = false;
        }
        if (scope.userId) void saveCloud(scope);
        else showSettled(scope);
      },
      retrySync() {
        const scope = current;
        if (!scope || scope.corrupt || scope.cacheConflict) return;
        if (scope.userId) void loadCloud(scope);
        else {
          persist(scope);
          showSettled(scope);
        }
      },
      async signIn(email) {
        if (!client) throw new Error('Cloud is not configured. This workspace is saved on this device.');
        const redirect = new URL(window.location.pathname, window.location.origin);
        const design = window.location.hash.replace(/^#\/?/, '').split('/')[0]
          || new URLSearchParams(window.location.search).get('design');
        if (design && designs.some(entry => entry.id === design)) redirect.searchParams.set('design', design);
        const result = await client.auth.signInWithOtp({
          email: email.trim(),
          options: { emailRedirectTo: redirect.toString() },
        });
        if (result.error) throw result.error;
      },
      async signOut() {
        if (!client) return;
        // Pending account edits already live in that account's separate browser cache.
        const result = await client.auth.signOut({ scope: 'local' });
        if (result.error) throw result.error;
        activate(null);
      },
    };

    const onOnline = () => {
      if (current?.userId) void loadCloud(current);
    };
    window.addEventListener('online', onOnline);
    let unsubscribe: (() => void) | undefined;
    if (client) {
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        authVersion += 1;
        // Leave the auth callback before making any further Supabase requests.
        const timer = setTimeout(() => {
          authTimers.delete(timer);
          activate(session);
        }, 0);
        authTimers.add(timer);
      });
      unsubscribe = () => data.subscription.unsubscribe();
      const startingVersion = authVersion;
      void client.auth.getSession().then(result => {
        if (!active || authVersion !== startingVersion) return;
        activate(result.data.session);
        if (result.error) setError(`Could not restore sign-in. ${result.error.message}`);
      }).catch(failure => {
        if (!active || authVersion !== startingVersion) return;
        activate(null);
        setError(`Could not restore sign-in. ${message(failure)}`);
      });
    } else activate(null);

    return () => {
      active = false;
      stop(current);
      authTimers.forEach(clearTimeout);
      unsubscribe?.();
      window.removeEventListener('online', onOnline);
      actions.current = null;
    };
  }, [localOnly]);

  const update = useCallback((next: NextState) => actions.current?.update(next), []);
  const retrySync = useCallback(() => actions.current?.retrySync(), []);
  const restoreBackup = useCallback(async (data: AppState) => {
    if (!actions.current) throw new Error('Your workspace is still loading. Please try again in a moment.');
    await actions.current.restoreBackup(data);
  }, []);
  const signIn = useCallback(async (email: string) => { await actions.current?.signIn(email); }, []);
  const signOut = useCallback(async () => { await actions.current?.signOut(); }, []);

  return { state, update, restoreBackup, recoveryNeeded, ready, mode, syncStatus, error, userEmail, accessToken, configured: Boolean(configuration.client), signIn, signOut, retrySync };
}
