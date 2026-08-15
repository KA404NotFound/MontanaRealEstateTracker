# Montana Multi-County Real Estate Tracker

Parcel/ownership/assessed-value explorer covering all 56 Montana counties, built on
Montana's statewide Cadastral API.

See [`Montana_Real_Estate_Tracker_Plan.md`](./Montana_Real_Estate_Tracker_Plan.md) for the
full roadmap, schema rationale, and — importantly — the Phase 1 Findings section explaining
why this pulls from one statewide API instead of scraping county sites, and why there's no
per-listing or sale-price data (Montana is a legal non-disclosure state for sale prices, and
MLS data requires a broker/IDX relationship — not something to build here as a hobby project).

## Architecture

Three containers, one `docker-compose.yml`:

| Service | What it is | Host port |
|---|---|---|
| `db` | Plain Postgres 16 + PostGIS image — no custom build, schema setup is entirely owned by `backend`'s migration runner | not published — reachable only from `backend` over the compose network |
| `backend` | Express API + the Cadastral ingestion job + migration runner | not published — reachable only through `frontend`'s nginx proxy |
| `frontend` | Vite/React dashboard, built and served via nginx (which also proxies `/api/*` to `backend`) | 8080 (→ nginx 80) |

Only `frontend` is exposed to the host/internet — `db` and `backend` are reachable only over
the internal compose network. (If you need direct `psql` or API access for debugging,
temporarily uncomment the commented-out `ports:` line for that service in
`docker-compose.yml`.)

**Schema migrations:** `backend/db/migrations/*.sql`, applied automatically on every backend
startup by `backend/src/db/migrate.js` (tracked in a `schema_migrations` table, already-applied
files are skipped). This replaced relying on Postgres's `docker-entrypoint-initdb.d` (which
only ever runs once, on a completely empty data volume — the cause of a couple of early
deploy issues where schema changes silently never applied to an already-initialized database).
To make a future schema change: add a new numbered `.sql` file to `backend/db/migrations/`,
commit it, redeploy — no more hand-running `ALTER TABLE`/`CREATE INDEX` via the Portainer
console.

**Ingestion:** on every boot, the backend checks per-county row counts and ingests any
county that's missing data (self-healing — if a previous run died partway through, the next
restart picks up where it left off rather than silently sitting on partial coverage). A full
refresh of all 56 counties also runs monthly via cron, matching how often the Cadastral
dataset itself is republished. Market metrics (median/avg assessed value per county) are
recomputed automatically at the end of every ingestion run — no separate step needed.

Two token-gated manual triggers (`INGEST_TOKEN` env var, `Authorization: Bearer <token>`):
```bash
curl -X POST -H "Authorization: Bearer $INGEST_TOKEN" http://<host>:8080/api/ingest
curl -X POST -H "Authorization: Bearer $INGEST_TOKEN" http://<host>:8080/api/ingest/Granite
```
The first re-ingests everything (all 56 counties — expect hours, not minutes); the second
re-ingests just one county (useful for verifying a fix without redoing the whole run).
Leaving `INGEST_TOKEN` unset disables both endpoints entirely (they're the only
state-changing, expensive endpoints in an otherwise no-auth-by-design v1).

## Running it

**Via Portainer (how this is meant to be deployed):**
1. Stacks → Add stack → Repository, point at this repo/branch, compose path `docker-compose.yml`
2. In the stack's environment variables, set `POSTGRES_PASSWORD` (and optionally
   `POSTGRES_DB` / `POSTGRES_USER` / `INGEST_TOKEN`). Don't rely on `.env.example` — it's a
   template, not loaded automatically.
3. Deploy. Watch the `backend` container logs — first boot kicks off ingestion for all 56
   counties, which takes several hours (this is a big, deliberately-throttled sequential
   pull against a single government GIS server, not something to rush).
4. Visit `http://<host>:8080` once ingestion has populated at least one county.

**Locally with Docker Compose:**
```bash
cp .env.example .env   # then edit POSTGRES_PASSWORD
docker compose up -d --build
```
Then open `http://localhost:8080`.

**Frontend/backend dev loop (no Docker), against a running `db` container:**
```bash
# terminal 1
cd backend && npm install && npm start
# terminal 2
cd frontend && npm install && npm run dev
```
`vite.config.js` proxies `/api` to `http://localhost:3000` in dev, mirroring what nginx does
in production, so the frontend code doesn't need to know which mode it's running in.

## What the dashboard shows

- County dropdown (with an "All Counties" statewide option), showing per-county parcel
  counts and total assessed value
- Parcel search (owner name, address, parcel ID), viewport-scoped — the map and table both
  query whatever's actually visible on screen (a bounding-box query), not a fixed
  value-sorted slice of the whole county/state
- Interactive map: marker view (colored by assessed value) or a toggleable heatmap
  (density-weighted by assessed value *per acre*)
- Property detail panel (owner, mailing address, assessed value breakdown, acreage, legal
  description) on click
- CSV export of the current filtered view (up to 50,000 rows)
- Assessed Value Trends panel per county — median/average assessed value, computed
  automatically from ingested parcel data (not a real sale-price/MLS feed — see Phase 1
  Findings and Phase 4 Week 3 in the plan doc for why)
- Ownership Insights (per-county or statewide): top multi-parcel owners, Montana-vs-out-of-
  state residency breakdown, and an LLC/Trust/Corporation/Partnership/Individual breakdown —
  all inferred from owner-name/address text patterns already in the data, not an
  authoritative classification

## Useful scripts (run inside the `backend` container, or locally with `npm run <script>`)

| Script | What it does |
|---|---|
| `npm run verify` | Compares each county's actual row count against a live re-count from the Cadastral API — the way to check ingestion actually completed cleanly |
| `npm run compute-metrics` | Recomputes the Assessed Value Trends data immediately, without waiting for (or triggering) a full re-ingestion |
| `npm run ingest:cadastral -- Flathead` | Fetches one county's parcels and prints a sample, without touching the database — useful for testing the API client in isolation |

## Next steps

See "Phase 4: Implementation Roadmap" in the plan doc for what's done vs. outstanding.
The main remaining item is the Phase 8 MCP server (planned in detail, paused on one open
decision: local vs. remote transport).
