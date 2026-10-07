import { createHash, timingSafeEqual } from "node:crypto";

/** A private, read-only calendar capability; never a studio database key. */
export function hasLocalPianoAccess(request: Request): boolean {
  const key = request.headers.get("x-piano-key") || "";
  const expected = process.env.PIANO_STUDIO_LOCAL_KEY_HASH || "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(key) || !/^[a-f0-9]{64}$/.test(expected))
    return false;
  const actual = createHash("sha256").update(key).digest();
  return timingSafeEqual(actual, Buffer.from(expected, "hex"));
}
