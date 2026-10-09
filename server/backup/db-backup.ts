import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { archiveName, parseArchiveName, planRetention } from "./retention.ts";

export const BACKUP_PREFIX = "backups";
const LOCK_KEY = `${BACKUP_PREFIX}/.lock.json`;
const SCOPE = "elephant-v1";
const REQUIRED_TABLES = ["elephant.workspaces", "elephant.workspace_revisions"];
const SCHEMA_PARTS = [
  "columns",
  "constraints",
  "indexes",
  "functions",
  "triggers",
  "policies",
  "grants",
];

export type BackupEnv = {
  supabaseUrl: string;
  serviceKey: string;
  workspaceId: string;
  r2AccountId: string;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
  r2Bucket: string;
  resendApiKey?: string;
  alertTo: string;
  alertFrom: string;
};
type Table = {
  schema: string;
  name: string;
  primary_key: string[];
  rows: Record<string, unknown>[];
};
export type Snapshot = {
  version: 1;
  taken_at: string;
  tables: Table[];
  user_map: unknown[];
  schema: Record<string, unknown[]>;
};
type ArchiveFile = { key: string; bytes: number; sha256: string };
type TableDump = { table: string; rows: number; bytes: number };
type Manifest = {
  version: 1;
  scope: string;
  archive: string;
  status: "ok";
  verified: true;
  taken_at: string;
  completed_at: string;
  project_ref: string;
  commit: string | null;
  tables: TableDump[];
  files: ArchiveFile[];
  total_rows: number;
  total_bytes: number;
};
export type BackupResult = {
  status: "ok" | "degraded";
  archive: string;
  tables: TableDump[];
  totalRows: number;
  totalBytes: number;
  kept: string[];
  pruned: string[];
  foreign: string[];
  degradedReason?: string;
  durationMs: number;
  dryRun: boolean;
};
export class BackupAlreadyRunningError extends Error {
  constructor() {
    super("Another Elephant backup is running");
    this.name = "BackupAlreadyRunningError";
  }
}

export function backupEnvFrom(
  src: Record<string, string | undefined>,
): BackupEnv {
  const need = (key: string) => {
    if (!src[key]) throw new Error(`Missing ${key}`);
    return src[key]!;
  };
  const bucket = src.R2_BACKUP_BUCKET || "elephant-backups";
  // Retention must never run against the MusicalBasics bucket by accident.
  if (bucket !== "elephant-backups")
    throw new Error("R2_BACKUP_BUCKET must be elephant-backups");
  return {
    supabaseUrl: need("VITE_SUPABASE_URL"),
    serviceKey: need("ELEPHANT_SUPABASE_SERVICE_KEY"),
    workspaceId: src.ELEPHANT_WORKSPACE_ID || "desktop",
    r2AccountId: need("R2_ACCOUNT_ID"),
    r2AccessKeyId: need("R2_ACCESS_KEY_ID"),
    r2SecretAccessKey: need("R2_SECRET_ACCESS_KEY"),
    r2Bucket: bucket,
    resendApiKey: src.RESEND_API_KEY,
    alertTo: src.BACKUP_ALERT_EMAIL || "lionel@musicalbasics.com",
    alertFrom:
      src.RESEND_FROM_EMAIL || "Elephant Backups <lionel@musicalbasics.com>",
  };
}

function storage(env: BackupEnv) {
  if (env.r2Bucket !== "elephant-backups")
    throw new Error("R2_BACKUP_BUCKET must be elephant-backups");
  return new S3Client({
    region: "auto",
    endpoint: `https://${env.r2AccountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.r2AccessKeyId,
      secretAccessKey: env.r2SecretAccessKey,
    },
    maxAttempts: 3,
    requestHandler: { connectionTimeout: 10_000, requestTimeout: 30_000 },
  });
}
const sha256 = (body: Buffer) =>
  createHash("sha256").update(body).digest("hex");
const isMissing = (error: unknown) =>
  (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
    ?.httpStatusCode === 404;
const isConflict = (error: unknown) =>
  [409, 412].includes(
    (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
      ?.httpStatusCode ?? 0,
  );

export function validateSnapshot(
  value: unknown,
  workspaceId: string,
): Snapshot {
  const s = value as Snapshot;
  if (
    !s ||
    s.version !== 1 ||
    !Number.isFinite(Date.parse(s.taken_at)) ||
    !Array.isArray(s.tables) ||
    !Array.isArray(s.user_map) ||
    !s.schema ||
    SCHEMA_PARTS.some((key) => !Array.isArray(s.schema[key]))
  ) {
    throw new Error("Invalid database backup snapshot");
  }
  const names = new Set<string>();
  for (const table of s.tables) {
    if (
      !table ||
      !/^[a-zA-Z_][a-zA-Z0-9_$]*$/.test(table.name) ||
      !(
        table.schema === "elephant" ||
        (table.schema === "public" && table.name.startsWith("elephant_"))
      ) ||
      !Array.isArray(table.rows) ||
      !Array.isArray(table.primary_key) ||
      table.rows.some(
        (row) => !row || typeof row !== "object" || Array.isArray(row),
      )
    ) {
      throw new Error("Snapshot contains invalid or unrelated tables");
    }
    const name = `${table.schema}.${table.name}`;
    if (names.has(name)) throw new Error("Snapshot contains duplicate tables");
    names.add(name);
  }
  if (REQUIRED_TABLES.some((name) => !names.has(name)))
    throw new Error("Snapshot is missing required Elephant tables");
  if (
    !s.tables
      .find((t) => t.schema === "elephant" && t.name === "workspaces")!
      .rows.some((row) => row.id === workspaceId)
  ) {
    throw new Error(
      "Expected desktop workspace is missing; refusing to replace good backups with an empty snapshot",
    );
  }
  return s;
}

async function snapshotDatabase(
  env: BackupEnv,
  signal: AbortSignal,
): Promise<Snapshot> {
  // One STABLE service-only SQL function gives all tables the same database snapshot.
  const res = await fetch(
    `${env.supabaseUrl}/rest/v1/rpc/elephant_backup_snapshot`,
    {
      method: "POST",
      headers: {
        apikey: env.serviceKey,
        Authorization: `Bearer ${env.serviceKey}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      signal,
    },
  );
  // Never log response bodies: they can contain private workspace data.
  if (!res.ok) throw new Error(`Database snapshot failed (HTTP ${res.status})`);
  return validateSnapshot(await res.json(), env.workspaceId);
}

async function get(
  s3: S3Client,
  env: BackupEnv,
  key: string,
  signal?: AbortSignal,
) {
  const obj = await s3.send(
    new GetObjectCommand({ Bucket: env.r2Bucket, Key: key }),
    { abortSignal: signal },
  );
  if (!obj.Body) throw new Error("R2 returned an empty object response");
  return {
    body: Buffer.from(await obj.Body.transformToByteArray()),
    etag: obj.ETag,
  };
}
async function put(
  s3: S3Client,
  env: BackupEnv,
  key: string,
  body: Buffer,
  signal?: AbortSignal,
) {
  return s3.send(
    new PutObjectCommand({
      Bucket: env.r2Bucket,
      Key: key,
      Body: body,
      ContentType: key.endsWith(".gz")
        ? "application/gzip"
        : "application/json",
    }),
    { abortSignal: signal },
  );
}

async function acquireLock(
  s3: S3Client,
  env: BackupEnv,
  signal: AbortSignal,
): Promise<string> {
  const body = Buffer.from(
    JSON.stringify({ owner: randomUUID(), expires: Date.now() + 15 * 60_000 }),
  );
  const params = {
    Bucket: env.r2Bucket,
    Key: LOCK_KEY,
    Body: body,
    ContentType: "application/json",
  };
  try {
    const result = await s3.send(
      new PutObjectCommand({ ...params, IfNoneMatch: "*" }),
      { abortSignal: signal },
    );
    if (!result.ETag) throw new Error("R2 lock did not return an ETag");
    return result.ETag;
  } catch (error) {
    if (!isConflict(error)) throw error;
  }
  const current = await get(s3, env, LOCK_KEY, signal);
  const lock = JSON.parse(current.body.toString()) as { expires: number };
  if (
    !Number.isFinite(lock.expires) ||
    lock.expires > Date.now() ||
    !current.etag
  )
    throw new BackupAlreadyRunningError();
  try {
    const result = await s3.send(
      new PutObjectCommand({ ...params, IfMatch: current.etag }),
      { abortSignal: signal },
    );
    if (!result.ETag) throw new Error("R2 lock did not return an ETag");
    return result.ETag;
  } catch (error) {
    if (isConflict(error)) throw new BackupAlreadyRunningError();
    throw error;
  }
}
async function releaseLock(s3: S3Client, env: BackupEnv, etag: string) {
  // Conditional replacement cannot release a newer owner's lock, even after a timeout.
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: env.r2Bucket,
        Key: LOCK_KEY,
        IfMatch: etag,
        Body: JSON.stringify({ expires: 0 }),
        ContentType: "application/json",
      }),
      { abortSignal: AbortSignal.timeout(5_000) },
    );
  } catch (error) {
    if (!isConflict(error)) throw error;
  }
}

function validManifest(value: unknown, name: string): value is Manifest {
  const m = value as Manifest;
  if (
    !m ||
    m.version !== 1 ||
    m.scope !== SCOPE ||
    m.archive !== name ||
    m.status !== "ok" ||
    m.verified !== true ||
    !Array.isArray(m.files) ||
    !Array.isArray(m.tables) ||
    !m.files.length
  )
    return false;
  const keys = new Set<string>();
  for (const file of m.files) {
    if (
      !file ||
      !/^[a-zA-Z0-9_.$-]+\.(json|sql)\.gz$/.test(file.key) ||
      keys.has(file.key) ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 1
    )
      return false;
    keys.add(file.key);
  }
  return (
    [
      "schema.json.gz",
      "schema.sql.gz",
      "migrations.sql.gz",
      "user-map.json.gz",
      ...REQUIRED_TABLES.map((name) => `${name}.json.gz`),
    ].every((key) => keys.has(key)) &&
    m.tables.every((t) => keys.has(`${t.table}.json.gz`))
  );
}

async function listArchivePlan(
  s3: S3Client,
  env: BackupEnv,
  now: Date,
  signal?: AbortSignal,
) {
  const complete: string[] = [],
    ignored: string[] = [];
  let token: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: env.r2Bucket,
        Prefix: `${BACKUP_PREFIX}/`,
        Delimiter: "/",
        ContinuationToken: token,
      }),
      { abortSignal: signal },
    );
    for (const prefix of page.CommonPrefixes ?? []) {
      const name = (prefix.Prefix || "")
        .slice(BACKUP_PREFIX.length + 1)
        .replace(/\/$/, "");
      if (!parseArchiveName(name)) {
        ignored.push(name);
        continue;
      }
      try {
        const { body } = await get(
          s3,
          env,
          `${BACKUP_PREFIX}/${name}/manifest.json`,
          signal,
        );
        let manifest: unknown;
        try {
          manifest = JSON.parse(body.toString());
        } catch {
          ignored.push(name);
          continue;
        }
        if (validManifest(manifest, name)) complete.push(name);
        else ignored.push(name);
      } catch (error) {
        if (isMissing(error)) ignored.push(name);
        else throw error;
      }
    }
    token = page.NextContinuationToken;
  } while (token);
  const plan = planRetention(complete, now);
  return { ...plan, foreign: [...plan.foreign, ...ignored] };
}

async function deleteArchive(
  s3: S3Client,
  env: BackupEnv,
  name: string,
  signal: AbortSignal,
) {
  // Unpublish first. If cleanup fails, leftovers never count as a good backup.
  await s3.send(
    new DeleteObjectCommand({
      Bucket: env.r2Bucket,
      Key: `${BACKUP_PREFIX}/${name}/manifest.json`,
    }),
    { abortSignal: signal },
  );
  // List from the beginning each time: deleting while using continuation tokens can skip objects.
  for (;;) {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: env.r2Bucket,
        Prefix: `${BACKUP_PREFIX}/${name}/`,
      }),
      { abortSignal: signal },
    );
    const objects = (page.Contents || []).map((o) => ({ Key: o.Key! }));
    if (!objects.length) return;
    const result = await s3.send(
      new DeleteObjectsCommand({
        Bucket: env.r2Bucket,
        Delete: { Objects: objects, Quiet: true },
      }),
      { abortSignal: signal },
    );
    if (result.Errors?.length)
      throw new Error("R2 reported retention deletion errors");
  }
}

export async function planPrune(env: BackupEnv, now = new Date()) {
  const s3 = storage(env);
  try {
    return await listArchivePlan(s3, env, now, AbortSignal.timeout(120_000));
  } finally {
    s3.destroy();
  }
}

async function archiveFiles(snapshot: Snapshot) {
  const files = new Map<string, Buffer>();
  for (const table of snapshot.tables)
    files.set(
      `${table.schema}.${table.name}.json.gz`,
      gzipSync(JSON.stringify(table.rows)),
    );
  files.set(
    "schema.json.gz",
    gzipSync(
      JSON.stringify({
        ...snapshot.schema,
        primary_keys: snapshot.tables.map(({ schema, name, primary_key }) => ({
          schema,
          name,
          primary_key,
        })),
      }),
    ),
  );
  files.set("user-map.json.gz", gzipSync(JSON.stringify(snapshot.user_map)));
  const definitions = [
    "-- Apply migrations.sql first; this supplements it with live functions, indexes and triggers.",
    "-- Inspect schema.json for live columns, constraints, RLS policies and grants.",
  ];
  for (const kind of ["functions", "indexes", "triggers"]) {
    for (const row of snapshot.schema[kind] as Record<string, unknown>[]) {
      const definition = row.definition || row.indexdef;
      if (typeof definition === "string")
        definitions.push(`${definition.replace(/;\s*$/, "")};`);
    }
  }
  files.set("schema.sql.gz", gzipSync(definitions.join("\n\n")));
  const dir = join(process.cwd(), "supabase", "migrations");
  const migrations = (await readdir(dir))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();
  if (!migrations.length)
    throw new Error("Database migrations are missing from the deployment");
  const sql = await Promise.all(
    migrations.map(
      async (name) => `-- ${name}\n${await readFile(join(dir, name), "utf8")}`,
    ),
  );
  files.set("migrations.sql.gz", gzipSync(sql.join("\n\n")));
  return files;
}

export async function runDatabaseBackup(options: {
  env: BackupEnv;
  now?: Date;
  dryRun?: boolean;
  log?: (message: string) => void;
}): Promise<BackupResult> {
  const { env, dryRun = false, log = () => {} } = options;
  const started = Date.now(),
    now = options.now || new Date();
  const signal = AbortSignal.timeout(240_000);
  const s3 = storage(env);
  let lock: string | undefined;
  try {
    if (!dryRun) lock = await acquireLock(s3, env, signal);
    const snapshot = await snapshotDatabase(env, signal);
    const archive = archiveName(now);
    const files = await archiveFiles(snapshot);
    const tables = snapshot.tables.map((t) => ({
      table: `${t.schema}.${t.name}`,
      rows: t.rows.length,
      bytes: files.get(`${t.schema}.${t.name}.json.gz`)!.length,
    }));
    for (const table of tables)
      log(
        `${table.table}: ${table.rows} rows, ${table.bytes} compressed bytes`,
      );
    const manifest: Manifest = {
      version: 1,
      scope: SCOPE,
      archive,
      status: "ok",
      verified: true,
      taken_at: snapshot.taken_at,
      completed_at: new Date().toISOString(),
      project_ref: new URL(env.supabaseUrl).hostname.split(".")[0],
      commit:
        process.env.VERCEL_GIT_COMMIT_SHA || process.env.BACKUP_COMMIT || null,
      tables,
      files: [...files].map(([key, body]) => ({
        key,
        bytes: body.length,
        sha256: sha256(body),
      })),
      total_rows: tables.reduce((sum, t) => sum + t.rows, 0),
      total_bytes: [...files.values()].reduce(
        (sum, body) => sum + body.length,
        0,
      ),
    };
    if (!dryRun) {
      for (const [key, body] of files)
        await put(s3, env, `${BACKUP_PREFIX}/${archive}/${key}`, body, signal);
      // Read back every object before publishing a completed archive or deleting older copies.
      for (const file of manifest.files) {
        const { body } = await get(
          s3,
          env,
          `${BACKUP_PREFIX}/${archive}/${file.key}`,
          signal,
        );
        if (body.length !== file.bytes || sha256(body) !== file.sha256)
          throw new Error("Backup read-back checksum verification failed");
      }
      manifest.completed_at = new Date().toISOString();
      await put(
        s3,
        env,
        `${BACKUP_PREFIX}/${archive}/manifest.json`,
        Buffer.from(JSON.stringify(manifest, null, 2)),
        signal,
      );
      log(`Verified and published ${archive}`);
    }
    let plan: Awaited<ReturnType<typeof listArchivePlan>> = {
      keep: [archive],
      remove: [],
      foreign: [],
    };
    const pruned: string[] = [];
    let degradedReason: string | undefined;
    try {
      plan = await listArchivePlan(s3, env, now, signal);
      if (!dryRun)
        for (const name of plan.remove) {
          await deleteArchive(s3, env, name, signal);
          pruned.push(name);
        }
    } catch {
      // The data is safely stored; surface maintenance trouble separately.
      degradedReason = "Archive verified, but retention cleanup failed";
    }
    return {
      status: degradedReason ? "degraded" : "ok",
      archive,
      tables,
      totalRows: manifest.total_rows,
      totalBytes: manifest.total_bytes,
      kept: plan.keep,
      pruned: dryRun ? plan.remove : pruned,
      foreign: plan.foreign,
      degradedReason,
      durationMs: Date.now() - started,
      dryRun,
    };
  } finally {
    if (lock)
      await releaseLock(s3, env, lock).catch(() =>
        log(
          "Backup lock release failed; it expires automatically after 15 minutes",
        ),
      );
    s3.destroy();
  }
}

export async function readVerifiedArchive(
  env: BackupEnv,
  name: string,
): Promise<Map<string, Buffer>> {
  if (!parseArchiveName(name)) throw new Error("Invalid Elephant archive name");
  const s3 = storage(env),
    signal = AbortSignal.timeout(120_000);
  try {
    const { body } = await get(
      s3,
      env,
      `${BACKUP_PREFIX}/${name}/manifest.json`,
      signal,
    );
    const manifest: unknown = JSON.parse(body.toString());
    if (!validManifest(manifest, name))
      throw new Error("Archive has no valid completed manifest");
    const files = new Map<string, Buffer>();
    for (const file of manifest.files) {
      const { body } = await get(
        s3,
        env,
        `${BACKUP_PREFIX}/${name}/${file.key}`,
        signal,
      );
      if (body.length !== file.bytes || sha256(body) !== file.sha256)
        throw new Error(`Archive verification failed: ${file.key}`);
      files.set(file.key, body);
    }
    return files;
  } finally {
    s3.destroy();
  }
}

async function sendEmail(
  env: Pick<BackupEnv, "resendApiKey" | "alertFrom" | "alertTo">,
  subject: string,
  text: string,
  idempotencyKey?: string,
) {
  if (!env.resendApiKey)
    throw new Error("Missing RESEND_API_KEY for backup reports");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.resendApiKey}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from: env.alertFrom,
      to: env.alertTo,
      subject,
      text,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(`Backup report email failed (HTTP ${response.status})`);
}
export async function sendBackupEmail(
  env: BackupEnv,
  result: BackupResult,
  host: string,
) {
  const subject = `Elephant backup ${result.status.toUpperCase()} on ${host}: ${result.tables.length} tables, ${result.totalRows} rows`;
  await sendEmail(
    env,
    subject,
    [
      subject,
      `Archive: ${env.r2Bucket}/${BACKUP_PREFIX}/${result.archive}/`,
      `Size: ${(result.totalBytes / 1024).toFixed(1)} KB compressed; duration: ${(result.durationMs / 1000).toFixed(1)}s`,
      "All files read back and verified with SHA-256. Includes live schema metadata and migrations.",
      ...result.tables.map((t) => `${t.table}: ${t.rows} rows`),
      `Retained: ${result.kept.length}; pruned: ${result.pruned.length}; ignored incomplete/foreign: ${result.foreign.length}`,
      result.degradedReason || "",
      "Restore instructions: docs/backups.md in the Elephant repository.",
    ]
      .filter(Boolean)
      .join("\n"),
    `elephant-backup-${result.archive}`,
  );
}
export async function sendBackupFailureEmail(
  src: Record<string, string | undefined>,
  _error: unknown,
  host: string,
) {
  // Provider exceptions can contain private payloads. Keep failure mail generic; inspect server logs by stage.
  await sendEmail(
    {
      resendApiKey: src.RESEND_API_KEY,
      alertTo: src.BACKUP_ALERT_EMAIL || "lionel@musicalbasics.com",
      alertFrom:
        src.RESEND_FROM_EMAIL || "Elephant Backups <lionel@musicalbasics.com>",
    },
    `Elephant backup FAILED on ${host}`,
    "The backup job or its success report failed. Check Vercel function logs and the most recent completed R2 manifest. Existing completed archives are preserved on snapshot/upload failures. Run node scripts/db/backup.mjs to retry.",
  );
}
