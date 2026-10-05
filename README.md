# Frontline CRM

A Next.js application with Supabase PostgreSQL, Google company login, lead management, follow-ups, a pipeline, activity history, reporting, team administration and CSV migration. It replaces the Apps Script runtime. The existing Sheets CRM is not modified.

## Preview now (Windows)

Install Node.js 22 or newer. Open PowerShell in this folder and run:

```powershell
npm ci
.\scripts\preview.ps1
```

Open http://localhost:3000. Preview uses synthetic records and is read-only. It requires no Google or Supabase credentials. Stop with Ctrl+C. Preview mode is disabled in production even if LOCAL_DEMO is set.

## Connect your real database

1. Create a NEW Supabase project; keep the database password private. Do not run these migrations against an existing application's database.
2. In Supabase > SQL Editor, run these files in order, once each:
   - supabase/migrations/001_crm.sql
   - supabase/migrations/002_reports.sql
   - supabase/migrations/003_initial_admin.sql
3. The third file allows info@frontline-x.com as the first administrator. This does not create a Google account; that person must sign in with their actual company Google account.
4. Copy .env.example to .env.local. Fill in the Supabase project URL and publishable key from the project settings. Use the publishable key, never a service-role key. Set APP_URL=http://localhost:3000 and LOCAL_DEMO=false.
5. Run npm run dev and open http://localhost:3000.

The database defaults to America/New_York for follow-up days and reporting. If your team uses another timezone, run this in SQL Editor before importing records:

```sql
update public.crm_settings set time_zone = 'Asia/Tashkent' where id = true;
```

Choose the actual company timezone; the example is optional.

## Configure Google company sign-in

1. In Google Cloud Console create/select a project owned by your company. Configure the OAuth consent screen for your Workspace organization (Internal, where available).
2. Create an OAuth client of type Web application. The authorized redirect URI must be the callback URL shown in Supabase > Authentication > Sign In / Providers > Google, normally https://YOUR-PROJECT.supabase.co/auth/v1/callback. Use that Supabase callback, not the CRM callback, in Google's setting.
3. Enable Google in Supabase Auth and enter that Google client ID and secret. Disable other sign-in providers and anonymous sign-in for this CRM.
4. In Supabase Auth > URL Configuration set Site URL to http://localhost:3000 during local setup. Add http://localhost:3000/auth/callback to the redirect allowlist.
5. Sign in as info@frontline-x.com. If Workspace blocks your OAuth application, the company administrator must approve it in Google's administration settings.
6. In CRM > Settings add your agents' frontline-x.com email addresses. Accounts must be verified Google identities AND active members of this allowlist. Domain membership alone does not grant access.

Administrators can see all leads and manage team assignments. Agents can read and change their own assigned leads. Disabling a member removes database access. Lead edits and their audit entries commit in one transaction; version checks reject stale edits.

## Move the existing Sheet data

1. Keep a backup of the original spreadsheet and its history tabs.
2. Export the leads tab from Google Sheets: File > Download > Comma-separated values (.csv). Use the original A-R columns, or the extended CRM v2 sheet. A canonical template is supplied at scripts/import-template.csv.
3. Add your team members first. Set their aliases to the owner names used in the old Sheet.
4. In CRM > Settings choose your CSV, a stable source name (for example frontline-sheet-2026), and its date format. Prefer ISO YYYY-MM-DD. For slash dates explicitly select Month/Day/Year or Day/Month/Year.
5. Preview and resolve all errors. Unmapped owners require aliases or an explicitly selected fallback. Review warnings and sample records before importing.
6. Import. A batch commits atomically. Reimporting the same source name and legacy IDs skips those records; it does not overwrite them. Keep the same source name on retries. When the CSV has no IDs, row positions are used, so retain row order on retries.
7. Compare lead counts, owners, values and follow-up dates with your source before using the new CRM for live work.

Original lead IDs, owner labels, stage labels and creation dates are preserved. Legacy stages are mapped into the new pipeline with warnings. Historical stage-change dates and call events are not fabricated: old Lead_History tabs are NOT imported by this lead importer. Keep their archive; event charts start with activity recorded in the new system. Each file supports up to 5,000 leads and 2 MB.

## Publish to Vercel

1. Put this source folder in your private Git repository and import that repository in Vercel. If it is inside a larger repository, set Root Directory to the frontline-crm folder.
2. Select the Next.js preset. Install with npm ci and build with npm run build.
3. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in Vercel. Set APP_URL to the exact production HTTPS address of the CRM. Omit LOCAL_DEMO or set false. Do not upload .env.local.
4. Add the exact production address and its /auth/callback URL to Supabase Auth URL Configuration. Set the production Site URL. Add any staging callback explicitly when testing; avoid a broad wildcard.
5. Deploy and test company sign-in, creating/editing a lead, two-agent access isolation, a follow-up and the import preview. Do this in a separate staging Supabase project first if you need to keep tests out of production.
6. If you add a custom domain, follow the DNS records Vercel shows, then update APP_URL and Supabase redirect settings to that final address and redeploy.

No live project or deployment has been created by this package. Enable the database backup options suitable for your Supabase plan and verify a restore before retiring the old system.

## Calling and Getyn

Phone workspace provides a lead queue, copy-number action, link to Getyn Phone, outcome logging, follow-up scheduling and call reporting. Calls are made in Getyn's own phone interface; audio is not embedded in this CRM. No Getyn API key is needed for this workflow.

Getyn's overview does not specify working call-control endpoints, browser voice SDK credentials or a complete webhook signature contract. Automatic call syncing and an embedded softphone are therefore not enabled. /api/getyn/webhook returns 503 deliberately until verified vendor integration details are available. Do not configure a live Getyn webhook against it yet. Revoke the API key previously shown in the shared screenshot before using a fresh key in any future server integration.

## Verification and operation

```powershell
npm run typecheck
npm test
npm run build
npm start
```

Tests execute the SQL in a local PostgreSQL-compatible PGlite engine and cover access isolation, stale updates, duplicate checks, audit rollback and atomic/idempotent imports. They also cover CSV parsing and date ambiguity. These checks do not replace testing Google OAuth and PostgREST against your actual Supabase project.

Reports aggregate all records accessible to the signed-in user, independent of the 100-row lead page. Pipeline lanes show the current loaded page; use filters/pagination for larger datasets. Current pipeline metrics are snapshots; date filters apply to recorded call and win events. Export is administrator-accessible only through the UI, with database visibility still enforced on the server. Export caps at 50,000 records.

Keep package-lock.json for reproducible installs. Never commit .env.local or a service-role/API secret. Use Supabase and Vercel dashboards for errors and usage. See the official setup references: https://supabase.com/docs/guides/auth/social-login/auth-google and https://vercel.com/docs/frameworks/full-stack/nextjs.

## Advanced analytics

Analytics now has Overview, Pipeline & health, and Activity & team sections. Filters include dates, assigned owner and normalized lead source; snapshots do not change with the event date filter. Reporting normalizes LinkedIn casing and US/UK country variants without editing lead records. Unknown imported stage entry dates remain excluded and labeled.

The authenticated analytics endpoint reads all RLS-visible pages and returns aggregates. It supports up to 50,000 leads and 50,000 activity records, reporting an explicit error above those limits. Event periods are capped at 30 years. Large-scale use should replace paginated reads with database aggregation. JSON report export includes selected filters and generation time.
