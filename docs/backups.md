# Elephant backups

Configured on 2026-10-09. Production activation is tied to the Vercel
deployment of the cron configuration below.

Elephant's synced data lives in the Supabase project used by
`VITE_SUPABASE_URL`. The project is shared with another app. These backups
cover Elephant's tables and schema metadata only, and save them outside
Supabase in the private Cloudflare R2 bucket **`elephant-backups`**, under
**`backups/`**.

The schedule and grandfather-father-son retention follow MusicalBasics'
backup methodology. Elephant uses a restricted database RPC because its
desktop workspace lives in a private schema. The RPC exports the tables in
one consistent database snapshot, including their current schema metadata,
without a hosted Supabase personal access token.

## Schedule and existing recovery layers

| Layer | Location | When | Coverage |
|---|---|---|---|
| Hosted backup | R2 `elephant-backups/backups/` | Daily; Vercel cron `30 3 * * *` (03:30 UTC) | Synced Elephant tables, schema metadata, migrations, account identity map |
| Manual backup | Same R2 prefix | `node scripts/db/backup.mjs` | Same export and retention as the hosted job |
| Workspace revisions | Supabase `elephant.workspace_revisions` | Each desktop workspace save | Original revision and latest 50 saves; included in the R2 backup |
| Downloaded workspace JSON | Wherever you save the file | Settings → Download JSON backup | Current workspace, including local edits visible in that browser |

The hosted job is `GET /api/db-backup`. Vercel supplies the bearer token
configured in `CRON_SECRET`; unauthenticated requests are rejected. The job
runs independently of this laptop. UTC does not change for daylight saving
time.

Code remains in Git/GitHub. Each archive also includes the repository's
database migrations to make recovery independent of the running deployment.

## What a run saves

1. Acquires an R2 lock so manual and hosted runs cannot prune each other's
   in-progress backups. A stale lock expires after 15 minutes.
2. Calls `public.elephant_backup_snapshot()` with the server's Supabase
   service key. The RPC is `STABLE`, uses an empty search path, and grants
   execution only to `service_role`. It does not change workspace data or
   expose the private schema through the Data API.
3. Automatically discovers regular tables and partition roots in
   `elephant`, plus `public` tables whose names begin with `elephant_`.
   Partition children are not exported twice. The required desktop tables
   and configured desktop workspace must exist; missing data fails the run.
4. Exports every row from those tables from the same database snapshot.
   Current tables include `elephant.workspaces`,
   `elephant.workspace_revisions`, and the optional account table
   `public.elephant_workspaces`.
5. Saves live column, constraint, index, function, trigger, RLS policy,
   permission, and table metadata. Saves UUID/email mappings only for users
   referenced by Elephant's account workspaces.
6. Uploads the compressed files, downloads every file again, and checks its
   byte length and SHA-256 checksum. Only then does it publish
   `manifest.json`, which marks an archive as complete.
7. Prunes completed archives according to the retention schedule below and
   sends the backup report.

An archive has a unique UTC timestamp and random run suffix, for example
`elephant-2026-10-09-033000000-a1b2c3d4`.

| File within an archive | Contents |
|---|---|
| `<schema>.<table>.json.gz` | Every row of that table, as a gzipped JSON array |
| `schema.json.gz` | Live schema metadata |
| `schema.sql.gz` | Supplemental function, index, and trigger definitions |
| `migrations.sql.gz` | All repository migrations in filename order |
| `user-map.json.gz` | Elephant account users' original UUID/email pairs |
| `manifest.json` | Scope, timestamps, commit, table counts, file sizes, and checksums |

The archives contain private workspace content, including diary entries and
profile data. Keep the bucket private and treat downloaded backups as private
files. No backup needs the private workspace connection link.

## Retention

The newest completed archive wins within each time bucket:

| Archive age | Retained |
|---|---|
| Under 7 days | One per UTC day |
| 7 to under 35 days | One per ISO week, starting Monday |
| 35 to under 400 days | One per calendar month |
| 400 days and older | One per calendar year, indefinitely |

This normally settles at roughly 25 archives for the first year, then adds
one per year. The archive count depends on when successful backups ran.

Retention considers only recognized Elephant archives with valid completed
manifests. Unfinished uploads, invalid manifests, foreign folders, and
future-dated archives are left alone. A failed snapshot or upload cannot
displace a completed backup. Incomplete folders may need later manual
cleanup after their contents have been inspected.

Before deleting an old archive, the job removes its completed manifest.
If object cleanup then fails, its remaining files cannot be mistaken for a
complete backup.

## Reports and troubleshooting

Reports go to `BACKUP_ALERT_EMAIL`, defaulting to
`lionel@musicalbasics.com`, through Resend.

- **OK:** the archive was uploaded, read back, and verified, and retention
  completed.
- **DEGRADED:** the archive is verified and usable, but retention cleanup
  failed. Check storage permissions and the job logs.
- **FAILED:** the job or its report failed. Check Vercel function logs and
  the newest completed R2 manifest. A notification failure can occur after
  the archive was successfully saved.
- **Already running / HTTP 409:** another backup holds the lock. Wait for
  that run to finish; abandoned locks expire automatically.

`BACKUP_ALERT_SUCCESS=off` suppresses only successful reports. Missing mail
can also mean the scheduler or email provider failed before a report could
be sent; inspect Vercel's cron execution and R2's latest manifest rather than
assuming a silent run succeeded. A failed run can be retried manually.

## Running manually

Run from the repository root with Node 22.18 or newer. The CLI loads local
configuration from `.env.local`.

```sh
node scripts/db/backup.mjs
node scripts/db/backup.mjs --dry-run
node scripts/db/backup.mjs --prune-dry-run
node scripts/db/backup.mjs --no-email
```

The normal command snapshots, uploads, verifies, prunes, and reports.
`--dry-run` reads the database and storage and plans work without writing
archives, deleting objects, or sending mail. `--prune-dry-run` only inspects
stored archives and reports the retention plan. `--no-email` performs a
normal backup without the report.

Required server configuration:

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Elephant's Supabase project URL; this URL is public |
| `ELEPHANT_SUPABASE_SERVICE_KEY` | Server-only service key for the snapshot RPC |
| `ELEPHANT_WORKSPACE_ID` | Expected desktop workspace, default `desktop` |
| `R2_ACCOUNT_ID` | Cloudflare account |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | R2 object credentials |
| `R2_BACKUP_BUCKET` | `elephant-backups`; another bucket is rejected |
| `CRON_SECRET` | Bearer secret for Vercel's hosted endpoint |
| `RESEND_API_KEY` | Backup report delivery |
| `BACKUP_ALERT_EMAIL` | Report recipient |
| `RESEND_FROM_EMAIL` | Verified sender, default `Elephant Backups <lionel@musicalbasics.com>` |

Keep keys and tokens server-side; never give them a `VITE_` prefix. Do not
commit `.env.local`. The hosted job does not use `SUPABASE_ACCESS_TOKEN` and
does not require a personal token to discover new Elephant tables or capture
the schema. R2 credentials need read, write, list, and delete access to the
backup bucket.

## Restore one desktop workspace

Use the full archive folder name from its manifest or backup report:

```sh
node scripts/db/restore-workspace.mjs ARCHIVE OUTPUT_FILE [WORKSPACE_ID]
```

For example:

```sh
node scripts/db/restore-workspace.mjs elephant-2026-10-09-033000000-a1b2c3d4 /tmp/elephant-restored.json desktop
```

This command downloads and verifies **every file in the completed archive**
against the manifest before writing an importable workspace JSON file. It
does not write to Supabase or change the running workspace. The example
archive name is illustrative; use an archive that actually exists.

Preserve a fresh export of the current workspace first. In Elephant, open
Settings → Restore JSON backup, select the generated JSON file, inspect the
confirmation, and restore it. The app uses its normal revision-checked save
path. Confirm **Saved to Supabase** before assuming the restored workspace
has reached other devices.

The table archives also include saved desktop revisions. Recovering a
particular historical revision or an account workspace requires extracting
that row's `data` value into an importable JSON file and checking it before
using the same app restore flow.

## Full database recovery

There is no unattended whole-database restore command. Restore into an
isolated target first and verify its contents before replacing production
data. These archives cover Elephant, not the other app sharing the source
project.

1. Download a completed archive and verify every file against its manifest.
2. Recreate the Elephant schema using the archived migrations in order.
   Inspect live metadata for changes made after those migrations. The
   supplemental `schema.sql` is reference material: blindly applying it
   after migrations can encounter duplicate indexes and triggers. It is not
   a complete standalone database dump.
3. Reestablish account identities before importing account workspaces.
   `user-map.json` records UUID/email associations but contains no passwords,
   sessions, or full Auth records. If recreated accounts have different
   UUIDs, explicitly remap `public.elephant_workspaces.user_id` to the intended
   verified accounts. A new magic-link login alone does not preserve the old
   UUID or reconnect its workspace.
4. Load table rows in foreign-key order. Handle Elephant's version and
   snapshot triggers deliberately: ordinary inserts or updates change
   revisions, create history entries, and may prune history. A raw historical
   restore must preserve the archived revision values and avoid duplicate
   snapshots. Any temporary trigger changes belong only on the intended
   target tables, with their original state restored afterward.
5. Check constraints, row counts, workspace contents, revisions, RLS, grants,
   and application access before allowing normal writes again. If future
   tables introduce sequences, custom types, or partitions, verify their
   setup and sequence positions separately; JSON row exports are not a full
   `pg_dump` replacement.

## Outside the backup scope

- Unsynced browser changes, unconnected local workspaces, and browser recovery
  copies. Use the app's JSON download for these.
- Unsent diary drafts and browser-only preferences such as editor size.
- Private connection keys, their server hashes, deployment secrets, and
  other configuration needed to connect devices. Keep credentials separately.
- Supabase Auth passwords, identities, sessions, and users who have no
  Elephant account workspace. Only the scoped UUID/email map is included.
- Piano Studio's live lesson feed, which lives in a separate project and is
  deliberately excluded from workspace persistence.
- Other applications' tables, external storage objects, and external
  services.

## Implementation

| File | Purpose |
|---|---|
| `supabase/migrations/003_backups.sql` | Restricted consistent snapshot RPC |
| `server/backup/db-backup.ts` | Database export, R2 verification, retention orchestration, reporting |
| `server/backup/retention.ts` | Archive naming and GFS retention rules |
| `api/db-backup.ts` | Authenticated hosted endpoint |
| `vercel.json` | Hosted schedule and function configuration |
| `scripts/db/backup.mjs` | Manual backup and retention preview |
| `scripts/db/restore-workspace.mjs` | Verified archive-to-workspace export |

## Operational verification

Verified locally against production services on 2026-10-09:

- Migration applied without changing workspace or revision counts.
- Anonymous and authenticated roles cannot execute the snapshot RPC;
  service-role access works.
- Initial R2 archive contained 3 tables and 52 rows (one desktop workspace,
  51 saved revisions, no account workspaces), about 290 KB including schema
  and migrations. Every object passed read-back checksum verification.
- The recovery command verified the archive and produced workspace JSON
  accepted by the app's import validator, with matching collection counts.
- Resend confirmed the backup report was delivered to `lionel@musicalbasics.com`.

The archive ID in a report identifies that run; a newer complete backup in
the same retention period can replace it.
