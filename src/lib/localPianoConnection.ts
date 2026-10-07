const CONNECTION_KEY = "elephant.piano-studio.connection.v1";

export interface LocalPianoConnection {
  key: string | null;
  preferLocal: boolean;
  storageError: boolean;
}

/** Run before React mounts so an existing account can never replace the local workspace. */
export function prepareLocalPianoConnection(): LocalPianoConnection {
  const parameters = new URLSearchParams(window.location.hash.slice(1));
  const supplied = parameters.get("piano-connect");
  const key =
    supplied && /^[A-Za-z0-9_-]{43}$/.test(supplied) ? supplied : null;
  let savedKey: string | null = null;
  let storageError = false;
  if (supplied !== null) {
    // Fragments never reach the server; remove the private key from browser history too.
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}#/still/calendar`,
    );
  }
  try {
    if (key) {
      localStorage.setItem(CONNECTION_KEY, key);
    }
    savedKey = localStorage.getItem(CONNECTION_KEY);
  } catch {
    storageError = Boolean(key);
  }
  const connectionKey =
    key || (savedKey && /^[A-Za-z0-9_-]{43}$/.test(savedKey) ? savedKey : null);
  return {
    key: connectionKey,
    preferLocal: Boolean(connectionKey),
    storageError,
  };
}
