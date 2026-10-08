import { desktopRequest } from "./desktopCloud";
import type { CloudWorkspace } from "./desktopCloud";
import { validateImport } from "./model";

const CACHE_KEY = "elephant.workspace.local.v1";
const CONNECTION_KEY = "elephant.piano-studio.connection.v1";
const validKey = (key: string) => /^[A-Za-z0-9_-]{43}$/.test(key);

export function parseWorkspaceKey(value: string): string {
  const trimmed = value.trim();
  if (validKey(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    const parameters = new URLSearchParams(url.hash.slice(1));
    const key =
      parameters.get("workspace-connect") ??
      parameters.get("piano-connect") ??
      "";
    if (validKey(key)) return key;
  } catch {
    /* Show one useful error for malformed links. */
  }
  throw new Error(
    "Paste the private workspace link from Settings on your connected device.",
  );
}

export function privateWorkspaceLink(
  key: string,
  origin = window.location.origin,
): string {
  if (!validKey(key)) throw new Error("Invalid workspace connection.");
  return `${origin}/#workspace-connect=${key}`;
}

/** A device joins an existing remote workspace; it must never upload its demo/local cache. */
export async function connectExistingWorkspace(value: string): Promise<void> {
  const key = parseWorkspaceKey(value);
  const original = localStorage.getItem(CACHE_KEY);
  const previousKey = localStorage.getItem(CONNECTION_KEY);
  const result = await desktopRequest<CloudWorkspace>(
    key,
    AbortSignal.timeout(12_000),
  );
  if (result.error) throw new Error(result.error.message);
  if (!result.data)
    throw new Error(
      "No saved workspace was found. Open Settings on your connected device and wait for Saved to Supabase.",
    );
  const state = validateImport(result.data.data);
  const revision = result.data.revision;
  if (!Number.isSafeInteger(revision) || revision < 1)
    throw new Error("The saved workspace could not be verified. Please retry.");
  if (
    localStorage.getItem(CACHE_KEY) !== original ||
    localStorage.getItem(CONNECTION_KEY) !== previousKey
  ) {
    throw new Error(
      "Another Elephant tab changed this device. Close that tab and try connecting again.",
    );
  }
  if (previousKey === key && original) {
    try {
      // Preserve any unsynced edits when reopening a link on an already connected device.
      if (JSON.parse(original).cloudStore === "elephant") return;
    } catch {
      /* An unreadable cache can be recovered from the verified server copy. */
    }
  }
  if (original !== null) {
    const backupKey = `${CACHE_KEY}.before-connect.${crypto.randomUUID()}`;
    localStorage.setItem(backupKey, original);
    if (localStorage.getItem(backupKey) !== original)
      throw new Error(
        "Could not preserve this device’s copy. Download a backup before connecting.",
      );
  }
  const raw = JSON.stringify({
    storageVersion: 1,
    state,
    revision,
    dirty: false,
    cloudStore: "elephant",
  });
  try {
    localStorage.setItem(CACHE_KEY, raw);
    localStorage.setItem(CONNECTION_KEY, key);
    if (
      localStorage.getItem(CACHE_KEY) !== raw ||
      localStorage.getItem(CONNECTION_KEY) !== key
    )
      throw new Error("Browser storage is unavailable.");
  } catch {
    // Keep the previous workspace usable if the connection cannot be remembered.
    if (original === null) localStorage.removeItem(CACHE_KEY);
    else localStorage.setItem(CACHE_KEY, original);
    if (previousKey === null) localStorage.removeItem(CONNECTION_KEY);
    else localStorage.setItem(CONNECTION_KEY, previousKey);
    throw new Error(
      "This browser could not save the connection. Allow website storage and try again.",
    );
  }
}
