# Elephant

A mobile-first productivity app that shows one item at a time. Five complete visual directions share the same workspace and behavior. The opening screen is a design gallery; choose any direction to try the app.

**[Explore the five designs](https://elephant-app-gold.vercel.app/)**

| Design | Direction | App route |
| --- | --- | --- |
| Still | Ivory, forest green, editorial typography, botanical details | `/#/still/home` |
| Ember | Terracotta, warm paper, rounded arches | `/#/ember/home` |
| Orbit | Deep navy, lavender, circular focus | `/#/orbit/home` |
| Tide | Airy blue, structured cards, clear hierarchy | `/#/tide/home` |
| Pop | Chartreuse, bold type, geometric shapes | `/#/pop/home` |

## Included

- One current item, with its project shown underneath. Completing an item timestamps it and advances the queue.
- Finishing the last item keeps its project active so you can add more. Use **Mark project complete** on the project page to explicitly finish it; confirmation also completes any remaining items. **Reopen project** makes it active again.
- Take a Bite: rename the current step and create its remainder. The first step stays open until explicitly completed.
- Errands and sequential project items; active, upcoming, and completed projects; editable names and due dates.
- Project placeholders preserve each project's reserved queue positions when its steps are inserted, reordered, split, or deleted.
- Long-press a handle to reorder, use the accessible up/down controls, or swipe left to remove an item with confirmation.
- Select a step to insert immediately after it. New steps otherwise append to their project.
- Duplicate any item from its copy button. Project copies follow the original; errand copies join the queue. Each copy starts unfinished, preserves the original, and can be edited independently. Copying a completed project's item reopens that project.
- Delete a project from its card or detail page to remove the project and its unfinished items from the queue. Completed items stay in history with their original project name; putting one back restores it as an errand.
- Completed item/project history, search, profile name/photo, and an optional master list hidden by default.
- Put back a completed item to restore the original at the front of Do now. Its project reopens if needed, and other queued items keep their order.
- JSON export/import with validation and replacement confirmation, list-specific CSV exports, and confirmed reset.
- Browser persistence plus Supabase email-link sign-in and a private workspace for each account, with revision checks that prevent silent cross-device overwrites.

To save a full backup, open **Settings → Download backup** (or **Backups & exports → Download JSON backup**). The timestamped `.json` includes all projects, items, queue order, completion history, profile/photo, and settings. Keep it outside the app. **Restore JSON backup** validates a saved file and asks before replacing the current workspace; it also supports recovery when browser data is unreadable.

Priority is omitted. All projects use the same insertion threshold of **1/3**, applying the workbook's strict ready-score comparison. Empty queues seed one slot per active project. These decisions and the source workbook's inconsistent manual counts are documented in [docs/CALCULATIONS.md](docs/CALCULATIONS.md).

The local workspace starts with example projects. Account workspaces start empty. All five designs edit the same workspace. Use Settings → Reset workspace for a fresh local start, or export/import to explicitly transfer local work into your account.

## Development

Requires Node.js 22.12+ (or Node.js 24).

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to enable accounts. Without them, local browser persistence still works. Never put a private Supabase token or service-role key in a `VITE_` variable. The local environment file and Vercel configuration directory are ignored by Git.

```sh
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

Unit tests cover the calculation examples, placeholder ordering, splitting, project lifecycle, imports, and CSV escaping. Browser tests cover all five designs, small mobile/desktop layouts, editing, history, backup recovery, and mocked persistence failures/concurrent saves. Cloud tests intercept requests and never use real credentials.

## Supabase and deployment

See [docs/SUPABASE.md](docs/SUPABASE.md) for schema, email redirects, environment configuration, and recovery. The SQL migration creates `elephant_workspaces` with owner-only row-level security. Each user's JSON workspace is versioned and saved atomically.

Vercel uses the Vite preset, `npm run build`, and `dist`. `vercel.json` provides SPA fallback routing and basic response headers. The supplied Supabase project is shared with another app, so its existing authentication settings must be preserved when adding Elephant's redirect URLs.

The app has no service worker or automatic conflict merging. Offline edits need an already-open page; export is the durable backup mechanism. Confirm actual email delivery with the project's email provider before inviting users.

## Source materials

- `Elephant V1.0 Writeup v2.pdf`: product flows and settings.
- `Elephant Calculations.xlsx`: queue and Take a Bite examples.

Implementation: React, TypeScript, Vite, Supabase, and Lucide icons. Visual assets are CSS and inline SVG. Fonts are DM Sans, DM Serif Display, and Space Grotesk.
