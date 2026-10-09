import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { loadRootEnv } from "./env.mjs";
import {
  backupEnvFrom,
  readVerifiedArchive,
} from "../../server/backup/db-backup.ts";

const [archive, output, workspaceId = "desktop", ...extra] =
  process.argv.slice(2);
if (!archive || !output || extra.length) {
  console.error(
    "Usage: node scripts/db/restore-workspace.mjs ARCHIVE OUTPUT_FILE [WORKSPACE_ID]",
  );
  process.exit(1);
}
const outputPath = resolve(output);
try {
  const env = backupEnvFrom(loadRootEnv());
  const files = await readVerifiedArchive(env, archive);
  const workspaces = JSON.parse(
    gunzipSync(files.get("elephant.workspaces.json.gz")).toString(),
  );
  const workspace = workspaces.find((row) => row.id === workspaceId);
  if (!workspace?.data || workspace.data.version !== 1)
    throw new Error("Workspace not found or invalid");
  await writeFile(outputPath, JSON.stringify(workspace.data, null, 2), {
    flag: "wx",
    mode: 0o600,
  });
  console.log(`Verified all archive files. Wrote ${outputPath}`);
  console.log(
    "To restore, choose this file in Elephant → Settings → Restore JSON backup, review it, and confirm. The database has not been changed.",
  );
} catch (error) {
  console.error(
    "Could not extract workspace:",
    error instanceof Error ? error.name : "UnknownError",
  );
  process.exitCode = 1;
}
