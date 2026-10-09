import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../api/db-backup";

const backup = vi.hoisted(() => ({
  envFrom: vi.fn(),
  run: vi.fn(),
  email: vi.fn(),
  failureEmail: vi.fn(),
  AlreadyRunning: class BackupAlreadyRunningError extends Error {},
}));

vi.mock("./backup/db-backup.ts", () => ({
  backupEnvFrom: backup.envFrom,
  runDatabaseBackup: backup.run,
  sendBackupEmail: backup.email,
  sendBackupFailureEmail: backup.failureEmail,
  BackupAlreadyRunningError: backup.AlreadyRunning,
}));

const secret = "cron-private-test-secret";
const request = (authorization: string | undefined = `Bearer ${secret}`) =>
  new Request("https://elephant.test/api/db-backup", {
    headers: authorization === undefined ? {} : { authorization },
  });
const env = {
  databaseUrl: "https://database.test",
  bucket: "elephant-backups",
};
const result = {
  status: "ok" as const,
  archive: "backups/2026-10-09T03-30-00Z.tar.gz",
  tables: [{ table: "workspaces", rows: 2, bytes: 400 }],
  totalRows: 2,
  totalBytes: 400,
  pruned: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", secret);
  vi.stubEnv("BACKUP_ALERT_SUCCESS", "");
  backup.envFrom.mockReset().mockReturnValue(env);
  backup.run.mockReset().mockResolvedValue(result);
  backup.email.mockReset().mockResolvedValue(undefined);
  backup.failureEmail.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("authenticated database backup cron", () => {
  it.each([
    "",
    "Bearer wrong",
    "Bearer",
    `Bearer ${secret} extra`,
    `Basic ${secret}`,
  ])(
    "rejects invalid authorization without any side effects (%s)",
    async (authorization) => {
      const response = await GET(request(authorization));
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(backup.envFrom).not.toHaveBeenCalled();
      expect(backup.run).not.toHaveBeenCalled();
      expect(backup.email).not.toHaveBeenCalled();
      expect(backup.failureEmail).not.toHaveBeenCalled();
    },
  );

  it("rejects a missing authorization header", async () => {
    const response = await GET(
      new Request("https://elephant.test/api/db-backup"),
    );
    expect(response.status).toBe(401);
    expect(backup.envFrom).not.toHaveBeenCalled();
    expect(backup.run).not.toHaveBeenCalled();
    expect(backup.failureEmail).not.toHaveBeenCalled();
  });

  it("fails closed when the cron secret is not configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(request("Bearer undefined"))).status).toBe(401);
    expect(backup.envFrom).not.toHaveBeenCalled();
    expect(backup.run).not.toHaveBeenCalled();
    expect(backup.failureEmail).not.toHaveBeenCalled();
  });

  it("runs once, sends a receipt, and prevents response caching", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Authorization");
    expect(await response.json()).toEqual(result);
    expect(backup.envFrom).toHaveBeenCalledWith(process.env);
    expect(backup.run).toHaveBeenCalledExactlyOnceWith({
      env,
      log: expect.any(Function),
    });
    expect(backup.email).toHaveBeenCalledExactlyOnceWith(
      env,
      result,
      "elephant.test",
    );
    expect(backup.failureEmail).not.toHaveBeenCalled();
  });

  it("can suppress successful receipts without suppressing the backup", async () => {
    vi.stubEnv("BACKUP_ALERT_SUCCESS", "off");
    expect((await GET(request())).status).toBe(200);
    expect(backup.run).toHaveBeenCalledTimes(1);
    expect(backup.email).not.toHaveBeenCalled();
  });

  it("still sends a degraded warning when successful receipts are disabled", async () => {
    vi.stubEnv("BACKUP_ALERT_SUCCESS", "off");
    const degraded = {
      ...result,
      status: "degraded",
      degradedReason: "Previous backup was larger.",
    };
    backup.run.mockResolvedValue(degraded);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(degraded);
    expect(backup.email).toHaveBeenCalledExactlyOnceWith(
      env,
      degraded,
      "elephant.test",
    );
  });

  it("alerts using raw notification configuration when backup configuration is missing", async () => {
    const error = new Error("Missing database configuration.");
    backup.envFrom.mockImplementation(() => {
      throw error;
    });
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(backup.run).not.toHaveBeenCalled();
    expect(backup.failureEmail).toHaveBeenCalledExactlyOnceWith(
      process.env,
      error,
      "elephant.test",
    );
  });

  it("does not retry a failed backup or leak provider details to responses and logs", async () => {
    const error = new Error(
      "Provider response: private-service-token workspace-content",
    );
    backup.run.mockRejectedValue(error);
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(backup.run).toHaveBeenCalledTimes(1);
    expect(backup.failureEmail).toHaveBeenCalledExactlyOnceWith(
      process.env,
      error,
      "elephant.test",
    );
    expect(await response.text()).not.toContain("private-service-token");
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(
      "private-service-token",
    );
  });

  it("does not log raw progress messages", async () => {
    backup.run.mockImplementation(async ({ log }) => {
      log("Provider body: private-service-token workspace-content");
      return result;
    });
    expect((await GET(request())).status).toBe(200);
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(
      "private-service-token",
    );
  });

  it("reports receipt failure without performing the completed backup again", async () => {
    backup.email.mockRejectedValue(new Error("Private provider response"));
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(backup.run).toHaveBeenCalledTimes(1);
    expect(backup.email).toHaveBeenCalledTimes(1);
    expect(backup.failureEmail).toHaveBeenCalledExactlyOnceWith(
      process.env,
      expect.objectContaining({
        message: "Backup archive was created, but its notification failed.",
      }),
      "elephant.test",
    );
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(
      "Private provider response",
    );
  });

  it("keeps the error response generic even when the failure alert also fails", async () => {
    backup.run.mockRejectedValue(new Error("Database secret"));
    backup.failureEmail.mockRejectedValue(new Error("Email secret"));
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Database backup failed. Check backup alerts and server logs.",
    });
    expect(backup.failureEmail).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(
      /Database secret|Email secret/,
    );
  });

  it("rejects overlapping runs without sending a failure alert", async () => {
    backup.run.mockRejectedValue(
      new backup.AlreadyRunning("Lease already held"),
    );
    const response = await GET(request());
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(backup.run).toHaveBeenCalledTimes(1);
    expect(backup.email).not.toHaveBeenCalled();
    expect(backup.failureEmail).not.toHaveBeenCalled();
  });
});
