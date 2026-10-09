import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BackupAlreadyRunningError,
  backupEnvFrom,
  planPrune,
  readVerifiedArchive,
  runDatabaseBackup,
  validateSnapshot,
} from "./db-backup";
import type { BackupEnv, Snapshot } from "./db-backup";
import { archiveName } from "./retention";

const now = new Date("2026-10-09T12:00:00.000Z");
const env: BackupEnv = {
  supabaseUrl: "https://elephant-test.supabase.co",
  serviceKey: "test-service-key",
  workspaceId: "desktop",
  r2AccountId: "test-account",
  r2AccessKeyId: "test-access-key",
  r2SecretAccessKey: "test-secret-key",
  r2Bucket: "elephant-backups",
  alertTo: "owner@example.test",
  alertFrom: "backups@example.test",
};
const previous = archiveName(
  new Date("2026-10-09T03:30:00Z"),
  false,
  "00000001",
);
const prefix = (archive: string) => `backups/${archive}/`;
const sha256 = (body: Buffer) =>
  createHash("sha256").update(body).digest("hex");

function snapshot(): Snapshot {
  return {
    version: 1,
    taken_at: now.toISOString(),
    tables: [
      {
        schema: "elephant",
        name: "workspaces",
        primary_key: ["id"],
        rows: [
          { id: "desktop", data: { tasks: [{ title: "Retain this task" }] } },
        ],
      },
      {
        schema: "elephant",
        name: "workspace_revisions",
        primary_key: ["id"],
        rows: [{ id: "revision-1", workspace_id: "desktop", revision: 1 }],
      },
    ],
    user_map: [{ id: "owner-id", email: "owner@example.test" }],
    schema: {
      columns: [],
      constraints: [],
      indexes: [],
      functions: [],
      triggers: [],
      policies: [],
      grants: [],
    },
  };
}

type StorageCommand =
  | PutObjectCommand
  | GetObjectCommand
  | ListObjectsV2Command
  | DeleteObjectCommand
  | DeleteObjectsCommand;
type Operation = { kind: string; key: string };

/** R2-like conditional object writes and independently returned object bodies. */
class MemoryR2 {
  objects = new Map<string, { body: Buffer; etag: string }>();
  operations: Operation[] = [];
  failPutSuffix?: string;
  corruptGetSuffix?: string;
  reportDeleteError = false;
  pageSize = 1000;
  private version = 0;

  seed(key: string, body: Buffer | string) {
    this.objects.set(key, {
      body: Buffer.from(body),
      etag: `"etag-${++this.version}"`,
    });
  }

  async send(command: StorageCommand): Promise<Record<string, unknown>> {
    const kind = command.constructor.name;
    const key =
      "Key" in command.input
        ? command.input.Key || ""
        : "Prefix" in command.input
          ? command.input.Prefix || ""
          : "";
    this.operations.push({ kind, key });
    expect(command.input.Bucket).toBe("elephant-backups");
    if (command instanceof PutObjectCommand) {
      const input = command.input;
      const current = this.objects.get(key);
      if (
        (input.IfNoneMatch === "*" && current) ||
        (input.IfMatch && current?.etag !== input.IfMatch)
      ) {
        throw Object.assign(new Error("Conditional write failed"), {
          $metadata: { httpStatusCode: 412 },
        });
      }
      if (this.failPutSuffix && key.endsWith(this.failPutSuffix))
        throw new Error("Injected upload failure");
      const body = input.Body;
      if (typeof body !== "string" && !(body instanceof Uint8Array))
        throw new Error("Unexpected upload body");
      this.seed(key, Buffer.from(body));
      return { ETag: this.objects.get(key)!.etag };
    }
    if (command instanceof GetObjectCommand) {
      const object = this.objects.get(key);
      if (!object)
        throw Object.assign(new Error("No such key"), {
          $metadata: { httpStatusCode: 404 },
        });
      const body = Buffer.from(object.body);
      if (this.corruptGetSuffix && key.endsWith(this.corruptGetSuffix))
        body[0] ^= 0xff;
      return {
        Body: { transformToByteArray: async () => Uint8Array.from(body) },
        ETag: object.etag,
      };
    }
    if (command instanceof ListObjectsV2Command) {
      const input = command.input;
      const keys = [...this.objects.keys()]
        .filter((candidate) => candidate.startsWith(input.Prefix || ""))
        .sort();
      const offset = Number(input.ContinuationToken || 0);
      if (input.Delimiter) {
        const prefixes = [
          ...new Set(
            keys.flatMap((candidate) => {
              const rest = candidate.slice((input.Prefix || "").length);
              return rest.includes("/")
                ? [`${input.Prefix}${rest.split("/")[0]}/`]
                : [];
            }),
          ),
        ];
        const page = prefixes.slice(offset, offset + this.pageSize);
        return {
          CommonPrefixes: page.map((Prefix) => ({ Prefix })),
          NextContinuationToken:
            offset + page.length < prefixes.length
              ? String(offset + page.length)
              : undefined,
        };
      }
      const page = keys.slice(offset, offset + this.pageSize);
      return {
        Contents: page.map((Key) => ({ Key })),
        NextContinuationToken:
          offset + page.length < keys.length
            ? String(offset + page.length)
            : undefined,
      };
    }
    if (command instanceof DeleteObjectCommand) {
      this.objects.delete(key);
      return {};
    }
    if (command instanceof DeleteObjectsCommand) {
      if (this.reportDeleteError)
        return {
          Errors: [
            {
              Key: command.input.Delete?.Objects?.[0].Key,
              Code: "AccessDenied",
            },
          ],
        };
      for (const object of command.input.Delete?.Objects || [])
        this.objects.delete(object.Key!);
      return {};
    }
    throw new Error(`Unexpected command ${kind}`);
  }
}

function seedArchive(store: MemoryR2, archive = previous) {
  const files = [
    "elephant.workspaces.json.gz",
    "elephant.workspace_revisions.json.gz",
    "schema.json.gz",
    "schema.sql.gz",
    "migrations.sql.gz",
    "user-map.json.gz",
  ].map((key) => {
    const body = gzipSync(JSON.stringify({ old: true }));
    store.seed(`${prefix(archive)}${key}`, body);
    return { key, bytes: body.length, sha256: sha256(body) };
  });
  const manifest = {
    version: 1,
    scope: "elephant-v1",
    archive,
    status: "ok",
    verified: true,
    taken_at: "2026-10-09T03:30:00Z",
    completed_at: "2026-10-09T03:30:01Z",
    tables: [
      { table: "elephant.workspaces", rows: 1 },
      { table: "elephant.workspace_revisions", rows: 1 },
    ],
    files,
    total_rows: 2,
    total_bytes: files.reduce((total, file) => total + file.bytes, 0),
  };
  store.seed(`${prefix(archive)}manifest.json`, JSON.stringify(manifest));
  return manifest;
}

let r2: MemoryR2;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  r2 = new MemoryR2();
  vi.spyOn(S3Client.prototype, "send").mockImplementation(
    r2.send.bind(r2) as never,
  );
  fetchMock = vi.fn(async () => Response.json(snapshot()));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("publishing and retention safety", () => {
  it("reads back every uploaded file before publishing and only then prunes old archives", async () => {
    seedArchive(r2);
    r2.pageSize = 2; // Exercise paginated deletion by listing afresh after each batch.
    const result = await runDatabaseBackup({ env, now });
    expect(result).toMatchObject({
      status: "ok",
      totalRows: 2,
      pruned: [previous],
      kept: [result.archive],
    });
    const archivePrefix = prefix(result.archive);
    const manifestKey = `${archivePrefix}manifest.json`;
    const manifest = JSON.parse(r2.objects.get(manifestKey)!.body.toString());
    expect(manifest).toMatchObject({
      scope: "elephant-v1",
      verified: true,
      status: "ok",
      total_rows: 2,
    });
    const publishIndex = r2.operations.findIndex(
      (op) => op.kind === "PutObjectCommand" && op.key === manifestKey,
    );
    for (const file of manifest.files as {
      key: string;
      bytes: number;
      sha256: string;
    }[]) {
      const key = `${archivePrefix}${file.key}`;
      const uploadIndex = r2.operations.findIndex(
        (op) => op.kind === "PutObjectCommand" && op.key === key,
      );
      const readIndex = r2.operations.findIndex(
        (op) => op.kind === "GetObjectCommand" && op.key === key,
      );
      expect(uploadIndex).toBeGreaterThan(-1);
      expect(readIndex).toBeGreaterThan(uploadIndex);
      expect(publishIndex).toBeGreaterThan(readIndex);
      const body = r2.objects.get(key)!.body;
      expect(body.length).toBe(file.bytes);
      expect(sha256(body)).toBe(file.sha256);
    }
    const firstDelete = r2.operations.findIndex((op) =>
      op.kind.startsWith("Delete"),
    );
    expect(firstDelete).toBeGreaterThan(publishIndex);
    expect(r2.operations[firstDelete]).toEqual({
      kind: "DeleteObjectCommand",
      key: `${prefix(previous)}manifest.json`,
    });
    expect(
      [...r2.objects.keys()].some((key) => key.startsWith(prefix(previous))),
    ).toBe(false);
    const workspace = JSON.parse(
      gunzipSync(
        r2.objects.get(`${archivePrefix}elephant.workspaces.json.gz`)!.body,
      ).toString(),
    );
    expect(workspace).toEqual(snapshot().tables[0].rows);
    expect(
      gunzipSync(
        r2.objects.get(`${archivePrefix}migrations.sql.gz`)!.body,
      ).toString(),
    ).toContain("-- ");
    expect(fetchMock).toHaveBeenCalledWith(
      `${env.supabaseUrl}/rest/v1/rpc/elephant_backup_snapshot`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-service-key",
        }),
        body: "{}",
      }),
    );
    expect(
      JSON.parse(r2.objects.get("backups/.lock.json")!.body.toString()).expires,
    ).toBe(0);
  });

  it.each(["readback", "upload"])(
    "does not publish or prune after a %s failure",
    async (failure) => {
      seedArchive(r2);
      const previousKeys = [...r2.objects.keys()];
      if (failure === "readback") r2.corruptGetSuffix = "schema.json.gz";
      else r2.failPutSuffix = "schema.json.gz";
      await expect(runDatabaseBackup({ env, now })).rejects.toThrow(
        failure === "readback" ? /checksum/ : /upload/,
      );
      expect(
        r2.operations.filter(
          (op) =>
            op.kind === "PutObjectCommand" && op.key.endsWith("manifest.json"),
        ),
      ).toEqual([]);
      expect(
        r2.operations.filter((op) => op.kind.startsWith("Delete")),
      ).toEqual([]);
      expect(previousKeys.every((key) => r2.objects.has(key))).toBe(true);
      expect(
        JSON.parse(r2.objects.get("backups/.lock.json")!.body.toString())
          .expires,
      ).toBe(0);
    },
  );

  it("ignores missing, malformed and foreign manifests across listing pages", async () => {
    seedArchive(r2);
    const missing = archiveName(
      new Date("2026-10-09T04:00:00Z"),
      false,
      "00000002",
    );
    const invalid = archiveName(
      new Date("2026-10-09T05:00:00Z"),
      false,
      "00000003",
    );
    const wrongScope = archiveName(
      new Date("2026-10-09T06:00:00Z"),
      false,
      "00000004",
    );
    r2.seed(`${prefix(missing)}schema.json.gz`, gzipSync("{}"));
    r2.seed(`${prefix(invalid)}manifest.json`, "not JSON");
    const other = seedArchive(r2, wrongScope);
    r2.seed(
      `${prefix(wrongScope)}manifest.json`,
      JSON.stringify({ ...other, scope: "another-app" }),
    );
    r2.seed("backups/handmade/notes.txt", "do not touch");
    r2.pageSize = 1;
    const plan = await planPrune(env, now);
    expect(plan.keep).toEqual([previous]);
    expect(plan.remove).toEqual([]);
    expect(new Set(plan.foreign)).toEqual(
      new Set([missing, invalid, wrongScope, "handmade"]),
    );
    expect(
      r2.operations.some(
        (op) => op.kind.startsWith("Delete") || op.kind === "PutObjectCommand",
      ),
    ).toBe(false);
  });

  it("reports per-object deletion errors as degraded after safely publishing the new archive", async () => {
    seedArchive(r2);
    r2.reportDeleteError = true;
    const result = await runDatabaseBackup({ env, now });
    expect(result).toMatchObject({
      status: "degraded",
      pruned: [],
      degradedReason: "Archive verified, but retention cleanup failed",
    });
    expect(r2.objects.has(`${prefix(result.archive)}manifest.json`)).toBe(true);
    expect(r2.objects.has(`${prefix(previous)}manifest.json`)).toBe(false);
    expect(
      [...r2.objects.keys()].some((key) => key.startsWith(prefix(previous))),
    ).toBe(true);
  });

  it("performs no writes or deletes during a dry run", async () => {
    seedArchive(r2);
    const before = new Map(
      [...r2.objects].map(([key, value]) => [
        key,
        value.body.toString("base64"),
      ]),
    );
    const result = await runDatabaseBackup({ env, now, dryRun: true });
    expect(result).toMatchObject({ status: "ok", dryRun: true, totalRows: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      r2.operations.every((op) =>
        ["GetObjectCommand", "ListObjectsV2Command"].includes(op.kind),
      ),
    ).toBe(true);
    expect(
      new Map(
        [...r2.objects].map(([key, value]) => [
          key,
          value.body.toString("base64"),
        ]),
      ),
    ).toEqual(before);
  });
});

describe("backup locks and archive verification", () => {
  it("rejects an active lock before reading the database or changing any archive", async () => {
    const existing = JSON.stringify({
      owner: "other-run",
      expires: Date.now() + 60_000,
    });
    r2.seed("backups/.lock.json", existing);
    await expect(runDatabaseBackup({ env, now })).rejects.toBeInstanceOf(
      BackupAlreadyRunningError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r2.objects.get("backups/.lock.json")!.body.toString()).toBe(
      existing,
    );
    expect([...r2.objects.keys()]).toEqual(["backups/.lock.json"]);
  });

  it("replaces an expired lock conditionally and completes a backup", async () => {
    r2.seed(
      "backups/.lock.json",
      JSON.stringify({ owner: "expired-run", expires: Date.now() - 1 }),
    );
    expect((await runDatabaseBackup({ env, now })).status).toBe("ok");
    expect(
      r2.operations.filter(
        (op) =>
          op.key === "backups/.lock.json" && op.kind === "PutObjectCommand",
      ),
    ).toHaveLength(3);
  });

  it("returns verified archive files and refuses checksum mismatches", async () => {
    const manifest = seedArchive(r2);
    const files = await readVerifiedArchive(env, previous);
    expect(files.size).toBe(manifest.files.length);
    expect([...files.keys()]).toEqual(manifest.files.map((file) => file.key));
    const key = `${prefix(previous)}user-map.json.gz`;
    const body = Buffer.from(r2.objects.get(key)!.body);
    body[body.length - 1] ^= 0xff; // Keep the length equal so SHA-256 must catch this.
    r2.seed(key, body);
    await expect(readVerifiedArchive(env, previous)).rejects.toThrow(
      "Archive verification failed: user-map.json.gz",
    );
    await expect(readVerifiedArchive(env, "../other-app")).rejects.toThrow(
      "Invalid Elephant archive name",
    );
  });

  it("rejects incomplete manifests before reading archive payloads", async () => {
    const manifest = seedArchive(r2);
    r2.seed(
      `${prefix(previous)}manifest.json`,
      JSON.stringify({ ...manifest, files: manifest.files.slice(1) }),
    );
    await expect(readVerifiedArchive(env, previous)).rejects.toThrow(
      "Archive has no valid completed manifest",
    );
    expect(r2.operations).toEqual([
      { kind: "GetObjectCommand", key: `${prefix(previous)}manifest.json` },
    ]);
  });
});

describe("snapshot and environment boundaries", () => {
  it("accepts Elephant tables and the expected desktop workspace", () => {
    const value = snapshot();
    value.tables.push({
      schema: "public",
      name: "elephant_settings",
      primary_key: ["id"],
      rows: [],
    });
    expect(validateSnapshot(value, "desktop")).toBe(value);
  });

  it("rejects unrelated tables, missing required tables, and a missing desktop", () => {
    const unrelated = snapshot();
    unrelated.tables.push({
      schema: "public",
      name: "orders",
      primary_key: ["id"],
      rows: [],
    });
    expect(() => validateSnapshot(unrelated, "desktop")).toThrow(
      /unrelated tables/,
    );
    const missing = snapshot();
    missing.tables.pop();
    expect(() => validateSnapshot(missing, "desktop")).toThrow(
      /missing required Elephant tables/,
    );
    const empty = snapshot();
    empty.tables[0].rows = [];
    expect(() => validateSnapshot(empty, "desktop")).toThrow(
      /desktop workspace is missing/,
    );
    const duplicate = snapshot();
    duplicate.tables.push(duplicate.tables[0]);
    expect(() => validateSnapshot(duplicate, "desktop")).toThrow(
      /duplicate tables/,
    );
  });

  it("rejects malformed schema snapshots", () => {
    const value = snapshot();
    delete value.schema.grants;
    expect(() => validateSnapshot(value, "desktop")).toThrow(
      "Invalid database backup snapshot",
    );
    expect(() => validateSnapshot(null, "desktop")).toThrow(
      "Invalid database backup snapshot",
    );
  });

  it("protects the designated bucket and requires backup service credentials", () => {
    const values = {
      VITE_SUPABASE_URL: env.supabaseUrl,
      ELEPHANT_SUPABASE_SERVICE_KEY: env.serviceKey,
      R2_ACCOUNT_ID: env.r2AccountId,
      R2_ACCESS_KEY_ID: env.r2AccessKeyId,
      R2_SECRET_ACCESS_KEY: env.r2SecretAccessKey,
    };
    expect(backupEnvFrom(values)).toMatchObject({
      r2Bucket: "elephant-backups",
      workspaceId: "desktop",
    });
    expect(() =>
      backupEnvFrom({ ...values, R2_BACKUP_BUCKET: "musicalbasics-backups" }),
    ).toThrow("R2_BACKUP_BUCKET must be elephant-backups");
    expect(() =>
      backupEnvFrom({ ...values, ELEPHANT_SUPABASE_SERVICE_KEY: undefined }),
    ).toThrow("Missing ELEPHANT_SUPABASE_SERVICE_KEY");
  });
});
