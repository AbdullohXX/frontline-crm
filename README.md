# Frontline CRM

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

### Lead conversations and media

Existing leads open in a full-screen workspace with a shared, append-only conversation beside the detail/activity forms. Every message is attributed from the authenticated team account and timestamped in the CRM timezone. Earlier notes and imported creation information remain visible; missing historical authorship is labeled as unknown. Unsaved detail edits must be saved/cancelled before posting. Conversations refresh every 30 seconds while visible and can load older history.

Apply `supabase/migrations/20261007182622_lead_conversations.sql` after the shared-access migration. It creates the private `lead-media` bucket and RLS-protected attachment metadata. Browser uploads use the signed-in Supabase account, not a service key. Up to four attachments per message are supported: images up to 8 MB and audio recordings up to 25 MB. Media access is authorized by `/api/media`; uploaded files already linked to a message cannot be removed through the uploader cleanup policy. Failed message uploads are cleaned up when possible.

Getyn automatic recording synchronization is not configured. Download a recording from Getyn and attach it to the lead conversation for playback. Supported media: JPG, PNG, WebP, GIF, MP3, WAV, OGG, M4A and WebM audio. Account Storage quotas and billing still apply.

## Quo Phone integration

Quo calls and SMS sync to each lead by a unique international phone match. Ambiguous/group/unknown numbers remain unassigned for administrator review in Quo Phone. Provider data never changes lead stage or ownership. Call detail panels retrieve recordings, voicemail, transcripts and AI summaries using authenticated server routes. Enable recordings in Quo; summaries/transcripts require a supported Quo plan. Browser calling is performed in the Quo app, not an embedded softphone.

Server environment: `QUO_API_KEY`, `QUO_INGEST_TOKEN` (random 32-byte secret), and `QUO_WEBHOOK_KEY` returned by the `2026-03-30` webhook API. Provision only the SHA-256 ingestion token hash in `crm_private.quo_state`; never commit a key. The webhook URL is `/api/quo/webhook`. Quo Phone exposes member mapping, unmatched history review, refresh and sender permissions. CRM SMS requires a mapped Quo user assigned to the sender number and an explicit review/send click. API messaging charges apply. A reserved SMS submission is never automatically retried after an uncertain response.

Contact changes are queued transactionally, synced after individual lead saves, and retried by `/api/cron/quo` with `CRON_SECRET`. GitHub Actions uses the existing `EXPLEE_CRON_SECRET` repository secret to trigger this endpoint every ten minutes. Calls/messages use an overlapping two-day reconciliation window in scheduled runs; administrators can import the last 30 days. Recordings are retrieved through fresh Quo signed URLs rather than copied into CRM storage. Older recordings remain dependent on Quo retention. Analytics aggregate all permitted Quo events, separate from manually logged CRM activity.

## Team productivity and Gmail
Open Analytics → Activity & team for agent cards, daily call/email goals, active-time estimates, and period leaderboards. Admins can change daily goals. Active time is counted only when the page is visible and the user interacted within the last minute; it starts at this release and is not attendance or payroll data.

Each agent selects Connect my Gmail and consents with the same company account. The Google OAuth project used by Supabase must enable Gmail API and permit the `https://www.googleapis.com/auth/gmail.metadata` scope. Organization policy may require administrator approval. Tokens remain in the existing authenticated session; if Google access expires, reconnect Gmail. Sync checks the latest 100 sent messages, imports only subject/recipient/time metadata for exact matching CRM email addresses, and deduplicates by mailbox, message and lead. Message bodies and attachments are not imported. New matching messages appear in lead history and email analytics after refresh.


## Shared Quo sales attribution
Lucy and Marshall are Lead generators; Archie and Dora are Sales reps. In Quo Phone or a lead window, reps open Your calling session, start a one-hour session, register the lead immediately before calling, then open Quo. A registration can match one outbound provider call to the same normalized phone within ten minutes. Consumed attempts are excluded from new matches; competing unconsumed registrations remain unassigned. Match attribution is an inference, not proof of the person using the shared Quo login. Calls outside this flow remain unassigned; admins can assign confirmed callers after the call is linked to a lead. Existing shared-account calls are deliberately not backfilled to a guessed rep.

Quo Phone and Analytics → Activity & team contain separate sales and generator KPI panels. Provider answered status includes voicemail. Reps confirm human contact, voicemail, no answer, wrong number, disconnected number, follow-up, meeting or qualification separately; only the attributed rep or admin can confirm. Confirmations and admin assignments are recorded in lead activity. Provider failures are not automatically treated as invalid numbers. Generator metrics use recorded `created_by`, never assigned owner, and do not infer missing imported creators. Report date boundaries are explicitly UTC and queries page through all accessible data, with a 50,000-record guard.

## AI sales advisor
Analytics → AI sales advisor uses the selected date, owner and source filters. It loads all accessible current unarchived lead metadata and period Quo/activity aggregates (50,000-record guard), then sends up to 25 priority lead note excerpts and available summaries/transcript excerpts from up to 8 recent calls to Vercel AI Gateway. Direct email addresses and phone numbers are redacted from text; company names, pipeline fields, rep names and attribution are retained under the approved data scope. Report coverage is displayed, including unavailable transcripts. Reports are private to the requesting active member, with three attempts per hour and concurrent-run protection. No model tools, messaging or CRM write actions are provided. AI suggestions require human review and are not guaranteed causal findings.

The model is selected through server-only AI_GATEWAY_MODEL, with Vercel OIDC authentication in deployments or an optional AI_GATEWAY_API_KEY. The current deployment model is google/gemini-3.1-flash-lite, verified against the live model catalog at setup. Gateway requires a payment card on the Vercel team to unlock requests/free credits. This must be completed by the account owner; no billing details are handled by the CRM. Local synthetic previews do not call AI. If Gateway is unavailable, the UI returns an explicit setup error rather than fabricated advice.
