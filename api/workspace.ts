import { createHash, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { validateImport } from "../src/lib/model.js";

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      Vary: "X-Elephant-Key",
    },
  });
}

function connect(request: Request) {
  const key = request.headers.get("x-elephant-key") || "";
  const hash = process.env.ELEPHANT_WORKSPACE_KEY_HASH || "";
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(key) ||
    !/^[a-f0-9]{64}$/.test(hash) ||
    !timingSafeEqual(
      createHash("sha256").update(key).digest(),
      Buffer.from(hash, "hex"),
    )
  )
    return json(
      { error: "Open your private Elephant link to connect this workspace." },
      401,
    );
  const url = process.env.VITE_SUPABASE_URL;
  const secret = process.env.ELEPHANT_SUPABASE_SERVICE_KEY;
  if (!url || !secret)
    return json(
      { error: "Supabase workspace storage is not configured." },
      503,
    );
  return createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }),
    },
  });
}

export async function GET(request: Request) {
  const client = connect(request);
  if (client instanceof Response) return client;
  try {
    const { data, error } = await client.rpc("elephant_read_desktop", {
      p_workspace_id: process.env.ELEPHANT_WORKSPACE_ID || "desktop",
    });
    if (error) throw error;
    return json({ workspace: data });
  } catch {
    return json(
      {
        error:
          "Could not load your Supabase workspace. Your browser copy is preserved.",
      },
      502,
    );
  }
}

export async function PUT(request: Request) {
  const client = connect(request);
  if (client instanceof Response) return client;
  let body;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > 4 * 1024 * 1024)
      return json(
        {
          error:
            "This workspace exceeds the 4 MB save limit. Export a backup before reducing it.",
        },
        413,
      );
    body = JSON.parse(raw) as { data: unknown; expectedRevision: unknown };
    if (
      !body ||
      (body.expectedRevision !== null &&
        (!Number.isSafeInteger(body.expectedRevision) ||
          Number(body.expectedRevision) < 1))
    )
      return json({ error: "A valid expected revision is required." }, 400);
    body.data = validateImport(body.data);
  } catch {
    return json({ error: "The workspace is invalid; nothing was saved." }, 400);
  }
  try {
    const { data, error } = await client.rpc("elephant_save_desktop", {
      p_workspace_id: process.env.ELEPHANT_WORKSPACE_ID || "desktop",
      p_data: body.data,
      p_expected_revision: body.expectedRevision,
    });
    if (error) throw error;
    if (!data)
      return json(
        {
          error:
            "Another device changed this workspace. Both copies are preserved.",
        },
        409,
      );
    return json(data);
  } catch {
    return json(
      {
        error:
          "Could not save to Supabase. Your changes are kept in this browser.",
      },
      502,
    );
  }
}
