// Node >=22.18. Reads ignored .env.local; never prints secret values or row data.
import os from "node:os";
import { loadRootEnv } from "./env.mjs";
import {
  backupEnvFrom,
  planPrune,
  runDatabaseBackup,
  sendBackupEmail,
  sendBackupFailureEmail,
} from "../../server/backup/db-backup.ts";

const args = new Set(process.argv.slice(2));
if (
  [...args].some(
    (arg) => !["--dry-run", "--prune-dry-run", "--no-email"].includes(arg),
  )
) {
  console.error(
    "Usage: node scripts/db/backup.mjs [--dry-run | --prune-dry-run] [--no-email]",
  );
  process.exit(1);
}
const source = loadRootEnv();
const noEmail =
  args.has("--no-email") ||
  args.has("--dry-run") ||
  args.has("--prune-dry-run");
try {
  const env = backupEnvFrom(source);
  if (args.has("--prune-dry-run")) {
    console.log(JSON.stringify(await planPrune(env), null, 2));
  } else {
    const result = await runDatabaseBackup({
      env,
      dryRun: args.has("--dry-run"),
      log: console.log,
    });
    console.log(JSON.stringify(result, null, 2));
    if (
      !noEmail &&
      (result.status !== "ok" || source.BACKUP_ALERT_SUCCESS !== "off")
    ) {
      await sendBackupEmail(env, result, os.hostname());
      console.log(`Backup report sent to ${env.alertTo}`);
    }
    if (result.status !== "ok") process.exitCode = 1;
  }
} catch (error) {
  console.error(
    "Elephant backup failed:",
    error instanceof Error ? error.name : "UnknownError",
  );
  if (!noEmail)
    await sendBackupFailureEmail(source, error, os.hostname()).catch(() =>
      console.error("Failure report could not be sent."),
    );
  process.exitCode = 1;
}
