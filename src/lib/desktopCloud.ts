import type { AppState } from "./model";

export interface CloudResult<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
}
export interface CloudWorkspace {
  data: unknown;
  revision: number;
}

export async function desktopRequest<T>(
  key: string,
  signal: AbortSignal,
  save?: {
    data: AppState;
    expectedRevision: number | null;
  },
): Promise<CloudResult<T>> {
  const response = await fetch("/api/workspace", {
    method: save ? "PUT" : "GET",
    headers: {
      "X-Elephant-Key": key,
      ...(save ? { "Content-Type": "application/json" } : {}),
    },
    body: save ? JSON.stringify(save) : undefined,
    cache: "no-store",
    signal,
  });
  const body = await response.json();
  if (!response.ok)
    return {
      data: null,
      error: {
        message:
          typeof body.error === "string"
            ? body.error
            : "Supabase request failed.",
        code: response.status === 409 ? "23505" : undefined,
      },
    };
  return { data: save ? body : body.workspace, error: null };
}
