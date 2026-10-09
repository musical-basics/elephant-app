import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

export function loadRootEnv() {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  process.chdir(root);
  const path = new URL("../../.env.local", import.meta.url);
  const env = {
    ...(existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {}),
    ...process.env,
  };
  try {
    process.env.BACKUP_COMMIT = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  } catch {
    /* Commit metadata is optional. */
  }
  return env;
}
