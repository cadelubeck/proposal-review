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
OPENAI_API_KEY=your_server_side_api_key
# Optional overrides:
OPENAI_MODEL=gpt-5.6-sol
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
JWT_SECRET=use-a-long-random-production-secret
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

## Data
Proposal records are stored in `backend/data/`; tagged library records are stored
in `backend/standards/`. This local JSON persistence is suitable for a prototype.
Production deployment should use encrypted object storage and a transactional
database/vector index with backups and retention controls.
