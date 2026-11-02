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
- Deterministic arithmetic audit of explicitly printed proposal calculations
- Full cited compliance matrix with pass/fail/engineer-review outcomes

## Compliance workflow

1. Open **Standards** and upload city/client standards plus geotechnical, seismic,
   groundwater, floodplain, and other engineering reports.
2. Add jurisdiction/client metadata and run **Extract requirements**.
3. Upload a proposal and open its **AI Review Center**.
4. Choose the three-page document review, structured standards comparison, or
   diagram analysis. Only one AI task can run at a time.
5. A licensed engineer resolves flagged conflicts and makes the final decision.

The three review controls use different evidence paths:

- **Run AI API** reviews exact three-page batches, saves progress after every batch, and resumes after a reload.
- **Analyze diagrams** reads the uploaded PDF, includes requirements from matching extracted library documents, and performs location-specific web research only on `ANALYSIS_SOURCE_DOMAINS`. It records the library coverage and returned web sources with the result.
- **Run structured standards comparison** does not use general web results as controlling requirements. It extracts submitted values, retrieves matching extracted library requirements, and runs the deterministic comparison engine. An empty or unmatched repository returns an explicit error instead of an empty review.

Both controls require `AI_ENABLED=true`. Web research additionally requires
`AI_WEB_SEARCH_ENABLED=true`. This opt-in is intentional because OpenAI API and
web-search usage are billable. Hosting being on a free tier does not make AI calls free.

The three-page document review defaults to automatic limits of 5 minutes, 30
pages, and 75,000 response-reported tokens. Set `AI_REVIEW_MAX_MINUTES`,
`AI_REVIEW_MAX_PAGES`, and `AI_REVIEW_MAX_TOKENS` to tighten or relax those
limits. A user can also stop the active background response from the tracker.

## Shared source governance

- Administrators can publish a source as **Shared with everyone**. Shared records are readable by every authenticated organization. They use `backend/standards/_shared.json` locally and Supabase in production.
- Organization sources remain isolated to the uploader's company.
- Restricted utility/infrastructure sources are forced to organization-only visibility, are hidden from non-admin users, and are excluded from AI requests and web-search domain expansion.
- The catalog uses 17 source categories covering engineering standards, codes, hazards, subsurface, GIS/survey, utilities, transportation, environmental requirements, capital plans, permitting, procurement, contracts, cost/schedule, vendor qualifications, project documents, lessons learned, and definitions/data dictionaries.
- Administrators can open **Source health** to see missing URLs, broken links, redirects/content changes, and unchecked sources. Checks run at startup and on `SOURCE_HEALTH_CHECK_INTERVAL_MS`; administrators can also check one source or all sources immediately and acknowledge notifications.
- Proposal analysis requires a specific city and state. Sources are filtered before AI use: applicable statewide records are considered first, then exact-city records. Other cities, counties, districts, and unrelated publisher indexes are excluded and counted in the UI.
- The Utah discovery catalog includes a 257-municipality index. Imported source links are unverified discovery records with no extracted requirements; a link or municipality entry is never proof of adoption, current status, or compliance.
- ZIP is optional proposal context and is searchable/displayed with the proposal, but does not resolve jurisdiction or select standards. City and state control; the catalog does not contain a ZIP-to-municipality boundary crosswalk.
- Structured standards comparison independently recomputes explicitly extracted arithmetic using a bounded expression parser (numbers, named operands, parentheses, `+`, `-`, `*`, `/`, and `^`). Unsupported or incomplete equations are sent for engineer review. Numeric agreement does not verify units, dimensions, engineering assumptions, or whether the equation is appropriate.
- Catalog-assisted structured comparisons run as OpenAI background responses and the browser polls for completion, avoiding Vercel's 60-second request timeout while preserving visible queued/in-progress/failed states.

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

PDF and text uploads support files up to 50 MB. In production, the browser
uploads directly to private Supabase Storage using a signed URL, then sends a
signed receipt to the API for text extraction and record creation. Receipts are
bound to the user, organization, and upload destination. Proposal viewing uses
short-lived signed download URLs so large files also bypass Vercel's response
size limit. Local development retains multipart uploads.

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

Municipal research loads the bundled Utah discovery catalog even when the database has not been seeded. Discovery links remain unverified. Ogden’s official 2025 Engineering Standards are supplied as a page-numbered reference snapshot (SHA-256 and retrieval metadata in `backend/catalogs/ogden-engineering-2025-reference.json`); the three review tools receive relevant source passages and must state the actual provision and cite its section/page. Publication is distinct from project incorporation and approval. Refresh the snapshot when the governing edition changes.
