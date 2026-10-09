import { createHash, timingSafeEqual } from "node:crypto";
import {
  BackupAlreadyRunningError,
  backupEnvFrom,
  runDatabaseBackup,
  sendBackupEmail,
  sendBackupFailureEmail,
} from "../server/backup/db-backup.ts";

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      Vary: "Authorization",
    },
  });
}

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || !authorization) return false;
  // Hash first so every comparison uses equally sized buffers, including
  // malformed or incorrectly sized credentials.
  return timingSafeEqual(
    createHash("sha256").update(authorization).digest(),
    createHash("sha256").update(`Bearer ${secret}`).digest(),
  );
}

/** Vercel's authenticated daily cron; all credentials remain server-side. */
export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) return json({ error: "Unauthorized." }, 401);

  const host = new URL(request.url).hostname;
  let archiveCreated = false;
  try {
    const env = backupEnvFrom(process.env);
    const result = await runDatabaseBackup({
      env,
      // Provider errors and payloads can contain credentials or workspace data.
      // Log fixed stage messages rather than interpolating their raw content.
      log: () => console.info("[db-backup] Backup progress."),
    });
    archiveCreated = true;
    if (result.status !== "ok" || process.env.BACKUP_ALERT_SUCCESS !== "off")
      await sendBackupEmail(env, result, host);
    console.info("[db-backup] Backup completed.");
    return json(result);
  } catch (error) {
    if (error instanceof BackupAlreadyRunningError)
      return json({ error: "A database backup is already running." }, 409);

    console.warn(
      archiveCreated
        ? "[db-backup] Archive created, but backup notification failed."
        : "[db-backup] Database backup failed.",
    );
    try {
      // Read notification credentials independently: even an incomplete
      // database or R2 configuration must be able to trigger a failure alert.
      await sendBackupFailureEmail(
        process.env,
        archiveCreated
          ? new Error(
              "Backup archive was created, but its notification failed.",
            )
          : error,
        host,
      );
    } catch {
      console.warn("[db-backup] Failure notification could not be sent.");
    }
    return json(
      { error: "Database backup failed. Check backup alerts and server logs." },
      500,
    );
  }
}
