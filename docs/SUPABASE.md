# Supabase and Vercel setup

The app works without a Supabase project. It starts with an editable sample workspace, saved in this browser. Signing in opens a separate account workspace: a new account starts empty, and sample data is never uploaded automatically. Export and then explicitly import a workspace if you want to transfer it.

## Connect a project

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

## Saving behavior and recovery

- Browser edits are cached immediately. Cloud saves are debounced and serialized. Each update includes the revision it loaded; a competing update pauses sync instead of silently replacing the other device's work.
- Accounts use separate browser keys. Signing out returns to the local sample workspace and preserves any pending account edits in that account's cache. On a shared device, sign out and clear that account's browser cache after exporting or confirming a successful cloud save.
- A failed cloud load cannot trigger a blind upload. The app keeps local edits and checks the server again on **Retry sync** or when the browser comes back online. An account needs an initial successful cloud read before its edits can upload.
- This version has no live multi-device merging. Reload or retry to fetch changes from another device; avoid editing the same account in multiple tabs at once. Conflicts require choosing and reconciling copies manually. Browser storage is not a backup; use export for durable copies. There is no service worker, so offline work requires the app to be open already.
- If a save conflicts, export the pending workspace in Settings first. Preserve that export. Close other tabs, remove only the relevant `elephant.workspace.account.<user-id>.v1` entry from your browser's developer tools under Application/Storage → Local Storage, then reload to fetch the cloud version. Compare the export and cloud workspace, apply the edits you want to retain, or explicitly import the chosen workspace. Retry alone never forces an overwrite.
- Keep a downloaded JSON backup somewhere outside browser storage. In Settings, **Download JSON backup** saves the current workspace; **Restore JSON backup** validates a chosen file and asks before replacing the workspace. A malformed file makes no changes. Ordinary restores use the same save path as edits: the imported workspace opens immediately, but check the save status to confirm it reached browser storage or the cloud. If both are unavailable, it exists only in the current tab.
- If saved browser data is corrupt, editing and backup download pause so the empty recovery placeholder cannot be mistaken for your data. You can still choose **Restore JSON backup**. After confirmation, the app preserves the damaged raw value in a separate browser recovery entry before replacing it. If that copy cannot be saved, restoration stops and the original stays untouched. Restoring a corrupt signed-in account cache also requires a successful cloud revision check; cloud updates remain protected against concurrent edits. This recovery path saves the restored backup locally before resuming cloud sync, with cloud progress shown separately.
- Recovery copies remain under `elephant.workspace.local.v1.recovery.<id>` or `elephant.workspace.account.<user-id>.v1.recovery.<id>`. Copy their raw values to a file through browser developer tools if you need to recover unsynced changes missing from your JSON backup. Without a JSON backup, preserve the damaged original entry before removing it manually. Then reload: local mode starts a sample workspace; a signed-in account fetches its cloud copy. These browser recovery entries are not a substitute for downloaded backups.
- If storage is blocked or full, the app reports it. Cloud accounts still attempt to load and save through Supabase; browser-storage access errors alone do not enter corrupt-data recovery mode. Keep the tab open and download your work if saves fail. Resolve browser storage permissions or free space before using the corrupt-data recovery path, which requires preserving the original value locally.
