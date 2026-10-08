import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  connectExistingWorkspace,
  parseWorkspaceKey,
  privateWorkspaceLink,
} from "./workspaceConnection";
import { desktopRequest } from "./desktopCloud";
import { addItem, createEmptyState } from "./model";
vi.mock("./desktopCloud", () => ({ desktopRequest: vi.fn() }));
const key = "c".repeat(43);
const cacheKey = "elephant.workspace.local.v1";
const connectionKey = "elephant.piano-studio.connection.v1";
let saved: Map<string, string>;
const remote = {
  data: addItem(createEmptyState(), "Real desktop task"),
  revision: 18,
};
beforeEach(() => {
  saved = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  });
  vi.mocked(desktopRequest).mockReset();
  vi.mocked(desktopRequest).mockResolvedValue({ data: remote, error: null });
});
afterEach(() => vi.unstubAllGlobals());

it("accepts workspace and legacy private links while sending credentials only to the local API", () => {
  expect(
    parseWorkspaceKey(
      `https://elephant-app-gold.vercel.app/#workspace-connect=${key}`,
    ),
  ).toBe(key);
  expect(
    parseWorkspaceKey(
      `https://elephant-app-gold.vercel.app/#piano-connect=${key}`,
    ),
  ).toBe(key);
  expect(parseWorkspaceKey(` ${key} `)).toBe(key);
  expect(privateWorkspaceLink(key, "https://elephant.test")).toBe(
    `https://elephant.test/#workspace-connect=${key}`,
  );
  expect(() =>
    parseWorkspaceKey(`javascript://elephant/#workspace-connect=${key}`),
  ).toThrow();
  expect(() => parseWorkspaceKey("not-a-private-link")).toThrow();
});
it("loads the existing cloud copy, preserving the previous mobile cache byte for byte without uploading it", async () => {
  const original = '{"my":"old mobile cache"}';
  saved.set(cacheKey, original);
  await connectExistingWorkspace(key);
  expect(JSON.parse(saved.get(cacheKey)!)).toEqual({
    storageVersion: 1,
    state: remote.data,
    revision: 18,
    dirty: false,
    cloudStore: "elephant",
  });
  expect(
    [...saved]
      .filter(([key]) => key.startsWith(cacheKey + ".before-connect."))
      .map(([, value]) => value),
  ).toEqual([original]);
  expect(saved.get(connectionKey)).toBe(key);
  expect(desktopRequest).toHaveBeenCalledExactlyOnceWith(
    key,
    expect.any(AbortSignal),
  );
});
it("keeps unsynced edits when the same private link is reopened on an already connected device", async () => {
  const raw = JSON.stringify({
    cloudStore: "elephant",
    dirty: true,
    state: addItem(remote.data, "Unsynced edit"),
    revision: 18,
  });
  saved.set(cacheKey, raw);
  saved.set(connectionKey, key);
  await connectExistingWorkspace(key);
  expect(saved.get(cacheKey)).toBe(raw);
  expect(saved.size).toBe(2);
});
it.each([
  { data: null, error: { message: "Invalid connection" } },
  { data: null, error: null },
  { data: { data: { version: 999 }, revision: 18 }, error: null },
  { data: { ...remote, revision: 0 }, error: null },
])(
  "leaves the device untouched when the server cannot verify a saved workspace",
  async (result) => {
    saved.set(cacheKey, "old data");
    vi.mocked(desktopRequest).mockResolvedValue(result);
    await expect(connectExistingWorkspace(key)).rejects.toThrow();
    expect([...saved]).toEqual([[cacheKey, "old data"]]);
  },
);
it("cannot overwrite a different tab’s changes made during connection", async () => {
  saved.set(cacheKey, "original");
  vi.mocked(desktopRequest).mockImplementation(async () => {
    saved.set(cacheKey, "new edit");
    return { data: remote, error: null };
  });
  await expect(connectExistingWorkspace(key)).rejects.toThrow(
    "Another Elephant tab",
  );
  expect([...saved]).toEqual([[cacheKey, "new edit"]]);
});
it("does not change cache or connection when the recovery copy cannot be saved", async () => {
  saved.set(cacheKey, "original");
  vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new Error("Full");
  });
  await expect(connectExistingWorkspace(key)).rejects.toThrow();
  expect([...saved]).toEqual([[cacheKey, "original"]]);
});
it("rolls back the browser cache if storing its connection key fails", async () => {
  saved.set(cacheKey, "original");
  vi.spyOn(localStorage, "setItem").mockImplementation((name, value) => {
    if (name === connectionKey) throw new Error("Blocked");
    saved.set(name, value);
  });
  await expect(connectExistingWorkspace(key)).rejects.toThrow(
    "Allow website storage",
  );
  expect(saved.get(cacheKey)).toBe("original");
  expect(saved.has(connectionKey)).toBe(false);
});
