import { afterEach, expect, it, vi } from "vitest";
import { prepareLocalPianoConnection } from "./localPianoConnection";

const key = "a".repeat(43);
afterEach(() => vi.unstubAllGlobals());

it("keeps the desktop connection even when the browser cannot save its key", () => {
  const replaceState = vi.fn();
  vi.stubGlobal("window", {
    location: { hash: `#piano-connect=${key}`, pathname: "/", search: "" },
    history: { replaceState },
  });
  vi.stubGlobal("localStorage", {
    setItem() {
      throw new Error("Storage full");
    },
  });
  expect(prepareLocalPianoConnection()).toEqual({
    key,
    storageError: true,
  });
  expect(replaceState).toHaveBeenCalledWith(null, "", "/#/still/calendar");
});

it("invalid links cannot grant access or switch workspaces", () => {
  vi.stubGlobal("window", {
    location: { hash: "#piano-connect=invalid", pathname: "/", search: "" },
    history: { replaceState: vi.fn() },
  });
  const setItem = vi.fn();
  vi.stubGlobal("localStorage", { setItem, getItem: () => null });
  expect(prepareLocalPianoConnection()).toEqual({
    key: null,
    storageError: false,
  });
  expect(setItem).not.toHaveBeenCalled();
});
