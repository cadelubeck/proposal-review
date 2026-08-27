# Proposal Review

## Setup (one time)
```bash
cd proposal-review
npm install          # installs concurrently
npm run install:all  # installs backend + frontend deps
```

## Run
```bash
npm start
```
- Frontend: http://localhost:5173
- Backend API: http://localhost:3001

Create `backend/.env`:

```bash
JWT_SECRET=use-a-long-random-production-secret
APP_URL=http://localhost:5173

# AI is deliberately off unless an administrator approves a paid API budget.
AI_ENABLED=false
AI_WEB_SEARCH_ENABLED=false
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-luna
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
# Optional comma-separated allowlist used for proposal location research:
ANALYSIS_SOURCE_DOMAINS=usgs.gov,waterdata.usgs.gov,earthquake.usgs.gov,ngmdb.usgs.gov,fema.gov,epa.gov,dot.gov,fhwa.dot.gov,mutcd.fhwa.dot.gov,ada.gov,usace.army.mil,fws.gov,data.gov,sam.gov,acquisition.gov,bls.gov,jonescivil.com
# Defaults to six hours; minimum accepted value is five minutes:
SOURCE_HEALTH_CHECK_INTERVAL_MS=21600000
```

## Features
- Upload PDF or paste text proposals
- Auto-detects document sections
- 3-panel layout: index | document | review
- Per-section scoring: 🟢 Not Concerned / 🟡 Needs Review / 🔴 Needs Updates
- Text highlight with notes (select text → popup)
- Statute/code links per section (title, URL, jurisdiction, relevance)
- Proposal status: Pending / In Review / Needs Updates / Accepted / Rejected
- Folder view grouped by location, searchable by name/company/location
- Auto-save on edit
- Tagged standards and site-document library
- Structured civil requirement extraction with page evidence
- Hybrid vector/keyword retrieval scoped by jurisdiction and client
- Deterministic stricter-of-city-and-site rules engine
- Full cited compliance matrix with pass/fail/engineer-review outcomes

## Compliance workflow

1. Open **Standards** and upload city/client standards plus geotechnical, seismic,
   groundwater, floodplain, and other engineering reports.
2. Add jurisdiction/client metadata and run **Extract requirements**.
3. Upload a proposal and open **Controlling Standards**.
4. Run the full review. OpenAI extracts and matches evidence; application code
   selects the stricter comparable requirement and evaluates the submitted value.
5. A licensed engineer resolves flagged conflicts and makes the final decision.

The two review controls use different evidence paths:

- **Re-analyze proposal** reads the uploaded PDF, includes requirements from matching extracted library documents, and performs location-specific web research only on `ANALYSIS_SOURCE_DOMAINS`. It records the library coverage and returned web sources with the result.
- **Run structured standards comparison** does not use general web results as controlling requirements. It extracts submitted values, retrieves matching extracted library requirements, and runs the deterministic comparison engine. An empty or unmatched repository returns an explicit error instead of an empty review.

Both controls require `AI_ENABLED=true`. Web research additionally requires
`AI_WEB_SEARCH_ENABLED=true`. This opt-in is intentional because OpenAI API and
web-search usage are billable. Hosting being on a free tier does not make AI calls free.

## Shared source governance

- Administrators can publish a source as **Shared with everyone**. Shared records are readable by every authenticated organization. They use `backend/standards/_shared.json` locally and Supabase in production.
- Organization sources remain isolated to the uploader's company.
- Restricted utility/infrastructure sources are forced to organization-only visibility, are hidden from non-admin users, and are excluded from AI requests and web-search domain expansion.
- The catalog uses 17 source categories covering engineering standards, codes, hazards, subsurface, GIS/survey, utilities, transportation, environmental requirements, capital plans, permitting, procurement, contracts, cost/schedule, vendor qualifications, project documents, lessons learned, and definitions/data dictionaries.
- Administrators can open **Source health** to see missing URLs, broken links, redirects/content changes, and unchecked sources. Checks run at startup and on `SOURCE_HEALTH_CHECK_INTERVAL_MS`; administrators can also check one source or all sources immediately and acknowledge notifications.

## Data and deployment

Local development stores proposals in `backend/data/`, private account records in
`backend/.private/`, uploads in `backend/uploads/`, and standards in
`backend/standards/`.

Production refuses to start without `SUPABASE_URL` and the server-only
`SUPABASE_SERVICE_ROLE_KEY`. It stores application records in Postgres and uploads
in the private `proposal-files` Storage bucket. The service-role key must never be
placed in Vite variables or sent to the browser.

Deployment preparation:

1. Confirm the Supabase project is on Free and the Vercel account is on Hobby.
2. Apply `supabase/migrations/` to the linked Supabase project.
3. Add `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, and
   `CRON_SECRET` to Vercel server environment variables. Set `APP_URL` to the
   canonical production origin used in Supabase Auth redirect settings. Leave `AI_ENABLED=false`.
4. Import the GitHub repository into Vercel. `vercel.json` builds the Vite app,
   routes `/api/*` to Express, and runs the protected source-health check weekly.
5. On an empty target, migrate local prototype data with
   `MIGRATE_CONFIRM=EMPTY_SUPABASE_PROJECT npm --prefix backend run migrate:supabase`.
6. Verify `/api/health`, login, a private upload/download, shared standards, and
   the Source health admin screen before treating the deployment as usable.

Vercel Functions reject request or response bodies above 4.5 MB. The current
multipart upload routes are therefore suitable only for small preview documents
on Vercel. Before enabling normal plan-set uploads in production, change the
browser flow to use a Supabase signed/resumable upload directly to Storage, then
send only the stored object path to the API. Local uploads still allow 50 MB.

Vercel Hobby is for personal/non-commercial use. Before accepting payment or
using the product commercially, review Vercel's current plan terms and deliberately
choose a commercial hosting plan. Supabase Free projects may pause after inactivity;
the UI and health endpoint should be checked before a sales demonstration.

## Restarting

- Local backend: stop it with `Ctrl+C`, then run `npm --prefix backend start` from
  the repository root.
- Vercel: there is no server process to restart. Redeploy the latest Git commit or
  use **Redeploy** on the deployment in Vercel.
- Supabase: it is the database/storage service, not the Express backend. A paused
  free project must be restored from the Supabase dashboard.
# MCP PR test
