# Supabase and Vercel setup

The app works without a Supabase project. It starts with an editable sample workspace, saved in this browser. Signing in opens a separate account workspace: a new account starts empty, and sample data is never uploaded automatically. Export and then explicitly import a workspace if you want to transfer it.

## Private desktop workspace (no sign-in)

The supplied `VITE_SUPABASE_URL` points to `rhtshpewletapfcfrnvt`. Apply `supabase/migrations/002_elephant_schema.sql` there. It creates `elephant.workspaces` and `elephant.workspace_revisions`, enables RLS, and restricts access to the server's service role. The schema does not need to be exposed in the Data API: restricted public RPC functions access it. Other apps' tables, policies, and authentication settings are preserved.

Set these **server-only** Vercel variables, also available in `.env.local` for `vercel dev`:

- `ELEPHANT_SUPABASE_SERVICE_KEY`: a service-role key for the project in `VITE_SUPABASE_URL`.
- `ELEPHANT_WORKSPACE_KEY_HASH`: SHA-256 hex digest of the private desktop link key.
- `ELEPHANT_WORKSPACE_ID=desktop`: the fixed row ID, chosen by the server.

Use the same private link key and hash as the Piano Studio connection below. Opening the link in the original browser selects its existing desktop workspace and automatically saves it to `elephant.workspaces`. A saved account session does not switch this private workspace. On a fresh browser the same link loads the Supabase copy. The link grants read/write access to this workspace plus read-only access to the lesson feed; treat it as a private access credential, never put it in source or a public environment variable. Rotating both server hashes revokes it. No Elephant email sign-in is required.

Before replacing a legacy cache, the app preserves its raw value at `elephant.workspace.local.v1.before-supabase.<id>`. It loads the server revision before uploading, and refuses to overwrite a different existing cloud copy. Empty new browsers do not upload sample data. The original database revision and the latest 50 saves are retained in `elephant.workspace_revisions`. Browser storage remains an immediate cache for pending edits; **Saved to Supabase** confirms the server save. Desktop sync refreshes every 30 seconds while visible, on focus/online, and through **Retry sync**.

## Connecting another device

On a connected device, **Settings → Connect another device** generates a QR code entirely in the browser and offers a private link in the form `https://elephant-app-gold.vercel.app/#workspace-connect=KEY`. Scan it with the phone’s camera or paste it into **Connect existing workspace** on the unconnected device. The public gallery and unconnected local workspace display this option; opening the ordinary website URL alone does not authorize access to a private workspace.

The connection screen runs separately from the workspace hook. It removes the credential fragment immediately, verifies the key and remote workspace through a read-only request, preserves any existing local cache byte for byte at `elephant.workspace.local.v1.before-connect.<id>`, then installs the verified cloud snapshot and revision with `dirty: false`. It never uploads a mobile demo cache or creates a new account workspace. An invalid link, missing server workspace, unreadable cloud data, concurrent local edit, or inability to preserve the previous copy stops the connection. Reopening a link on an already connected device keeps that device’s pending edits. Account caches remain separate and untouched. The existing `#piano-connect` link is also accepted when pasted into the connection form; the original automatic desktop migration entry point is retained for compatibility.

The private link is an access credential. Keep it out of source, public pages, telemetry, and backups. The QR is generated locally without sending it to a QR service. Once connected, the phone uses the same private desktop APIs and normal revision-checked saving. Email sign-in is unnecessary for this workspace.

## Automated database backups

Daily external database backups use the restricted `public.elephant_backup_snapshot()` RPC from `supabase/migrations/003_backups.sql`. Only the server's service role can execute it. The private schema stays outside the Data API, and the hosted backup never needs a Supabase personal token. See [backup storage, retention, and recovery](backups.md).

## Optional account workspaces

1. Choose or create the Supabase project that should own Elephant data.
2. Run `supabase/migrations/001_workspaces.sql` once in that project's SQL editor. It creates one workspace per user, owner-only row-level security, and revision tracking.
3. Enable email sign-in and keep the magic-link email template's `{{ .ConfirmationURL }}` link. In **Authentication → URL Configuration**, add approved redirect URLs for production and `http://localhost:5173/` development. For a new project, set the production Site URL; for a shared project, preserve its existing Site URL and redirect entries. Add each preview origin you intend to use for sign-in, allowing the app's `design` query parameter.
4. Copy `.env.example` to `.env.local` and set:

   ```dotenv
   VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
   ```

   `VITE_SUPABASE_ANON_KEY` is supported as a legacy alternative. Use only a publishable or anon key. Vite includes `VITE_` values in public browser code; never put a service-role key, secret key, or database password there.

5. Restart the development server. Open Settings, enter an email, and follow the sign-in link. Check your Supabase email delivery configuration before inviting real users.

The implementation follows Supabase's [email magic-link API](https://supabase.com/docs/reference/javascript/auth-signinwithotp), [RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security), and [filtered updates](https://supabase.com/docs/reference/javascript/update).

## Deploy on Vercel

Import `musical-basics/elephant-app` into Vercel. Use the Vite framework preset, `npm run build` as the build command, and `dist` as the output directory. Set the same public Supabase environment variables for the deployment environments you want connected. Add the deployed origin to Supabase's redirect allowlist, then redeploy after changing environment variables. The app can also be deployed without these variables for local-browser-only evaluation of the five designs.

The public production app is [elephant-app-gold.vercel.app](https://elephant-app-gold.vercel.app). Generated team/branch deployment aliases retain their existing Vercel protection. Supabase allows the production origin's root and all five `?design=...` redirects, as well as the initial deployment aliases, `localhost:5173`, and `127.0.0.1:5173`. Existing redirect entries were preserved. Supabase treats redirect entries as glob patterns, so the query separator is escaped as `\?` for exact matching; no wildcard authorizes unrelated Vercel sites. Add future immutable preview URLs explicitly if sign-in is needed there.

The supplied project is `rhtshpewletapfcfrnvt` (`https://rhtshpewletapfcfrnvt.supabase.co`). The migration has been applied, and live checks verified anonymous access denial, owner reads/writes, cross-account isolation, revision increments, and rejection of stale updates. Two temporary confirmed accounts were created without sending email, then deleted with all test workspace rows. Other tables and existing auth configuration were preserved.

A signed-in mobile-browser smoke test passed on the public production domain: a fresh account started empty, an item added through the UI saved to Supabase, and a reload restored it after removing the account's browser cache. No browser JavaScript errors occurred. Supabase also accepted the exact production `?design=still` magic-link redirect in a no-email link-generation check. The temporary production test user and its workspace were deleted afterward. Actual email delivery remains untested.

This Supabase project also serves another app. Preserve its existing Site URL and redirect entries; append Elephant's production and development redirect URLs instead of replacing those settings. The sign-in redirect carries a whitelisted `design` query parameter so the chosen design survives authentication. Confirm real email delivery before inviting users; integration checks do not send email.

## Piano Studio calendar connection

The production Vercel function `GET /api/piano-lessons` reads the separate Piano Studio Supabase project. Configure `PIANO_STUDIO_SUPABASE_URL` and `PIANO_STUDIO_SERVICE_KEY` as **server-only** environment variables on Elephant. The service key never enters browser code.

Generate a random 32-byte base64url private key and configure its SHA-256 hex digest in both `PIANO_STUDIO_LOCAL_KEY_HASH` and `ELEPHANT_WORKSPACE_KEY_HASH`. The private link has the form `https://elephant-app-gold.vercel.app/#piano-connect=KEY`. It selects the original desktop workspace before React mounts, connects its Supabase storage as described above, and opens the calendar. Refresh other browser tabs to use the same workspace.

The URL fragment is removed immediately and is never sent in the page request or referrer. The key is stored separately from workspace data and sent only to the same-origin APIs: `X-Piano-Key` for lessons and `X-Elephant-Key` for workspace storage. It is excluded from workspace backups and source code. If browser storage is unavailable, access works for that visit and a persistence warning is displayed.

Existing account-based access remains available through `PIANO_STUDIO_OWNER_ID`, the permitted user's UUID in Elephant's auth project. That path validates the bearer token with Elephant's auth server and requires the exact confirmed account. Other accounts receive an empty disconnected feed. Without a valid private calendar key or authorized account, the API returns no lessons. Responses use `private, no-store` and vary by both credential headers.

The connection only selects lesson ID, date, time, duration, status, and student name; it has no write operation. The studio repo and its scheduling/billing behavior are unchanged.

The visible calendar range is loaded on demand with a one-day timezone margin. Only actual `scheduled`/`completed` rows appear; standing slots beyond booked dates are not projected. Studio cancellations delete rows, so each refresh replaces the feed rather than appending copies. Previously loaded lessons remain visible with a stale-data message after a failed refresh; they are removed immediately when the account or range changes. The feed stays in memory and is excluded from workspace persistence/backups and item reminders.

For local integration work, use `vercel dev` with the server environment configured; plain `npm run dev` serves the UI only. Browser tests mock `/api/piano-lessons` and `/api/workspace` and unit tests mock both Supabase projects, without real credentials.

## Saving behavior and recovery

- Browser edits are cached immediately. Cloud saves are debounced and serialized. Each update includes the revision it loaded; a competing update pauses sync instead of silently replacing the other device's work.
- Accounts use separate browser keys. Signing out returns to the local sample workspace and preserves any pending account edits in that account's cache. On a shared device, sign out and clear that account's browser cache after exporting or confirming a successful cloud save.
- A failed cloud load cannot trigger a blind upload. The app keeps local edits and checks the server again on **Retry sync** or when the browser comes back online. A cloud workspace needs an initial successful cloud read before its edits can upload.
- This version has no live multi-device merging. Account workspaces fetch changes on reload or retry; private desktop workspaces also refresh automatically; avoid editing the same account in multiple tabs at once. Conflicts require choosing and reconciling copies manually. Browser storage is not a backup; use export for durable copies. There is no service worker, so offline work requires the app to be open already.
- If a save conflicts, export the pending workspace in Settings first. Preserve that export. Close other tabs, remove only the relevant `elephant.workspace.account.<user-id>.v1` entry (or `elephant.workspace.local.v1` for the private desktop) from your browser's developer tools under Application/Storage → Local Storage, then reload to fetch the cloud version. Compare the export and cloud workspace, apply the edits you want to retain, or explicitly import the chosen workspace. Retry alone never forces an overwrite.
- Keep a downloaded JSON backup somewhere outside browser storage. In Settings, **Download JSON backup** saves the current workspace; **Restore JSON backup** validates a chosen file and asks before replacing the workspace. A malformed file makes no changes. Ordinary restores use the same save path as edits: the imported workspace opens immediately, but check the save status to confirm it reached browser storage or the cloud. If both are unavailable, it exists only in the current tab.
- If saved browser data is corrupt, editing and backup download pause so the empty recovery placeholder cannot be mistaken for your data. You can still choose **Restore JSON backup**. After confirmation, the app preserves the damaged raw value in a separate browser recovery entry before replacing it. If that copy cannot be saved, restoration stops and the original stays untouched. Restoring a corrupt signed-in account cache also requires a successful cloud revision check; cloud updates remain protected against concurrent edits. This recovery path saves the restored backup locally before resuming cloud sync, with cloud progress shown separately.
- Recovery copies remain under `elephant.workspace.local.v1.recovery.<id>` or `elephant.workspace.account.<user-id>.v1.recovery.<id>`. Copy their raw values to a file through browser developer tools if you need to recover unsynced changes missing from your JSON backup. Without a JSON backup, preserve the damaged original entry before removing it manually. Then reload: local mode starts a sample workspace; a signed-in account fetches its cloud copy. These browser recovery entries are not a substitute for downloaded backups.
- If storage is blocked or full, the app reports it. Cloud accounts still attempt to load and save through Supabase; browser-storage access errors alone do not enter corrupt-data recovery mode. Keep the tab open and download your work if saves fail. Resolve browser storage permissions or free space before using the corrupt-data recovery path, which requires preserving the original value locally.

## Activity logs

The optional `activityLog` array lives in the existing workspace JSON; no new table or schema migration is required. Task completion and its inferred activity interval save in the same workspace update. Logs use UTC timestamps, render in local time, and roundtrip through backups. Restoring a legacy backup clears logs explicitly, as does Reset workspace. The private workspace API preserves existing logs when an older client omits the field, while still enforcing that client’s expected revision. An explicit empty array clears logs.

## Focus mode

The optional `focusMode` JSON field stores the selected active project, `between` (0–3), and the number of other master-list tasks still to complete before returning. It is saved atomically with task completion and its activity log, with the existing revision checks and device refresh behavior. It does not reorder master-list slots. A null value explicitly ends focus; old backups without the field still load, and restoring one through the UI clears focus. Invalid spacing/progress is rejected; a no-longer-active or empty project clears the selection. Reset workspace clears focus too. The private API preserves focus data omitted by an older client, using the same guarded read and expected revision as log preservation.

## Diary

The optional `diary` array lives in the existing workspace JSON; no new table or schema migration is required. Each entry stores `id`, `text` (1–20,000 characters), `writtenAt`, `createdAt`, and an optional `updatedAt`, all as UTC timestamps rendered in local time. Entries roundtrip through backups; restoring a legacy backup or Reset workspace clears them explicitly. The private workspace API preserves diary entries omitted by an older client, using the same guarded read and expected revision as logs and focus mode. An explicit empty array clears the diary. The sort preference is `settings.diarySort` (`newest` or `oldest`); the private API preserves it when an older client omits it, so a stale tab cannot reset the choice. Unsent drafts and the entry editor's size stay in the browser's local storage and are never synced.
